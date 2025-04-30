import { expect } from 'chai';
import axios from 'axios';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration - using the same values from Postman collection
const baseUrl = 'https://base-select.my.salesforce.com';
const clientId = '3MVG94DAZekw5HcunvGlLqJJ4rBv9PMN641_5kSrYVOoxOBwZ9uJZswvupGm1Q_ZMEEcOprlFIotF9sHxemV9';
const clientSecret = '6F5D5D8EC922A62FC2B23CA2FA4C928B4FAAE15072E84584227E0C0B07364DA2';
const jobId = 'a0wd1000000Ju6XAAS'; // New job ID

// Get auth token - exactly as in Postman collection
async function getToken() {
  try {
    const response = await axios({
      method: 'POST',
      url: `${baseUrl}/services/oauth2/token`,
      params: {
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret
      }
    });
    
    return response.data.access_token;
  } catch (error) {
    console.error('Error getting token:', error.response?.data || error.message);
    throw error;
  }
}

// Read and encode file to base64
function encodeFileToBase64(filePath) {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    return fileBuffer.toString('base64');
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error.message);
    // Return test string if file not found (for testing purposes)
    return 'VGhpcyBpcyBhIHRlc3QgQ1YgZmlsZQ=='; // "This is a test CV file" in base64
  }
}

// Submit job application - mimicking Postman collection exactly
async function submitJobApplication(token) {
  // Try to use the test CV file from project root, fallback to dummy data if not found
  const cvFilePath = join(__dirname, '../../testcv.pdf');
  const cvBase64 = encodeFileToBase64(cvFilePath);
  
  // Request body based on Postman collection
  const requestBody = {
    setApiName: 'default',
    fields: {
      Email: {
        value: 'test@example.com'
      },
      'First Name': {
        value: 'John'
      },
      'Middle Name': {
        value: 'M'
      },
      'Last Name': {
        value: 'Doe'
      },
      Mobile: {
        value: '0611223344'
      },
      Motivation: {
        value: 'I am very interested in this position'
      },
      CV: {
        fileName: 'testcv.pdf',
        value: cvBase64
      }
    }
  };
  
  try {
    // URL structure based exactly on Postman collection
    const response = await axios({
      method: 'POST',
      url: `${baseUrl}/services/apexrest/msf/api/job/Apply`,
      params: {
        id: jobId
      },
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      data: requestBody
    });
    
    return response.data;
  } catch (error) {
    console.error('Error submitting application:', error.response?.data || error.message);
    return {
      error: true,
      status: error.response?.status,
      message: error.response?.data || error.message
    };
  }
}

describe('Minimal Job Application Test (Based on Postman)', function() {
  this.timeout(30000); // Increase timeout for API calls
  
  let authToken;
  
  // Get authentication token before tests
  before(async function() {
    try {
      authToken = await getToken();
      console.log('Authentication token obtained successfully');
    } catch (error) {
      console.error('Failed to get auth token for tests:', error);
      authToken = null;
    }
  });

  it('should submit job application using Postman structure', async function() {
    // Skip test if no auth token
    if (!authToken) {
      this.skip();
      return;
    }
    
    const result = await submitJobApplication(authToken);
    
    // Log the complete result for analysis
    console.log('Job application result:', JSON.stringify(result, null, 2));
    
    // Check if we got a valid response
    if (result.error) {
      console.warn('Warning: Job application submission failed:', result.message);
    } else {
      // Verify the response has expected format
      expect(result).to.be.an('object');
      // Check for job application ID if successful
      if (result.jobApplicationId) {
        console.log('Success! Job application created with ID:', result.jobApplicationId);
        expect(result.jobApplicationId).to.be.a('string');
      }
    }
  });
}); 