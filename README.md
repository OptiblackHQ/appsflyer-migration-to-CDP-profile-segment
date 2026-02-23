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

⚠️ "type": "module" is required to use .mjs and ES module syntax.

🚀 Setup & Deployment Guide
Step 1: Create Project Folder

Create a new folder:

mkdir lambda-function
cd lambda-function

Add:

index.mjs

package.json

Step 2: Open in VS Code

Open VS Code.

Click File → Open Folder

Select the lambda-function folder.

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

Choose:

Author from scratch

Function name: your-function-name

Runtime:
Node.js 18.x (Recommended)

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
⚙️ Common Issues
❌ Error: Cannot find module

Make sure node_modules is included in the zip.

Run npm install before zipping.

❌ Handler not found

Ensure handler is:

index.handler
❌ ES Module error

Ensure "type": "module" is inside package.json.

📌 Notes

Recommended runtime: Node.js 18.x or later

Always zip the files inside the folder, not the folder itself.

Make sure file names match exactly (case-sensitive).

If you want, I can also create:

A version with API Gateway integration

A version with environment variables setup

A version for Segment / Mixpanel webhook handling

A ready-to-copy production README template