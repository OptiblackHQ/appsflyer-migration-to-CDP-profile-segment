AWS Lambda Function Setup (Node.js – index.mjs)

This project contains a simple AWS Lambda function using Node.js (ES Modules) with:

index.mjs – Lambda handler file

package.json – Project configuration

📁 Project Structure
lambda-function/
│
├── index.mjs
└── package.json
1️⃣ index.mjs (Lambda Handler)

⚠️ "type": "module" is required in package.json to use .mjs and ES module syntax.

🚀 Setup & Deployment Guide
Step 1: Create Project Folder
mkdir lambda-function
cd lambda-function

Add:

index.mjs

package.json

Step 2: Open in VS Code

Open VS Code

Click File → Open Folder

Select the lambda-function folder

OR from terminal:

code .
Step 3: Install Dependencies (If Any)

If your project uses external libraries:

npm install

This creates a node_modules folder.

If no external dependencies are used, this step is not required.

Step 4: Zip the Project

⚠️ Important:
You must zip the contents, not the parent folder.

Correct structure inside zip:

index.mjs
package.json
node_modules (if exists)
On Windows:

Select:

index.mjs

package.json

node_modules (if exists)

Right click → Send to → Compressed (zipped) folder

Rename to:

lambda-function.zip
☁️ Upload to AWS Lambda

Go to:

👉 https://console.aws.amazon.com/lambda/

Step 5: Create Lambda Function

Click Create function

Choose Author from scratch

Function name: your-function-name

Runtime: Node.js 18.x (Recommended)

Click Create function

Step 6: Upload Zip File

Go to Code tab

Click Upload from → .zip file

Upload lambda-function.zip

Click Deploy

Step 7: Set Handler Correctly

Since your file is:

index.mjs

Your handler must be:

index.handler

Check this under:

👉 Runtime settings → Edit

✅ Testing the Lambda

Click Test

Create new test event

Use default template

Click Test

You should see:

{
  "message": "Lambda function executed successfully"
}
🌍 Environment Variables (SEGMENT_WRITE_KEY)

This Lambda requires the following environment variable:

SEGMENT_WRITE_KEY

This key is used to send events to Segment (Customer Data Platform).

🔎 How to Find SEGMENT_WRITE_KEY in Segment

Login to Segment:
👉 https://app.segment.com

Select your Workspace

Click Connections

Click Sources

Select your Source (Example: HTTP API, Website, etc.)

If you don’t have one:

Click Add Source

Choose HTTP API

Create new source

Go to:
Settings → API Keys

Copy the value labeled:

Write Key

That is your SEGMENT_WRITE_KEY.

⚠️ Keep this secret. Do NOT commit it to GitHub.

☁️ Add Environment Variable in AWS Lambda

Open your Lambda function in AWS

Go to Configuration

Click Environment variables

Click Edit

Click Add environment variable

Add:

Key	Value
SEGMENT_WRITE_KEY	your_actual_write_key

Click Save

🧠 Access Environment Variable in index.mjs
const segmentWriteKey = process.env.SEGMENT_WRITE_KEY;

if (!segmentWriteKey) {
  throw new Error("SEGMENT_WRITE_KEY is not defined");
}
⚙️ Common Issues
❌ Error: Cannot find module

Make sure node_modules is included in the zip

Run npm install before zipping

❌ Handler not found

Ensure handler is:

index.handler
❌ ES Module error

Ensure "type": "module" is inside package.json

❌ Segment key undefined

Make sure:

Environment variable is added

Lambda is redeployed after saving

Key name is exactly: SEGMENT_WRITE_KEY

📌 Notes

Recommended runtime: Node.js 18.x or later

Always zip the files inside the folder, not the folder itself

Never hardcode API keys

Use Lambda environment variables for secrets

Make sure file names match exactly (case-sensitive)