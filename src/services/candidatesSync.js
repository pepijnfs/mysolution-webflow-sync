import { logger } from '../utils/logger.js';
import mysolutionAPI from '../api/mysolution.js';
import { transformWebflowToMysolution } from '../models/candidatesTransformer.js';

/**
 * Process new candidate application from Webflow
 * @param {Object} formData - The form submission data from Webflow
 * @returns {Object} - Result of the candidate creation
 */
async function processNewCandidate(formData) {
  try {
    logger.info('Processing new candidate application from Webflow');
    
    // Extract job ID if present
    const jobId = formData['job-id'] || null;
    
    // Transform Webflow form data to Mysolution format
    const transformedData = transformWebflowToMysolution(formData, jobId);
    
    // Create candidate in Mysolution
    logger.info('Creating candidate in Mysolution');
    const candidateResult = await mysolutionAPI.createCandidate(transformedData.candidate);
    
    // If job ID is present, create application
    if (jobId && transformedData.application) {
      logger.info(`Creating application for job ${jobId}`);
      
      // Update application with the newly created candidate ID
      const applicationData = {
        ...transformedData.application,
        candidateId: candidateResult.id
      };
      
      // Create application in Mysolution
      const applicationResult = await mysolutionAPI.createApplication(applicationData);
      
      return {
        success: true,
        candidate: candidateResult,
        application: applicationResult
      };
    }
    
    return {
      success: true,
      candidate: candidateResult
    };
  } catch (error) {
    logger.error('Error processing new candidate:', error);
    return {
      success: false,
      error: error.message
    };
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
    const result = await mysolutionAPI.updateCandidate(candidateId, transformedData.candidate);
    
    return {
      success: true,
      candidate: result
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
    logger.info(`Processing job application for job ${jobId}`);
    
    // Add job ID to form data
    const applicationData = {
      ...formData,
      'job-id': jobId
    };
    
    // Use the processNewCandidate function to handle the application
    return await processNewCandidate(applicationData);
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