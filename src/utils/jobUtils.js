import { logger } from './logger.js';
import config from './config.js';

/**
 * Analyzes a Mysolution job object to identify modification date fields
 * @param {Object} job - The job object from Mysolution
 * @returns {Object} An object containing information about modification dates
 */
function analyzeJobModificationDates(job) {
  if (!job) {
    return {
      hasModificationDate: false,
      possibleFields: [],
      recommendedField: null,
      recommendedValue: null
    };
  }

  // Define common field names used for last modified timestamps in Salesforce/Mysolution
  const possibleFields = [
    'LastModifiedDate',
    'SystemModstamp',
    'msf__LastModified__c',
    'LastUpdatedDate',
    'ModifiedDate',
    'modifiedTimestamp',
    'msf__Last_Modified__c'
  ];

  // Find which fields exist in this job
  const existingFields = possibleFields.filter(field => field in job && job[field]);
  
  // Map field names to their values
  const fieldValues = {};
  existingFields.forEach(field => {
    fieldValues[field] = job[field];
  });

  // Find most recent date if multiple fields exist
  let recommendedField = null;
  let recommendedValue = null;
  
  if (existingFields.length > 0) {
    // Sort by date (most recent first)
    recommendedField = existingFields.reduce((latest, field) => {
      if (!latest) return field;
      const latestDate = new Date(job[latest]);
      const fieldDate = new Date(job[field]);
      return fieldDate > latestDate ? field : latest;
    }, null);
    
    recommendedValue = recommendedField ? job[recommendedField] : null;
  }

  return {
    hasModificationDate: existingFields.length > 0,
    possibleFields: existingFields,
    fieldValues,
    recommendedField,
    recommendedValue
  };
}

/**
 * Determines if a job has been modified since a given timestamp
 * @param {Object} job - The job object from Mysolution
 * @param {string} timestamp - ISO timestamp to compare against
 * @returns {boolean} True if the job has been modified since the timestamp
 */
function isJobModifiedSince(job, timestamp) {
  if (!job || !timestamp) return true; // Default to true if we can't determine
  
  const analysis = analyzeJobModificationDates(job);
  
  if (!analysis.hasModificationDate) {
    return true; // If we can't find a date, assume it's modified
  }
  
  const compareDate = new Date(timestamp);
  const modifiedDate = new Date(analysis.recommendedValue);
  
  return modifiedDate > compareDate;
}

/**
 * Determines if a job should be visible on the website based on Mysolution criteria
 * @param {Object} job - The job object from Mysolution
 * @returns {boolean} - True if the job should be published
 */
function shouldJobBePublished(job) {
  if (!job) {
    logger.warn('Cannot determine publication status: job object is null or undefined');
    return false;
  }
  
  // Check status is "Online"
  const hasOnlineStatus = job.msf__Status__c === 'Online';
  
  // Check "Publish to Web" is enabled
  const isPublishToWebEnabled = !!job.msf__Show_On_Website__c;
  
  // Check end date is in the future (if it exists)
  let isEndDateValid = true;
  if (job.msf__On_Website_To__c) {
    const endDate = new Date(job.msf__On_Website_To__c);
    const now = new Date();
    isEndDateValid = endDate >= now;
  }
  
  // Log detailed information about publication criteria for this job
  // Use a safer approach than isLevelEnabled which is not available
  try {
    // Only log in debug mode if the logger has the debug method
    if (logger.debug && config?.logging?.level === 'debug') {
      logger.debug(`Job publication criteria for "${job.Name || job.Id}":`, {
        jobId: job.Id,
        status: job.msf__Status__c,
        hasOnlineStatus,
        showOnWebsite: job.msf__Show_On_Website__c,
        isPublishToWebEnabled,
        endDate: job.msf__On_Website_To__c,
        isEndDateValid,
        shouldPublish: hasOnlineStatus && isPublishToWebEnabled && isEndDateValid
      });
    }
  } catch (error) {
    // Silently ignore any logging errors to prevent disruption
  }
  
  return hasOnlineStatus && isPublishToWebEnabled && isEndDateValid;
}

export {
  analyzeJobModificationDates,
  isJobModifiedSince,
  shouldJobBePublished
}; 