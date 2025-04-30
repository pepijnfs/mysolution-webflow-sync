// Job Application API Test
const axios = require('axios');
const fs = require('fs');

// Configuration
const baseUrl = 'https://base-select.my.salesforce.com';
const clientId = '3MVG94DAZekw5HcunvGlLqJJ4rBv9PMN641_5kSrYVOoxOBwZ9uJZswvupGm1Q_ZMEEcOprlFIotF9sHxemV9';
const clientSecret = '6F5D5D8EC922A62FC2B23CA2FA4C928B4FAAE15072E84584227E0C0B07364DA2';
const jobId = 'a0w7Q000000qSuYQAU'; // Replace with actual job ID

// Sample CV file - should be replaced with actual file path
const cvFilePath = './testcv.pdf';

// Test domains
const testDomains = [
  '', // Empty to test default behavior
  'salesforce.com',
  'base-select.my.salesforce.com',
  'mysolution'
];

// Get auth token
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
    // Return empty string if file not found (for testing purposes)
    return '';
  }
}

// Submit job application
async function submitJobApplication(token, domain) {
  const cvBase64 = encodeFileToBase64(cvFilePath);
  
  const requestBody = {
    setApiName: 'jobbird',
    fields: {
      EMail: {
        value: 'test@example.com'
      },
      FirstName: {
        value: 'John'
      },
      MiddleName: {
        value: 'M'
      },
      LastName: {
        value: 'Doe'
      },
      MobilePhone: {
        value: '0611223344'
      },
      Motivation: {
        value: 'I am very interested in this position'
      },
      CV: {
        fileName: 'testcv.pdf',
        value: cvBase64
      }
    },
    // Optional UTM fields
    utm_campaign: 'test-campaign',
    utm_medium: 'test-medium',
    utm_source: 'test-source',
    utm_content: 'test-content',
    utm_term: 'test-term',
    // Optional status
    status: 'Application',
    // Optional external source flag
    isExternalSource: false
  };
  
  try {
    const queryParams = { id: jobId };
    if (domain) {
      queryParams.domain = domain;
    }
    
    const response = await axios({
      method: 'POST',
      url: `${baseUrl}/services/apexrest/msf/api/job/Apply`,
      params: queryParams,
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

// Run tests for all domains
async function runTests() {
  try {
    console.log('Getting authorization token...');
    const token = await getToken();
    console.log('Token acquired successfully');
    
    for (const domain of testDomains) {
      console.log(`\n--- Testing with domain: "${domain || 'EMPTY'}" ---`);
      const result = await submitJobApplication(token, domain);
      console.log('Result:', JSON.stringify(result, null, 2));
    }
    
    console.log('\nAll tests completed');
  } catch (error) {
    console.error('Test execution failed:', error);
  }
}

// Execute tests
runTests(); 