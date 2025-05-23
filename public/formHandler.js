// Webflow form handler for job applications
// This script intercepts the Webflow form submission and sends it to our API endpoint

document.addEventListener('DOMContentLoaded', function() {
  // Select the form 
  const jobForm = document.querySelector('form[data-name="Vacature Form"]');
  
  // Create message containers if they don't exist
  let messageContainer = document.getElementById('form-message-container');
  if (!messageContainer) {
    messageContainer = document.createElement('div');
    messageContainer.id = 'form-message-container';
    messageContainer.style.display = 'none';
    messageContainer.style.padding = '15px';
    messageContainer.style.marginTop = '20px';
    messageContainer.style.borderRadius = '5px';
    if (jobForm) {
      jobForm.after(messageContainer);
    }
  }

  if (jobForm) {
    // Add submit event listener
    jobForm.addEventListener('submit', async function(event) {
      // Prevent default Webflow submission
      event.preventDefault();
      
      // Show loading state
      const submitButton = jobForm.querySelector('input[type="submit"]');
      const originalButtonText = submitButton.value;
      submitButton.value = 'Even geduld...';
      submitButton.disabled = true;
      
      try {
        // Create a proper FormData object for multipart form data (including files)
        const formData = new FormData(jobForm);
        
        // Get the job ID (hidden field with the job ID in the format 'a0wd...')
        // This assumes the job ID is in a hidden field or can be extracted from the URL
        const jobIdField = document.querySelector('input[name="mysolution-id"]') || 
                           document.querySelector('input[value^="a0w"]'); // Field with value starting with a0w
        
        if (jobIdField) {
          formData.append('job-id', jobIdField.value);
        } else {
          // Try to get job ID from URL if it's not in a hidden field
          const urlParams = new URLSearchParams(window.location.search);
          const jobIdFromUrl = urlParams.get('id');
          if (jobIdFromUrl) {
            formData.append('job-id', jobIdFromUrl);
          }
        }
        
        // Determine the API endpoint - use the production endpoint by default
        let apiEndpoint = 'https://status.baseselect.nl/api/candidates/apply';
        
        // Check if we're running in development and use the appropriate endpoint
        if (window.location.hostname === 'localhost' || window.location.hostname.includes('127.0.0.1')) {
          apiEndpoint = 'http://localhost:3000/api/candidates/apply';
        } else if (window.location.hostname.includes('webflow.io')) {
          // For Webflow staging site
          apiEndpoint = 'https://status.baseselect.nl/api/candidates/apply';
        }
        
        // Check if we have an override endpoint set by the development script
        const devEndpoint = window._mysolutionApiEndpoint;
        if (devEndpoint) {
          apiEndpoint = devEndpoint;
        }
        
        console.log('Submitting form to:', apiEndpoint);
        
        // Send the form data directly without pre-processing the file
        // This allows the file to be properly sent as multipart/form-data
        const response = await fetch(apiEndpoint, {
          method: 'POST',
          body: formData  // FormData automatically sets the correct Content-Type header
        });
        
        // Parse the JSON response
        if (!response.ok) {
          // If the response is not OK, try to parse an error message
          try {
            const errorData = await response.json();
            throw new Error(errorData.error || `Error ${response.status}: ${response.statusText}`);
          } catch (jsonError) {
            // If JSON parsing fails, throw a basic error with the HTTP status
            throw new Error(`Error ${response.status}: ${response.statusText}`);
          }
        }
        
        const result = await response.json();
        
        // Handle response
        if (result.success) {
          // Success - show success message and redirect if needed
          showMessage('Bedankt voor je sollicitatie! We nemen zo snel mogelijk contact met je op.', 'success');
          // Reset form
          jobForm.reset();
          
          // Optional: Redirect to a thank you page after a delay
          // setTimeout(() => {
          //   window.location.href = '/bedankt';
          // }, 3000);
        } else {
          // Check for duplicate application error (already applied)
          if (result.error && (
              result.error.includes('reeds een sollicitatie') || 
              result.error.includes('meermaals solliciteren') ||
              result.error.toLowerCase().includes('already applied')
            )) {
            // Special styling and message for duplicate applications
            showMessage(result.error, 'warning');
          } else {
            // Regular error - show error message from API
            showMessage(result.error || 'Er is een fout opgetreden. Probeer het later nog eens.', 'error');
          }
        }
      } catch (error) {
        console.error('Error submitting form:', error);
        showMessage('Er is een fout opgetreden bij het verzenden van het formulier. Probeer het later nog eens.', 'error');
      } finally {
        // Reset button state
        submitButton.value = originalButtonText;
        submitButton.disabled = false;
      }
    });
  }
  
  // Helper function to show messages
  function showMessage(message, type) {
    const messageContainer = document.getElementById('form-message-container');
    if (messageContainer) {
      messageContainer.textContent = message;
      messageContainer.style.display = 'block';
      
      if (type === 'success') {
        messageContainer.style.backgroundColor = '#e7f7e3';
        messageContainer.style.color = '#2e7124';
        messageContainer.style.border = '1px solid #c3e6cb';
      } else if (type === 'warning') {
        // Special styling for duplicate applications (yellow/orange warning)
        messageContainer.style.backgroundColor = '#fff3cd';
        messageContainer.style.color = '#856404';
        messageContainer.style.border = '1px solid #ffeeba';
      } else if (type === 'error') {
        messageContainer.style.backgroundColor = '#f8d7da';
        messageContainer.style.color = '#721c24';
        messageContainer.style.border = '1px solid #f5c6cb';
      }
      
      // Scroll to message
      messageContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}); 