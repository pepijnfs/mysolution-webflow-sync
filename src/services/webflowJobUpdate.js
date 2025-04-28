import webflowAPI from '../api/webflow.js';
import { transformMysolutionToWebflow } from '../models/jobsTransformer.js';
import { logger } from '../utils/logger.js';
import publishingService from './publishingService.js';

/**
 * Default field merge strategy
 * @type {Object}
 */
export const DEFAULT_MERGE_STRATEGY = {
  // Fields that should always be updated from Mysolution
  alwaysUpdate: [
    'job-id', 
    'job-status',
    'job-description',
    'job-responsibilities',
    'job-requirements'
  ],
  
  // Fields that should only be updated if they haven't been modified in Webflow
  updateIfUnchanged: [
    'name',
    'slug',
    'job-location',
    'job-employment-type',
  ],
  
  // Fields that should never be updated from Mysolution (Webflow-specific)
  neverUpdate: [
    'job-is-featured',
    'job-webflow-notes'
  ]
};

/**
 * Check if a job exists in Webflow by Mysolution ID
 * @param {string} mysolutionId - Mysolution job ID to check
 * @returns {Promise<Object|null>} The job if found, null otherwise
 */
export async function findJobByMysolutionId(mysolutionId) {
  try {
    if (!mysolutionId) {
      throw new Error('Mysolution job ID is required');
    }
    
    const job = await webflowAPI.findJobByMysolutionId(mysolutionId);
    return job;
  } catch (error) {
    logger.error(`Error finding job with Mysolution ID ${mysolutionId}: ${error.message}`);
    throw error;
  }
}

/**
 * Update an existing job in Webflow
 * @param {string} webflowJobId - Webflow job ID to update
 * @param {Object} jobData - New job data to apply
 * @returns {Promise<Object>} Updated job data
 */
export async function updateWebflowJob(webflowJobId, jobData) {
  try {
    if (!webflowJobId) {
      throw new Error('Webflow job ID is required');
    }
    
    if (!jobData) {
      throw new Error('Job data is required for update');
    }
    
    logger.info(`Updating job in Webflow: ${webflowJobId}`);
    const updatedJob = await webflowAPI.updateJob(webflowJobId, jobData);
    
    logger.info(`Job updated successfully: ${webflowJobId}`);
    return updatedJob;
  } catch (error) {
    logger.error(`Failed to update job in Webflow: ${error.message}`, {
      webflowJobId,
      error: error.stack
    });
    throw error;
  }
}

/**
 * Compare original job fields with updated fields and detect conflicts
 * @param {Object} originalJob - The current job in Webflow
 * @param {Object} updatedJob - The transformed job data from Mysolution
 * @param {Object} mergeStrategy - Strategy for handling field updates
 * @returns {Object} The merged job data with conflicts resolved
 */
export function resolveJobConflicts(originalJob, updatedJob, mergeStrategy = DEFAULT_MERGE_STRATEGY) {
  // Initialize with updated data so all new fields are included
  const result = { ...updatedJob };
  
  // Process fields based on merge strategy
  Object.keys(originalJob).forEach(field => {
    // Always update these fields from Mysolution
    if (mergeStrategy.alwaysUpdate.includes(field)) {
      result[field] = updatedJob[field];
    }
    // Never update these fields from Mysolution
    else if (mergeStrategy.neverUpdate.includes(field)) {
      result[field] = originalJob[field];
    }
    // Update if unchanged (basic conflict detection)
    else if (mergeStrategy.updateIfUnchanged.includes(field)) {
      // If the field was manually edited in Webflow, keep the Webflow version
      if (originalJob[`${field}-modified`] === true) {
        logger.info(`Field '${field}' was modified in Webflow, preserving Webflow value`);
        result[field] = originalJob[field];
      } else {
        // Otherwise use the Mysolution data
        result[field] = updatedJob[field];
      }
    } 
    // For any other fields not explicitly defined in the strategy
    else if (originalJob[field] !== undefined && updatedJob[field] === undefined) {
      // Keep Webflow-specific fields that don't exist in Mysolution
      result[field] = originalJob[field];
    }
  });
  
  return result;
}

/**
 * Update a job in Webflow based on Mysolution job data
 * @param {Object} mysolutionJob - The job data from Mysolution
 * @param {Object} options - Update options
 * @param {Object} options.mergeStrategy - Strategy for resolving conflicts
 * @param {boolean} options.forceUpdate - Force update all fields regardless of conflicts
 * @param {boolean} options.publishChanges - Whether to publish changes after update (defaults to global setting)
 * @returns {Promise<Object>} The updated job
 */
export async function updateJob(mysolutionJob, options = {}) {
  try {
    // Validate required fields
    if (!mysolutionJob || !mysolutionJob.id) {
      throw new Error('Invalid job data - missing ID');
    }
    
    // Check if job exists in Webflow
    const existingJob = await findJobByMysolutionId(mysolutionJob.id);
    
    if (!existingJob) {
      logger.warn(`Job with Mysolution ID ${mysolutionJob.id} not found in Webflow`);
      throw new Error(`Job not found - Mysolution ID ${mysolutionJob.id} does not exist in Webflow`);
    }
    
    // Transform the Mysolution job to Webflow format
    const webflowJobData = transformMysolutionToWebflow(mysolutionJob);
    
    // Resolve conflicts between existing job and new data
    let finalJobData;
    if (options.forceUpdate) {
      // Skip conflict resolution if force update is enabled
      logger.info(`Force updating job ${existingJob.id} (Mysolution ID: ${mysolutionJob.id})`);
      finalJobData = webflowJobData;
    } else {
      // Apply conflict resolution
      logger.debug(`Resolving conflicts for job ${existingJob.id} (Mysolution ID: ${mysolutionJob.id})`);
      finalJobData = resolveJobConflicts(
        existingJob, 
        webflowJobData,
        options.mergeStrategy || DEFAULT_MERGE_STRATEGY
      );
    }
    
    // Update the job in Webflow
    const updatedJob = await updateWebflowJob(existingJob.id, finalJobData);
    
    // Publish changes if requested
    if (options.publishChanges !== false) {
      // Use the publishing service to publish changes
      await publishingService.publishIfEnabled(`Job update: ${updatedJob.name} (${mysolutionJob.id})`);
    }
    
    return {
      job: updatedJob,
      conflicts: findConflicts(existingJob, webflowJobData)
    };
  } catch (error) {
    logger.error(`Failed to update job in Webflow: ${error.message}`, {
      mysolutionJobId: mysolutionJob?.id,
      error: error.stack
    });
    throw error;
  }
}

/**
 * Find conflicts between existing job and updated job data
 * @param {Object} existingJob - The current job in Webflow
 * @param {Object} updatedJob - The transformed job data from Mysolution
 * @returns {Array} List of conflicting fields
 */
function findConflicts(existingJob, updatedJob) {
  const conflicts = [];
  
  Object.keys(updatedJob).forEach(field => {
    if (existingJob[field] !== undefined && 
        existingJob[field] !== updatedJob[field] &&
        existingJob[`${field}-modified`] === true) {
      conflicts.push({
        field,
        webflowValue: existingJob[field],
        mysolutionValue: updatedJob[field]
      });
    }
  });
  
  return conflicts;
}

/**
 * Update multiple jobs in Webflow from a list of Mysolution jobs
 * @param {Array<Object>} mysolutionJobs - List of Mysolution job data
 * @param {Object} options - Update options
 * @param {boolean} options.publishChanges - Whether to publish changes after all updates
 * @returns {Promise<Object>} Results of batch job updates
 */
export async function updateJobs(mysolutionJobs, options = {}) {
  if (!Array.isArray(mysolutionJobs)) {
    throw new Error('Jobs must be provided as an array');
  }
  
  const results = {
    successful: [],
    notFound: [],
    failed: [],
    withConflicts: []
  };
  
  // Disable individual publishing for batch operations if we're going to publish at the end
  const batchOptions = {
    ...options,
    publishChanges: false // Don't publish after each update in a batch
  };
  
  for (const job of mysolutionJobs) {
    try {
      // Check if job exists in Webflow
      const exists = await webflowAPI.jobExistsByMysolutionId(job.id);
      
      if (!exists) {
        logger.info(`Job with Mysolution ID ${job.id} not found in Webflow, skipping update`);
        results.notFound.push({
          mysolutionId: job.id,
          reason: 'Job does not exist in Webflow'
        });
        continue;
      }
      
      // Update the job
      const updateResult = await updateJob(job, batchOptions);
      
      // Track successful updates
      results.successful.push({
        mysolutionId: job.id,
        webflowId: updateResult.job.id
      });
      
      // Track updates with conflicts
      if (updateResult.conflicts && updateResult.conflicts.length > 0) {
        results.withConflicts.push({
          mysolutionId: job.id,
          webflowId: updateResult.job.id,
          conflicts: updateResult.conflicts
        });
      }
    } catch (error) {
      logger.error(`Failed to update job ${job.id}: ${error.message}`);
      results.failed.push({
        mysolutionId: job.id,
        error: error.message
      });
    }
  }
  
  // Publish all changes at once after batch update if requested
  if (options.publishChanges !== false && results.successful.length > 0) {
    try {
      await publishingService.publishIfEnabled(`Batch job update: ${results.successful.length} jobs updated`);
    } catch (error) {
      logger.error('Failed to publish changes after batch job update', {
        error: error.message,
        stack: error.stack
      });
      // Don't throw the error - we successfully updated the jobs, publishing is secondary
    }
  }
  
  logger.info(
    `Batch job update complete: ${results.successful.length} updated, ` +
    `${results.notFound.length} not found, ${results.failed.length} failed, ` +
    `${results.withConflicts.length} with conflicts`
  );
  
  return results;
} 