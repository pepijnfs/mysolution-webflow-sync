import webflowAPI from '../api/webflow.js';
import { transformMysolutionToWebflow } from '../models/jobsTransformer.js';
import { logger } from '../utils/logger.js';
import publishingService from './publishingService.js';

/**
 * Create a job in Webflow based on Mysolution job data
 * @param {Object} mysolutionJob - The job data from Mysolution
 * @param {Object} options - Creation options
 * @param {boolean} options.publishChanges - Whether to publish changes after creation (defaults to global setting)
 * @returns {Promise<Object>} The created job in Webflow
 * @throws {Error} If job creation fails
 */
export async function createJob(mysolutionJob, options = {}) {
  try {
    // Validate required fields
    if (!mysolutionJob || !mysolutionJob.id) {
      throw new Error('Invalid job data - missing ID');
    }

    // Check if job already exists in Webflow based on Mysolution ID
    const exists = await webflowAPI.jobExistsByMysolutionId(mysolutionJob.id);
    if (exists) {
      logger.warn(`Job with Mysolution ID ${mysolutionJob.id} already exists in Webflow`);
      throw new Error(`Duplicate job - Mysolution ID ${mysolutionJob.id} already exists`);
    }

    // Transform Mysolution job to Webflow format
    const webflowJobData = transformMysolutionToWebflow(mysolutionJob);

    // Create job in Webflow
    logger.info(`Creating job in Webflow: ${webflowJobData.name} (Mysolution ID: ${mysolutionJob.id})`);
    const createdJob = await webflowAPI.createJob(webflowJobData);

    logger.info(`Job created successfully: ${createdJob.id}`);

    // Publish changes if requested
    if (options.publishChanges !== false) {
      await publishingService.publishIfEnabled(`Job creation: ${createdJob.name} (${mysolutionJob.id})`);
    }

    return createdJob;
  } catch (error) {
    logger.error(`Failed to create job in Webflow: ${error.message}`, { 
      mysolutionJobId: mysolutionJob?.id,
      error: error.stack 
    });
    throw error;
  }
}

/**
 * Create multiple jobs in Webflow from a list of Mysolution jobs
 * @param {Array<Object>} mysolutionJobs - List of Mysolution job data
 * @param {Object} options - Creation options
 * @param {boolean} options.publishChanges - Whether to publish changes after all creations
 * @returns {Promise<Object>} Results of batch job creation
 */
export async function createJobs(mysolutionJobs, options = {}) {
  if (!Array.isArray(mysolutionJobs)) {
    throw new Error('Jobs must be provided as an array');
  }

  const results = {
    successful: [],
    failed: [],
    duplicates: []
  };

  // Disable individual publishing for batch operations if we're going to publish at the end
  const batchOptions = {
    ...options,
    publishChanges: false // Don't publish after each creation in a batch
  };

  for (const job of mysolutionJobs) {
    try {
      // Check if job already exists to avoid duplicate errors
      const exists = await webflowAPI.jobExistsByMysolutionId(job.id);
      
      if (exists) {
        logger.info(`Skipping duplicate job with Mysolution ID: ${job.id}`);
        results.duplicates.push({
          mysolutionId: job.id,
          reason: 'Job already exists in Webflow'
        });
        continue;
      }

      // Create the job
      const createdJob = await createJob(job, batchOptions);
      results.successful.push({
        mysolutionId: job.id,
        webflowId: createdJob.id
      });
    } catch (error) {
      logger.error(`Failed to create job ${job.id}: ${error.message}`);
      results.failed.push({
        mysolutionId: job.id,
        error: error.message
      });
    }
  }

  // Publish all changes at once after batch creation if requested
  if (options.publishChanges !== false && results.successful.length > 0) {
    try {
      await publishingService.publishIfEnabled(`Batch job creation: ${results.successful.length} jobs created`);
    } catch (error) {
      logger.error('Failed to publish changes after batch job creation', {
        error: error.message,
        stack: error.stack
      });
      // Don't throw the error - we successfully created the jobs, publishing is secondary
    }
  }

  logger.info(`Batch job creation complete: ${results.successful.length} created, ${results.failed.length} failed, ${results.duplicates.length} duplicates`);
  return results;
}

/**
 * Create or update a job in Webflow by Mysolution ID
 * @param {Object} mysolutionJob - The job data from Mysolution
 * @param {Object} options - Creation/update options
 * @param {boolean} options.publishChanges - Whether to publish changes after creation/update
 * @returns {Promise<Object>} The created or updated job in Webflow
 */
export async function createOrUpdateJob(mysolutionJob, options = {}) {
  try {
    if (!mysolutionJob || !mysolutionJob.id) {
      throw new Error('Invalid job data - missing ID');
    }

    // Transform job data to Webflow format
    const webflowJobData = transformMysolutionToWebflow(mysolutionJob);
    
    // Use the existing API method to create or update job
    const result = await webflowAPI.createOrUpdateJobByMysolutionId(
      mysolutionJob.id, 
      webflowJobData
    );
    
    logger.info(`Job ${result.action === 'created' ? 'created' : 'updated'} in Webflow: ${result.job.id}`);
    
    // Publish changes if requested
    if (options.publishChanges !== false) {
      await publishingService.publishIfEnabled(
        `Job ${result.action}: ${result.job.name} (${mysolutionJob.id})`
      );
    }
    
    return result;
  } catch (error) {
    logger.error(`Failed to create/update job in Webflow: ${error.message}`, {
      mysolutionJobId: mysolutionJob?.id,
      error: error.stack
    });
    throw error;
  }
} 