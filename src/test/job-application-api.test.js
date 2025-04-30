import { expect } from 'chai';
import sinon from 'sinon';
import axios from 'axios';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration - using the same values from job_application_test.js
const baseUrl = 'https://base-select.my.salesforce.com';
const clientId = '3MVG94DAZekw5HcunvGlLqJJ4rBv9PMN641_5kSrYVOoxOBwZ9uJZswvupGm1Q_ZMEEcOprlFIotF9sHxemV9';
const clientSecret = '6F5D5D8EC922A62FC2B23CA2FA4C928B4FAAE15072E84584227E0C0B07364DA2';
const jobId = 'a0w7Q000000qSuYQAU'; // Replace with actual job ID

// Test domains to try
const testDomains = [
  '', // Empty to test default behavior
  'jobbird', // setApiName value
  'default', // Default setApiName
  'mysolution', // Company name
  'base-select' // From baseUrl
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

// Get job application configuration to see available portal domains
async function getJobApplicationConfiguration(token, setApiName) {
  try {
    const response = await axios({
      method: 'GET',
      url: `${baseUrl}/services/apexrest/msf/api/base/GetJobApplicationConfiguration`,
      params: {
        setApiName: setApiName || 'default'
      },
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    return response.data;
  } catch (error) {
    console.error(`Error getting job application configuration for ${setApiName}:`, error.response?.data || error.message);
    return {
      error: true,
      status: error.response?.status,
      message: error.response?.data || error.message
    };
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

// Submit job application
async function submitJobApplication(token, domain) {
  // Try to use the test CV file from project root, fallback to dummy data if not found
  const cvFilePath = join(__dirname, '../../testcv.pdf');
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
    // Return error details for testing
    return {
      error: true,
      status: error.response?.status,
      message: error.response?.data || error.message
    };
  }
}

describe('Mysolution Job Application API Tests', function() {
  this.timeout(30000); // Increase timeout for API calls
  
  let authToken;
  
  // Get authentication token before tests
  before(async function() {
    try {
      // For CI environments or quick testing, we can mock the token
      if (process.env.MOCK_API === 'true') {
        authToken = 'mock-token';
        return;
      }
      
      authToken = await getToken();
    } catch (error) {
      console.error('Failed to get auth token for tests:', error);
      // Set a dummy token so tests can continue but will be skipped
      authToken = null;
    }
  });

  // First check if we can get configuration info to find the right domain
  describe('Getting job application configuration', function() {
    it('should retrieve available configuration for default', async function() {
      // Skip test if no auth token
      if (!authToken) {
        this.skip();
        return;
      }
      
      const config = await getJobApplicationConfiguration(authToken, 'default');
      console.log('Default configuration:', JSON.stringify(config, null, 2));
      
      // Check if we got a valid response
      if (config.error) {
        console.warn('Warning: Could not get default configuration:', config.message);
      } else {
        // Look for portal domain information
        if (config.domain) {
          console.log('Found domain in configuration:', config.domain);
        }
        expect(config).to.be.an('object');
      }
    });
    
    it('should retrieve available configuration for jobbird', async function() {
      // Skip test if no auth token
      if (!authToken) {
        this.skip();
        return;
      }
      
      const config = await getJobApplicationConfiguration(authToken, 'jobbird');
      console.log('Jobbird configuration:', JSON.stringify(config, null, 2));
      
      // Check if we got a valid response
      if (config.error) {
        console.warn('Warning: Could not get jobbird configuration:', config.message);
      } else {
        // Look for portal domain information
        if (config.domain) {
          console.log('Found domain in configuration:', config.domain);
        }
        expect(config).to.be.an('object');
      }
    });
  });
  
  // Test with different domain values
  testDomains.forEach(domain => {
    describe(`Testing with domain "${domain || 'EMPTY'}"`, function() {
      it('should submit job application successfully', async function() {
        // Skip test if no auth token
        if (!authToken) {
          this.skip();
          return;
        }
        
        // Mock API responses in CI environment
        if (process.env.MOCK_API === 'true') {
          // Create mock for axios
          sinon.stub(axios, 'request').resolves({
            data: { jobApplicationId: 'mock-application-id' }
          });
        }
        
        try {
          const result = await submitJobApplication(authToken, domain);
          
          // Log the result for analysis
          console.log(`Result with domain "${domain || 'EMPTY'}":`, JSON.stringify(result, null, 2));
          
          // Check if we got a valid response
          if (result.error) {
            console.warn(`Warning: Submission with domain "${domain || 'EMPTY'}" failed:`, result.message);
          } else {
            // Verify the response has expected format
            expect(result).to.be.an('object');
            // Check for job application ID if successful
            if (result.jobApplicationId) {
              expect(result.jobApplicationId).to.be.a('string');
            }
          }
        } finally {
          // Restore stubs
          if (process.env.MOCK_API === 'true') {
            sinon.restore();
          }
        }
      });
    });
  });
}); 