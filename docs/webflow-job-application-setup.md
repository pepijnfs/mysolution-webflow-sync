# Webflow Job Application Form Setup

This document provides instructions for setting up job application forms in Webflow that will integrate with Mysolution's ATS.

## Form Requirements

To ensure proper submission handling, your Webflow job application form must include:

1. A hidden field for the Mysolution Job ID
2. Basic candidate information fields
3. File upload for CV/resume (optional)
4. Proper form submission configuration

## Form Configuration Steps

### 1. Create the Form in Webflow

Create a form in Webflow with the following fields:

#### Required Fields:
- First Name (Text field, name: `first-name`)
- Last Name (Text field, name: `last-name`)
- Email (Email field, name: `email`)
- Phone (Text field, name: `phone`)
- CV/Resume (File upload field, name: `cv`, formats: PDF, DOC, DOCX, TXT)

#### Hidden Field (CRITICAL):
- Mysolution Job ID (Hidden field, name: `mysolution-id`)

### 2. Configure the Form Name

Set the form name to include the word "application" (e.g., "job-application" or "vacancy-application").

### 3. Set Form Action URL

Configure the form to submit to our API endpoint:

- Form Action: `https://your-api-domain.com/api/webhooks/webflow/form`
- Method: `POST`
- Encoding Type: `multipart/form-data` (important for file uploads)

### 4. Set the Job ID Dynamically

In your Webflow site, you need to set the hidden field's value to the Mysolution Job ID:

1. In your job detail page template:
   - Add a custom attribute to the form: `data-job-id="{{jobID}}"` 
   - Where `{{jobID}}` is the CMS field for the Mysolution Job ID

2. Add this JavaScript to your site to populate the hidden field:

```javascript
document.addEventListener('DOMContentLoaded', function() {
  // Get all job application forms
  const applicationForms = document.querySelectorAll('form[data-job-id]');
  
  applicationForms.forEach(form => {
    // Get the job ID from the form's data attribute
    const jobId = form.getAttribute('data-job-id');
    
    // Find the hidden job ID field
    const hiddenJobIdField = form.querySelector('input[name="mysolution-id"]');
    
    // Set the job ID value
    if (hiddenJobIdField && jobId) {
      hiddenJobIdField.value = jobId;
    }
  });
});
```

## Testing Your Form

After setting up the form:

1. Submit a test application with dummy data
2. Check server logs to ensure proper submission receipt
3. Verify in Mysolution that the application was received

## Troubleshooting

Common issues:

- **Missing Job ID**: Ensure the hidden field is properly populated with the Mysolution Job ID
- **File Upload Issues**: Verify form encoding is set to `multipart/form-data`
- **Field Mapping Problems**: Make sure field names match the expected names

## API Response Codes

- `200 OK`: Application processed successfully
- `400 Bad Request`: Invalid form data or missing required fields
- `500 Server Error`: Server-side processing error

## Contact

For assistance, please contact:
- Technical support: [support@yourdomain.com](mailto:support@yourdomain.com)
- Webhook status check: https://your-api-domain.com/api/webhooks/status 