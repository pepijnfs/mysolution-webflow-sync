import { logger } from '../utils/logger.js';
import mysolutionAPI from '../api/mysolution.js';
import { transformWebflowToMysolution } from '../models/candidatesTransformer.js';

// Track recent submissions to prevent duplicate processing
const recentSubmissions = new Map();
const SUBMISSION_CACHE_TIME = 3 * 60 * 1000; // 3 minutes

/**
 * Process new candidate application from Webflow
 * @param {Object} formData - The form submission data from Webflow
 * @returns {Object} - Result of the candidate creation
 */
async function processNewCandidate(formData) {
  try {
    // Generate a simple hash for the form data to detect duplicates
    const submissionHash = generateSubmissionHash(formData);
    
    // Check if this is a duplicate submission (prevent refresh loops)
    const now = Date.now();
    if (recentSubmissions.has(submissionHash)) {
      const cachedSubmission = recentSubmissions.get(submissionHash);
      if (now - cachedSubmission.timestamp < SUBMISSION_CACHE_TIME) {
        logger.warn('Duplicate candidate submission detected, skipping processing', {
          cache: 'hit',
          hash: submissionHash.substring(0, 8)
        });
        return cachedSubmission.result;
      }
    }
    
    // Only log essential fields, not the entire form data
    logger.info('Processing new candidate application from Webflow', {
      formFields: Object.keys(formData)
    });
    
    // Extract job ID if present - check all possible field names
    const jobId = formData['job-id'] || 
                 formData['mysolution-job-id'] || 
                 formData['mysolution-id'] || 
                 formData['jobId'] || 
                 formData['vacancy-id'] || 
                 formData['vacancy_id'] || 
                 formData['job-vacancy-id'] || 
                 formData['jobvacancyid'] || 
                 null;
    
    // Log the job ID if found
    let result;
    if (jobId) {
      logger.info(`Found job ID in form data: ${jobId}`);
      // If job ID is present, use the job application process
      result = await processJobApplication(jobId, formData);
    } else {
      logger.warn('No job ID found in form data. Will attempt standalone candidate creation.');
      
      // Check if basic required fields are present
      if (!formData['email'] && !formData['Email'] && !formData['e-mail']) {
        result = {
          success: false,
          error: 'Missing required field: email'
        };
        logger.error('Missing required field: email');
      } else if ((!formData['first-name'] && !formData['First-Name'] && !formData['name'] && !formData['Name']) ||
          (!formData['last-name'] && !formData['Last-Name'] && !formData['achternaam'] && !formData['surname'])) {
        result = {
          success: false,
          error: 'Missing required fields: first name or last name'
        };
        logger.error('Missing required fields: first name or last name');
      } else {
        // Transform Webflow form data to Mysolution format
        try {
          const transformedData = transformWebflowToMysolution(formData);
          logger.info('Successfully transformed form data to Mysolution format');
          
          // For standalone candidate creation (no job application)
          try {
            logger.info('Attempting to create standalone candidate without job application');
            const candidateResult = await mysolutionAPI.createApplication(transformedData, 'default');
            result = {
              success: true,
              message: 'Candidate created successfully',
              data: candidateResult
            };
          } catch (apiError) {
            logger.error('Error creating standalone candidate:', {
              error: apiError.message
            });
            result = {
              success: false,
              error: `Failed to create standalone candidate: ${apiError.message}`
            };
          }
        } catch (transformError) {
          logger.error('Error transforming candidate data:', {
            error: transformError.message
          });
          result = {
            success: false,
            error: `Failed to transform candidate data: ${transformError.message}`
          };
        }
      }
    }
    
    // Cache this submission to prevent duplicate processing
    recentSubmissions.set(submissionHash, {
      timestamp: now,
      result: result
    });
    
    // Clean up old cache entries
    cleanupSubmissionCache();
    
    return result;
  } catch (error) {
    logger.error('Error processing new candidate:', {
      error: error.message
    });
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Generate a simple hash for form data to detect duplicates
 * @param {Object} formData - The form data to hash
 * @returns {string} A hash string representing the form data
 */
function generateSubmissionHash(formData) {
  // Create a string from the key fields that would make a submission unique
  // Start with email as it's likely to be unique per person
  const email = formData['email'] || formData['Email'] || formData['e-mail'] || '';
  const firstName = formData['first-name'] || formData['First-Name'] || formData['name'] || formData['Name'] || '';
  const lastName = formData['last-name'] || formData['Last-Name'] || formData['achternaam'] || formData['surname'] || '';
  const jobId = formData['job-id'] || formData['mysolution-job-id'] || formData['mysolution-id'] || '';
  
  // Combine key fields into a string
  const uniqueString = `${email}-${firstName}-${lastName}-${jobId}`;
  
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < uniqueString.length; i++) {
    const char = uniqueString.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  // Return as hexadecimal string
  return hash.toString(16);
}

/**
 * Clean up old submission cache entries
 */
function cleanupSubmissionCache() {
  const now = Date.now();
  for (const [hash, data] of recentSubmissions.entries()) {
    if (now - data.timestamp > SUBMISSION_CACHE_TIME) {
      recentSubmissions.delete(hash);
    }
  }
}

/**
 * Update existing candidate in Mysolution based on Webflow form data
 * @param {string} candidateId - The ID of the existing candidate
 * @param {Object} formData - Updated form data from Webflow
 * @returns {Object} - Result of the update operation
 */
async function updateCandidate(candidateId, formData) {
  try {
    logger.info(`Updating candidate ${candidateId} in Mysolution`);
    
    // Transform Webflow form data to Mysolution format
    const transformedData = transformWebflowToMysolution(formData);
    
    // Update candidate in Mysolution
    // Note: This is not currently implemented in the Mysolution API
    logger.warn('Candidate updates are not yet implemented in the Mysolution API');
    
    return {
      success: false,
      error: 'Candidate updates are not currently supported'
    };
  } catch (error) {
    logger.error(`Error updating candidate ${candidateId}:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Process a candidate application for a specific job
 * @param {string} jobId - The ID of the job being applied to
 * @param {Object} formData - The candidate's application form data
 * @returns {Object} - Result of the application process
 */
async function processJobApplication(jobId, formData) {
  try {
    // Ensure jobId is defined and not empty
    if (!jobId) {
      logger.error('Job ID is required but was not provided');
      return {
        success: false,
        error: 'Job ID is required for job application'
      };
    }
    
    logger.info(`Processing job application for job ${jobId}`);
    
    // Transform Webflow form data to Mysolution format
    // Note: We no longer need to include the jobId in the fields as it will be passed separately
    const transformedFields = transformWebflowToMysolution(formData);
    
    // Send application directly to Mysolution API
    logger.info(`Submitting application to Mysolution for job ${jobId}`);
    
    try {
      // First try regular job application
      try {
        // The second parameter is setApiName, the third parameter is the jobId
        const result = await mysolutionAPI.createApplication(
          transformedFields,   // Transformed fields for payload
          'default',           // Use 'default' as setApiName based on our successful test
          jobId                // Job ID for URL parameter
        );
        
        return {
          success: true,
          message: 'Application submitted successfully',
          data: result
        };
      } catch (regularJobError) {
        // If regular application fails, it might be a publication
        if (regularJobError.message.includes('not found') || 
            regularJobError.message.includes('List has no rows') || 
            regularJobError.message.includes('Id is missing')) {
          
          // Try to apply to it as a publication
          logger.info(`Regular job application failed. Trying as publication: ${jobId}`);
          
          const publicationResult = await mysolutionAPI.applyToPublication(
            transformedFields,
            jobId,
            'default'  // Use 'default' as setApiName for publication attempts too
          );
          
          return {
            success: true,
            message: 'Application to publication submitted successfully',
            data: publicationResult
          };
        } else {
          // Some other error occurred
          throw regularJobError;
        }
      }
    } catch (apiError) {
      logger.error(`API error when submitting application to job ${jobId}:`, apiError);
      return {
        success: false,
        error: apiError.message
      };
    }
  } catch (error) {
    logger.error(`Error processing job application for job ${jobId}:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

export {
  processNewCandidate,
  updateCandidate,
  processJobApplication
}; 