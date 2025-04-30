# Webflow Form Integration Guide

This guide explains how to integrate the custom form handler to display error messages in your Webflow job application form.

## Step 1: Host the Form Handler Script

1. Upload the `formHandler.js` file to your hosting service (or use Webflow's asset manager)
2. Note the URL where the script is accessible (e.g., `https://yourdomain.com/formHandler.js`)

## Step 2: Add the Script to Your Webflow Page

1. In Webflow Designer, navigate to the page with your job application form
2. Click on the settings icon (⚙️) in the top-right corner
3. Go to the "Custom Code" section
4. Add the following code in the "Before </body> tag" field:

```html
<script src="https://yourdomain.com/formHandler.js"></script>
```

## Step 3: Add a Hidden Field for the Job ID

1. Edit your form in Webflow
2. Add a hidden input field:
   - Click the "+" button to add a new field
   - Choose "Custom" field type
   - Set the name to "job-id"
   - In field settings, choose "Hidden" visibility
   - Set the default value to your job ID (e.g., "a0wd1000000Ju6XAAS")

## Step 4: Ensure Correct Form Name

The script looks for a form with `data-name="Vacature Form"`. Make sure your form has this attribute:

1. Select your form in the Webflow Designer
2. In the "Settings" panel on the right, set the "Name" field to "Vacature Form"

## Step 5: Disable Default Webflow Redirect (Optional)

If you want to show success messages directly on the page:

1. Select your form
2. In the Settings panel, under "Redirect," select "None" instead of a success page

## Step 6: Update API Endpoint (If Needed)

Open the `formHandler.js` file and update the API endpoint to match your server:

```javascript
const apiEndpoint = '/api/candidates/apply'; // Change to your actual endpoint
```

## Step 7: Test the Form

1. Preview or publish your Webflow site
2. Fill out and submit the form
3. You should see success or error messages appear below the form

## Troubleshooting

If the form doesn't work as expected:

1. Open your browser's developer console (F12) to check for JavaScript errors
2. Verify that the form has the correct data-name attribute
3. Ensure the job-id field has the correct value
4. Confirm that the script is loaded correctly (check network tab in dev tools) 