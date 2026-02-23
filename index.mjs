import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import pkg from "@segment/analytics-node";

const writeKey = process.env.SEGMENT_WRITE_KEY;
let segment;

// Initialize Segment client once outside handler
(function initSegmentClient() {
  try {
    const Candidate = pkg && (pkg.Analytics || pkg.default || pkg);
    if (typeof Candidate === "function") {
      segment = new Candidate({
        writeKey,
        maxRetries: 1,
        retryDelayOptions: {
          base: 100,
          multiplier: 1.5,
          max: 1000
        },
        flushAt: 1,
        flushInterval: 100,
        httpTimeout: 5000
      });
      return;
    }
    throw new Error("Unable to initialize Segment client.");
  } catch (err) {
    console.error("Segment client init error:", err);
    segment = null;
  }
})();

// Cache compiled regex for better performance
const JSON_START_END_REGEX = /^\s*[\{\[].+[\}\]]\s*$/;

function tryParseJson(value) {
  if (typeof value !== "string") return value;
  if (!JSON_START_END_REGEX.test(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// Pre-compile Sets for better lookup performance
const RESERVED_KEYS = new Set([
  "event", "userId", "anonymousId", "timestamp", "properties",
  "traits", "context", "integrations", "messageId", "sentAt",
  "receivedAt", "type", "version", "channel"
]);

const TRAIT_FIELDS = new Set([
  "user_id", "email", "name", "first_name", "last_name", "phone",
  "plan", "logins", "dob", "age", "gender",
  "street", "city","$city","$ip", "ip","state", "postal_code", "country", "country_code", "region",
  // Custom data fields - flattened versions
  "custom_data.email", "custom_data.name", "custom_data.dob", "custom_data.gender",
  "custom_data.mobile", "custom_data.phone", "custom_data.last_city",
  "custom_data.latitude", "custom_data.longitude", "custom_data.first_name",
  "custom_data.last_name", "custom_data.brazeCustomerId",
  // Attribution fields for profile (per mapping rows 32-37, 30, 55, 25, 47)
  "af_ad", "af_adset", "af_channel", "campaign", "conversion_type", "dma", "engagement_type",
  // Install/download metadata (per mapping rows 59, 61, 63)
  "install_time", "device_download_time", "gp_referrer",
  // IDFA/advertising identifiers (per mapping rows 4-5)
  "idfa", "advertising_id"
]);

const ADDRESS_FIELDS = new Set([
  "street", "city", "state", "postal_code", "country", "country_code", "region", 
  "custom_data.last_city","ip"
]);

// Helper function to validate and sanitize user identifiers for Segment
function sanitizeUserIdentifier(value) {
  if (!value) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed && trimmed !== 'undefined' && trimmed !== 'null' ? trimmed : null;
  }

  if (typeof value === 'number' && !isNaN(value)) {
    return String(value);
  }

  if (value) {
    const stringVal = String(value).trim();
    return stringVal && stringVal !== 'undefined' && stringVal !== 'null' ? stringVal : null;
  }

  return null;
}

function flattenEventValue(obj) {
  const result = {};
  let userId = null;
  let emailValue = null;
  let hasAppsflyerId = false;

  function recurse(data, parentKey = "") {
    const entries = Object.entries(data);
    for (const [key, rawVal] of entries) {
      // Track if apps_flyer_id exists
      if (key === "apps_flyer_id") {
        hasAppsflyerId = true;
      }
      // Capture email value for potential use as userId
      if (key === "email" || (key === "email" && parentKey === "custom_data")) {
        const sanitized = sanitizeUserIdentifier(rawVal);
        if (sanitized) emailValue = sanitized;
      }

      // ONLY assign userId from user_id
      if (key === "user_id") {
        const sanitized = sanitizeUserIdentifier(rawVal);
        if (sanitized) userId = sanitized;
        continue;
      }
      
      // Only ignore customer_user_id if its value is exactly "customer_id"
      if (key === "customer_user_id" && rawVal === "customer_id") {
        continue;
      }

      const value = tryParseJson(rawVal);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        // ✅ Continue flattening nested objects, but don't pass parentKey
        // This ensures we only use the leaf key names
        recurse(value, "");
      } else {
        // ✅ Always use just the key name without any parent path
        // If there's a conflict, the last occurrence will win
        result[key] = value;
      }
    }
  }

  recurse(obj);
   // If apps_flyer_id exists and we have an email, use email as userId
   if (hasAppsflyerId && emailValue && !userId) {
    userId = emailValue;
  }
  return { flattened: result, userId };
}

function parseAppsflyerData(rawBody) {
  if (typeof rawBody === 'object' && rawBody !== null) {
    return rawBody;
  }

  if (typeof rawBody === 'string') {
    try {
      return JSON.parse(rawBody);
    } catch (e) {
      console.warn('Failed to parse body as JSON:', e.message);
      return {};
    }
  }

  return {};
}

// Optimize context building with early returns and direct assignment
function buildContext(flattened) {
  const context = {};

  // App context
  if (flattened.app_id || flattened.bundle_id || flattened.api_version || flattened.app_name || flattened.app_version) {
    const app = {};
    if (flattened.app_name || flattened.app_id) app.name = flattened.app_name || flattened.app_id;
    if (flattened.bundle_id) app.namespace = flattened.bundle_id;
    if (flattened.app_version) app.version = flattened.app_version;
    if (flattened.api_version) app.build = flattened.api_version;
    context.app = app;
  }

  // Device context
  const deviceFields = ['advertising_id', 'platform', 'device_model', 'device_name', 'idfa', 'idfv', 'att', 'manufacturer'];
  const hasDeviceData = deviceFields.some(field => flattened[field] !== undefined);

  if (hasDeviceData) {
    const device = {};
    if (flattened.advertising_id || flattened.idfa) device.advertisingId = flattened.advertising_id || flattened.idfa;
    if (flattened.platform) device.type = flattened.platform;
    if (flattened.device_model) device.model = flattened.device_model;
    if (flattened.device_name) device.name = flattened.device_name;
    if (flattened.idfv) device.id = flattened.idfv;
    if (flattened.att) device.adTrackingEnabled = flattened.att === "authorized";
    if (flattened.manufacturer) device.manufacturer = flattened.manufacturer;
    context.device = device;
  }

  // Campaign context
  if (flattened.media_source || flattened.campaign || flattened.campaign_name) {
    const campaign = {};
    if (flattened.media_source) campaign.source = flattened.media_source;
    if (flattened.campaign || flattened.campaign_name) campaign.name = flattened.campaign || flattened.campaign_name;
    if (flattened.campaign_medium) campaign.medium = flattened.campaign_medium;
    if (flattened.campaign_term) campaign.term = flattened.campaign_term;
    if (flattened.campaign_content) campaign.content = flattened.campaign_content;
    context.campaign = campaign;
  }

  // OS context
  if (flattened.os_version || flattened.platform) {
    context.os = {
      name: flattened.platform === "ios" ? "iPhone OS" : flattened.platform,
      ...(flattened.os_version && { version: flattened.os_version })
    };
  }

  // Other context fields
  if (flattened.sdk_version) context.library = { name: "@segment/analytics-node", version: flattened.sdk_version };
  if (flattened.ip) context.ip = flattened.ip;
  if (flattened.selected_timezone || flattened.timezone) context.timezone = flattened.selected_timezone || flattened.timezone;
  if (flattened.locale) context.locale = flattened.locale;
  if (flattened.user_agent) context.userAgent = flattened.user_agent;

  // Screen context
  if (flattened.screen_width || flattened.screen_height || flattened.screen_density) {
    const screen = {};
    if (flattened.screen_width) screen.width = flattened.screen_width;
    if (flattened.screen_height) screen.height = flattened.screen_height;
    if (flattened.screen_density) screen.density = flattened.screen_density;
    context.screen = screen;
  }

  // Network context
  if (flattened.wifi !== undefined || flattened.carrier) {
    const network = {};
    if (flattened.wifi !== undefined) network.wifi = flattened.wifi;
    if (flattened.carrier) network.carrier = flattened.carrier;
    context.network = network;
  }

  // Location context
  if (flattened.country_code || flattened.city || flattened.region || flattened.state) {
    const location = {};
    if (flattened.country_code) location.country = flattened.country_code;
    if (flattened.city) location.city = flattened.city;
    if (flattened.region) location.region = flattened.region;
    if (flattened.state) location.state = flattened.state;
    if (flattened.postal_code) location.postalCode = flattened.postal_code;
    if (flattened.latitude) location.latitude = flattened.latitude;
    if (flattened.longitude) location.longitude = flattened.longitude;

    context.location = location;
  }

  return context;
}

// Optimize traits and properties building
function buildTraitsAndProperties(flattened) {
  const traits = {};
  const properties = {};
  const addressFields = {};

  const entries = Object.entries(flattened);
  for (let i = 0; i < entries.length; i++) {
    const [key, value] = entries[i];

    // Skip null/undefined values
    if (value === null || value === undefined) continue;

    // Handle trait fields
    if (TRAIT_FIELDS.has(key)) {
      if (ADDRESS_FIELDS.has(key)) {
        // Handle address fields - add to traits.address
        if (key === "country_code") {
          addressFields.country = value;
          traits.country = value; 
          traits.$country = value;  
        } else if (key === "postal_code") {
          addressFields.postalCode = value;
          traits.postalCode = value;  
        } else if (key === "custom_data.last_city") {
          addressFields.city = value;
          traits.city = value;  
        } else if (key === "city") {
          addressFields.city = value;
          traits.city = value;  
          traits.$city = value;  
        } else  if (key === "ip") {
          traits.ip=  value;
          traits.$ip = value;  
        } else  if (key === "state") {
          addressFields.state = value;
          traits.state = value;
        } else if (key === "region") {
          addressFields.region = value;
          traits.region = value;
        } else {
          addressFields[key] = value;
        }
      } else {
        // Map custom_data fields to standard trait names
        if (key === "custom_data.email" && value) {
          traits.email = value;
        } else if (key === "custom_data.name" && value) {
          traits.name = value;
        } else if (key === "custom_data.first_name" && value) {
          traits.first_name = value;
        } else if (key === "custom_data.last_name" && value) {
          traits.last_name = value;
        } else if (key === "custom_data.dob" && value) {
          traits.dob = value;
        } else if (key === "custom_data.gender" && value && value.trim() !== "") {
          traits.gender = value.trim();
        } else if ((key === "custom_data.mobile" || key === "custom_data.phone") && value) {
          traits.phone = value;
        } else if (key === "custom_data.latitude" && value) {
          traits.latitude = parseFloat(value);
        } else if (key === "custom_data.longitude" && value) {
          traits.longitude = parseFloat(value);
        } else if (key === "custom_data.brazeCustomerId" && value) {
          traits.brazeCustomerId = value;
        } else if (key === "install_time" && value) {
          traits.install_time = value;
        } else if (key === "device_download_time" && value) {
          traits.device_download_time = value;
        } else if (key === "gp_referrer" && value) {
          traits.gp_referrer = value;
        } else if (key === "idfa" && value) {
          traits.idfa = value;
        } else if (key === "advertising_id" && value) {
          traits.advertising_id = value;
        } else {
          // For non-custom_data fields, use as-is
          traits[key] = value;
        }
      }
    }

    // Add to properties (all non-reserved fields)
    if (!RESERVED_KEYS.has(key)) {
      // Map custom_data fields to clean property names
      if (key === "custom_data.email" && value) {
        properties.email = value;
      } else if (key === "custom_data.name" && value) {
        properties.name = value;
      } else if (key === "custom_data.first_name" && value) {
        properties.first_name = value;
      } else if (key === "custom_data.last_name" && value) {
        properties.last_name = value;
      } else if (key === "custom_data.dob" && value) {
        properties.dob = value;
      } else if (key === "custom_data.gender" && value && value.trim() !== "") {
        properties.gender = value.trim();
      } else if ((key === "custom_data.mobile" || key === "custom_data.phone") && value) {
        properties.phone = value;
      } else if (key === "custom_data.last_city" && value) {
        properties.last_city = value;
      } else if (key === "custom_data.latitude" && value) {
        properties.latitude = parseFloat(value);
      } else if (key === "custom_data.longitude" && value) {
        properties.longitude = parseFloat(value);
      } else if (key === "custom_data.brazeCustomerId" && value) {
        properties.brazeCustomerId = value;
      } else if (key.startsWith('custom_data.') && (!value || value.trim() === "")) {
        // Skip empty custom_data fields
        continue;
      } else {
        // For non-custom_data fields, keep original key
        properties[key] = value;
      }
    }
  }

  // Add address object to traits if we have address fields
  if (Object.keys(addressFields).length > 0) {
    traits.address = addressFields;
  }

  return { traits, properties };
}

// Promisify segment calls with timeout
function segmentCall(method, payload, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Segment ${method} call timed out after ${timeout}ms`));
    }, timeout);

    segment[method](payload, (err) => {
      clearTimeout(timer);
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

// -------- Optimized Lambda Handler --------
export const handler = async (event) => {
  try {
    // Parse event body - handle different input formats
    const body = event.body ? parseAppsflyerData(event.body) : event;

    // Safely parse possible nested JSON strings
    const safeParse = (val) => typeof val === "string" ? tryParseJson(val) : val;

    if (body.event_value) body.event_value = safeParse(body.event_value);
    if (body.properties) body.properties = safeParse(body.properties);

    // Flatten all nested data
    const { flattened, userId: extractedUserId } = flattenEventValue(body);

    // Sanitize and validate user identifiers
    const userId = sanitizeUserIdentifier(extractedUserId);

    // Ensure anonymousId is always a valid non-empty string
    let anonymousId = sanitizeUserIdentifier(body.appsflyer_id || flattened.appsflyer_id);
    if (!anonymousId) {
      anonymousId = `anon-${uuidv4()}`;
    }

    // Build context, traits, and properties efficiently
    const context = buildContext(flattened);
    const { traits, properties } = buildTraitsAndProperties(flattened);

    // Pre-calculate timestamp once
    const timestamp = flattened.event_time
      ? new Date(flattened.event_time).toISOString()
      : new Date().toISOString();

    // ---- Segment Forwarding with Parallel Execution ----
    if (segment) {
      const segmentPromises = [];

      // Identify call (if user info present)
      if (userId) {
        const identifyPayload = {
          ...(userId ? { userId } : {}),
          anonymousId,
          traits,
          context,
          timestamp
        };

        segmentPromises.push(
          segmentCall('identify', identifyPayload)
            .then(() => console.log("Segment Identify sent for:", userId || anonymousId))
            .catch(err => console.error("Segment Identify error:", err))
        );
      }

      // Track call
      const trackPayload = {
        event: flattened.event_name || "unknown_event",
        anonymousId,
        properties,
        context,
        traits,
        timestamp
      };

      // Only add userId if it's a valid non-empty string
      if (userId) {
        trackPayload.userId = userId;
      }

      segmentPromises.push(
        segmentCall('track', trackPayload)
          .then(() => console.log("Segment Track sent"))
          .catch(err => console.error("Segment Track error:", err))
      );

      // Execute both calls in parallel with timeout
      try {
        await Promise.allSettled(segmentPromises);
      } catch (err) {
        console.error("Segment calls error:", err);
      }
    } else {
      console.warn("Segment client not initialized—skipping forwarding.");
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        message: "Event processed and forwarded successfully",
        eventName: flattened.event_name || "unknown_event",
        userId: userId || null,
        anonymousId
      })
    };

  } catch (err) {
    console.error("Handler error:", err);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        error: "Internal server error",
        message: err.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};