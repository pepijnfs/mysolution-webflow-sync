import axios from 'axios';
import { logger } from '../utils/logger.js';
import config from '../utils/config.js';
import mysolutionAuthClient from '../utils/mysolutionAuthClient.js';
import { analyzeJobModificationDates } from '../utils/jobUtils.js';

// Mysolution API client
class MysolutionAPI {
  constructor() {
    this.baseURL = config.mysolution.apiUrl;
    this.timeout = config.mysolution.timeout;
    
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: this.timeout
    });

    // Add response interceptor for logging
    this.client.interceptors.response.use(
      response => {
        return response;
      },
      error => {
        logger.error('Mysolution API error:', {
          url: error.config?.url,
          method: error.config?.method,
          status: error.response?.status,
          data: error.response?.data,
          message: error.message
        });
        
        // Handle authentication errors by invalidating the token
        if (error.response?.status === 401 || 
            error.response?.status === 403 ||
            error.response?.data?.error === 'invalid_token') {
          logger.warn('Authentication error detected, invalidating token');
          mysolutionAuthClient.invalidateToken();
        }
        
        return Promise.reject(error);
      }
    );

    // Add request interceptor to add auth token
    this.client.interceptors.request.use(
      async config => {
        // Get a valid token from the auth client
        const token = await mysolutionAuthClient.getAccessToken();
        
        // Add the token to the request
        config.headers['Authorization'] = `Bearer ${token}`;
        return config;
      },
      error => {
        return Promise.reject(error);
      }
    );
  }

  // Jobs endpoints
  /**
   * Get all jobs from Mysolution
   * @returns {Promise<Array>} List of jobs
   */
  async getJobs() {
    try {
      // Only log at debug level
      if (logger.level === 'debug') {
        logger.debug('Fetching jobs from Mysolution API');
      } else {
        console.log('Fetching jobs from Mysolution API');
      }
      
      // No need to call authenticate explicitly - the request interceptor handles this
      
      const response = await this.client.get('/services/apexrest/msf/api/job/Get');
      
      // Only log raw response at debug level
      if (logger.level === 'debug') {
        logger.debug('Raw Mysolution API response:', {
          status: response.status,
          headers: response.headers,
          dataLength: response.data ? response.data.length : 0
        });
      }
      
      const jobs = response.data || [];
      
      // Only log at info level or below
      if (logger.level === 'debug' || logger.level === 'info') {
        console.log(`Parsed ${jobs.length} jobs from Mysolution API`);
      }
      
      // Only do detailed job analysis when explicitly in debug mode
      if (logger.level === 'debug' && jobs.length > 0) {
        // Analyze the first job to find modification date fields
        const firstJob = jobs[0];
        logger.debug('First job structure:', { job: firstJob });
        
        // Analyze date fields to help with incremental sync
        const dateAnalysis = analyzeJobModificationDates(firstJob);
        logger.debug('Job date fields analysis:', dateAnalysis);
        
        if (dateAnalysis.hasModificationDate) {
          logger.info(`Identified job modification date field: ${dateAnalysis.recommendedField}`);
        } else {
          logger.warn('No modification date fields found in job data');
        }
        
        // Only save debug job in debug mode
        const fs = await import('fs');
        fs.writeFileSync('debug-job.json', JSON.stringify(firstJob, null, 2));
        logger.debug('First job saved to debug-job.json for examination');
      }
      
      return jobs;
    } catch (error) {
      logger.error('Error fetching jobs from Mysolution:', error);
      throw error;
    }
  }

  /**
   * Get jobs that have changed since the specified time
   * @param {string} lastSyncTime - ISO timestamp of last sync
   * @param {Object} params - Additional parameters for the request
   * @returns {Array} Array of changed jobs
   */
  async getChangedJobs(lastSyncTime, params = {}) {
    try {
      if (!lastSyncTime) {
        console.log('No lastSyncTime provided, returning all jobs');
        return await this.getJobs(params);
      }

      // Ensure the lastSyncTime is properly formatted for API consumption
      const lastSyncDate = new Date(lastSyncTime);
      if (isNaN(lastSyncDate.getTime())) {
        console.log(`Invalid lastSyncTime provided: ${lastSyncTime}, returning all jobs`);
        return await this.getJobs(params);
      }

      // Format the date for Salesforce API (ISO format is typically expected)
      const formattedLastSync = lastSyncDate.toISOString();
      
      console.log(`Getting jobs changed since: ${formattedLastSync} (from input: ${lastSyncTime})`);
      logger.info(`Attempting to fetch jobs modified since ${formattedLastSync}`);
      
      // Approach 1: Try API-level filtering first
      // This is more efficient if the API supports it
      logger.info(`Attempting API filtering for jobs modified since ${formattedLastSync}`);
      
      // We'll try with multiple parameter variations that might work with the API
      // Common parameters for Salesforce/API date filtering
      const apiFilterParams = {
        ...params,
        lastModifiedDate: formattedLastSync,
        modifiedSince: formattedLastSync,
        modifiedAfter: formattedLastSync,
        updatedSince: formattedLastSync
      };
      
      // Log what we're trying
      console.log('INCREMENTAL SYNC: Attempting API filtering with parameters:', JSON.stringify(apiFilterParams, null, 2));
      
      try {
        const response = await this.client.get('/services/apexrest/msf/api/job/Get', { 
          params: apiFilterParams
        });
        
        const jobCount = response.data ? response.data.length : 0;
        console.log(`INCREMENTAL SYNC: API filtered response returned ${jobCount} jobs`);
        
        // If we got jobs back, assume filtering worked and validate the results
        if (jobCount > 0) {
          // Double-check that returned jobs are actually newer than lastSyncTime
          const validatedJobs = response.data.filter(job => {
            if (!job.LastModifiedDate) {
              console.log(`Warning: Job ${job.Id} from API has no LastModifiedDate, including for safety`);
              return true;
            }
            const jobModDate = new Date(job.LastModifiedDate);
            const isNewer = jobModDate > lastSyncDate;
            if (!isNewer) {
              console.log(`Warning: Job ${job.Id} from API is not newer than lastSync (${job.LastModifiedDate} <= ${formattedLastSync})`);
            }
            return isNewer;
          });
          
          console.log(`API validation: ${validatedJobs.length} of ${jobCount} jobs are actually newer than last sync`);
          logger.info(`API filtering returned ${validatedJobs.length} validated jobs modified since ${formattedLastSync}`);
          return validatedJobs;
        } else {
          console.log('API filtering returned 0 jobs - will verify with client-side filtering');
        }
      } catch (error) {
        console.log(`API filtering attempt failed with error: ${error.message}. Trying client-side filtering.`);
      }
      
      // Approach 2: Client-side filtering (more reliable fallback)
      // Since API filtering didn't work or returned suspicious results, get all jobs and filter them ourselves
      logger.info(`API filtering unsuccessful, falling back to client-side filtering for jobs modified since ${formattedLastSync}`);
      console.log('INCREMENTAL SYNC: Falling back to client-side filtering by date');
      
      const allJobs = await this.getJobs(params);
      console.log(`Fetched ${allJobs.length} total jobs for client-side filtering`);
      
      // The getJobs method already analyzes date fields, now filter based on that
      // Use the most reliable date field for filtering
      const filteredJobs = allJobs.filter(job => {
        const analysis = analyzeJobModificationDates(job);
        
        if (!analysis.hasModificationDate) {
          console.log(`WARNING: Job ${job.Id} (${job.Name || 'Unnamed'}) has no modification date, including by default`);
          return true; // Include jobs with no modification date to be safe
        }
        
        const jobModDate = new Date(analysis.recommendedValue);
        
        // Add timezone awareness - ensure we're comparing dates correctly
        const lastSyncDateWithBuffer = new Date(lastSyncDate.getTime() - 1000); // 1 second buffer for precision issues
        
        // If the job was modified after our last sync time (with small buffer), include it
        const isNewer = jobModDate > lastSyncDateWithBuffer;
        
        // Enhanced logging for debugging
        if (isNewer) {
          console.log(`✅ Including job ${job.Id} (${job.Name || 'Unnamed'}):`);
          console.log(`   Modification field: ${analysis.recommendedField}`);
          console.log(`   Modification date: ${analysis.recommendedValue}`);
          console.log(`   Last sync time: ${formattedLastSync}`);
          console.log(`   Time difference: ${jobModDate.getTime() - lastSyncDate.getTime()}ms`);
        } else {
          // Only log a few examples to avoid spam
          if (Math.random() < 0.1) { // Log ~10% of skipped jobs
            console.log(`❌ Skipping job ${job.Id} (not modified since last sync)`);
          }
        }
        
        return isNewer;
      });
      
      const totalCount = allJobs.length;
      const foundCount = filteredJobs.length;
      const skippedCount = totalCount - foundCount;
      
      logger.info(`Client-side filtering found ${foundCount} jobs modified since ${formattedLastSync} out of ${totalCount} total jobs (${skippedCount} skipped)`);
      console.log(`INCREMENTAL SYNC: Client-side filtering found ${foundCount} jobs modified since ${formattedLastSync}`);
      
      if (foundCount === 0) {
        console.log(`INCREMENTAL SYNC: No jobs have been modified since last sync ${formattedLastSync}`);
      } else {
        console.log(`INCREMENTAL SYNC: Found ${foundCount} jobs modified since last sync:`);
        // Log first few jobs as examples
        filteredJobs.slice(0, 5).forEach(job => {
          console.log(`  - Job ${job.Id} (${job.Name || 'Unnamed'}) - Modified: ${job.LastModifiedDate}`);
        });
        if (foundCount > 5) {
          console.log(`  ... and ${foundCount - 5} more jobs`);
        }
      }
      
      return filteredJobs;
    } catch (error) {
      logger.error('Error fetching changed jobs from Mysolution:', error);
      console.log(`ERROR in getChangedJobs: ${error.message}`);
      console.log('Falling back to returning all jobs due to error');
      
      // As a last resort, return all jobs if filtering fails completely
      try {
        return await this.getJobs(params);
      } catch (fallbackError) {
        logger.error('Error in fallback getJobs call:', fallbackError);
        throw new Error(`Failed to fetch jobs: ${error.message}. Fallback also failed: ${fallbackError.message}`);
      }
    }
  }

  async getJobById(id) {
    try {
      // In the current Postman collection, there's no endpoint for getting a job by ID
      // We'll need to fetch all jobs and filter
      const jobs = await this.getJobs();
      const job = jobs.find(job => job.Id === id);
      
      if (!job) {
        throw new Error(`Job with ID ${id} not found`);
      }
      
      return job;
    } catch (error) {
      logger.error(`Error fetching job ${id} from Mysolution:`, error);
      throw error;
    }
  }

  // Job application configuration
  async getJobApplicationConfiguration(setApiName = 'default') {
    try {
      const response = await this.client.get('/services/apexrest/msf/api/base/GetJobApplicationConfiguration', {
        params: { setApiName }
      });
      return response.data;
    } catch (error) {
      logger.error('Error fetching job application configuration from Mysolution:', error);
      throw error;
    }
  }

  // Applications endpoints
  async createApplication(applicationData, setApiName = 'default', jobId = null) {
    try {
      // Extract the job ID from parameters and application data
      // Prioritize the explicit jobId parameter
      let effectiveJobId = jobId;
      
      // If no explicit jobId provided, check if it's in the application data
      if (!effectiveJobId) {
        if (applicationData.JobId?.value) {
          effectiveJobId = applicationData.JobId.value;
          // Remove it from the fields since it should be in the URL
          delete applicationData.JobId;
        }
        if (applicationData.msf__Job__c?.value && !effectiveJobId) {
          effectiveJobId = applicationData.msf__Job__c.value;
          delete applicationData.msf__Job__c;
        }
        if (applicationData.Job?.value && !effectiveJobId) {
          effectiveJobId = applicationData.Job.value;
          delete applicationData.Job;
        }
      }
      
      // Sanitize the job ID - remove any leading/trailing spaces
      if (effectiveJobId) {
        effectiveJobId = effectiveJobId.trim();
      }
      
      logger.info(`Preparing to create application ${effectiveJobId ? 'for job ID: ' + effectiveJobId : 'without job ID'}`);
      
      // Structure the payload exactly as in the Postman collection
      // Use 'default' as setApiName, as our tests confirmed this works
      const payload = {
        setApiName: setApiName || 'default',
        fields: applicationData
      };
      
      logger.info('Sending payload to Mysolution API:', JSON.stringify(payload, null, 2));
      
      // Build the URL with the job ID as a query parameter if available
      // Note that in the Postman collection, it's passed as `id=jobId`
      const url = effectiveJobId 
        ? `/services/apexrest/msf/api/job/Apply?id=${encodeURIComponent(effectiveJobId)}`
        : '/services/apexrest/msf/api/job/Apply';
      
      // Based on our testing, no additional parameters are needed
      const requestConfig = {}; // Empty config, no domain parameter needed
      
      logger.info(`Using API URL: ${url}`);
      
      try {
        const response = await this.client.post(url, payload, requestConfig);
        logger.info('Successfully created application in Mysolution');
        return response.data;
      } catch (apiError) {
        // Log detailed API error information
        logger.error('Mysolution API returned error:', {
          status: apiError.response?.status,
          statusText: apiError.response?.statusText,
          data: apiError.response?.data
        });
        
        // Try alternative: if the job ID is for a publication, we might need to try a different endpoint
        // or we might need to get the parent job ID
        if (apiError.message.includes('not found') || 
            apiError.message.includes('List has no rows') ||
            apiError.message.includes('Id is missing')) {
          
          logger.info('First attempt failed. Trying to find job in Publications...');
          try {
            // Try to find the job in all available jobs, including publications
            const jobs = await this.getJobs();
            logger.info(`Fetched ${jobs.length} jobs to search for the publication`);
            
            // Look for the publication or a related job
            const matchingPublication = jobs.find(job => job.Id === effectiveJobId);
            const relatedPublication = jobs.find(job => 
              job.msf__Linked_To_Master_Job__r?.Id === effectiveJobId || 
              job.msf__Linked_Publications__r?.some(pub => pub.Id === effectiveJobId)
            );
            
            // If found a matching or related job, try using that
            const targetJob = matchingPublication || relatedPublication;
            if (targetJob) {
              logger.info(`Found job/publication: ${targetJob.Id} (${targetJob.Name})`);
              
              // Try again with the found job ID
              const pubUrl = `/services/apexrest/msf/api/job/Apply?id=${encodeURIComponent(targetJob.Id)}`;
              logger.info(`Retrying with found job ID: ${pubUrl}`);
              
              const pubResponse = await this.client.post(pubUrl, payload);
              logger.info('Successfully created application for publication');
              return pubResponse.data;
            } else {
              logger.error(`Could not find job or publication with ID ${effectiveJobId} in any section`);
            }
          } catch (secondError) {
            logger.error('Error in second attempt to create application:', secondError);
          }
        }
        
        // Try to extract the actual error message from the response if available
        const errorMsg = apiError.response?.data?.error || 
                         apiError.response?.data?.message || 
                         apiError.response?.data?.errorMessage ||
                         (typeof apiError.response?.data === 'string' ? apiError.response.data : null) ||
                         apiError.message;
        
        // If it's the "Id is missing" error, provide a clearer message
        if (errorMsg.includes('Id is missing')) {
          throw new Error(`Job ID is required but was not provided or was invalid. Please check the job ID: ${effectiveJobId || '(no ID)'}`);
        }
        
        // If it's the "List has no rows" error, it's likely the job ID isn't valid or not in the expected section
        if (errorMsg.includes('List has no rows for assignment to SObject')) {
          throw new Error(`Job ID ${effectiveJobId} not found in the main jobs section. It may be a publication or in another section. Please check with Mysolution support.`);
        }
        
        logger.error(`Detailed error message from Mysolution API: ${errorMsg}`);
        
        throw new Error(`Mysolution API error: ${errorMsg}`);
      }
    } catch (error) {
      logger.error('Error creating application in Mysolution:', error);
      throw error;
    }
  }

  // Candidate endpoints
  async createCandidate(candidateData) {
    try {
      // Prepare the candidate data in the format expected by Mysolution API
      // Note: For Mysolution, candidates and applications are combined in a single API call
      // This will be handled in the createApplication method
      
      // Return a mock result for now since we'll use the actual implementation
      // through the Apply endpoint in createApplication
      return {
        id: `candidate-${Date.now()}`,
        ...candidateData
      };
    } catch (error) {
      logger.error('Error creating candidate in Mysolution:', error);
      throw error;
    }
  }

  // Portal Controller methods
  async createPortalController(controllerData) {
    try {
      const response = await this.client.post('/services/data/v56.0/sobjects/msf__Portal_Controller__c', controllerData);
      return response.data;
    } catch (error) {
      logger.error('Error creating portal controller in Mysolution:', error);
      throw error;
    }
  }

  async createPortalFields(fieldsData) {
    try {
      const response = await this.client.post('/services/data/v34.0/composite/tree/msf__Portal_Field__c', fieldsData);
      return response.data;
    } catch (error) {
      logger.error('Error creating portal fields in Mysolution:', error);
      throw error;
    }
  }

  /**
   * Get all publications from Mysolution
   * @returns {Promise<Array>} List of job publications
   */
  async getPublications() {
    try {
      logger.info('Fetching job publications from Mysolution API');
      
      // Specific query parameters for publications
      const params = {
        includePublications: true,
        publicationsOnly: true
      };
      
      try {
        const response = await this.client.get('/services/apexrest/msf/api/job/Get', { params });
        
        const publications = response.data || [];
        logger.info(`Retrieved ${publications.length} publications from Mysolution API`);
        
        return publications;
      } catch (error) {
        logger.error('Error fetching publications:', error);
        // Fallback to regular getJobs and filter for publications
        const allJobs = await this.getJobs();
        
        // Try to identify publications by their linked parent job
        const possiblePublications = allJobs.filter(job => 
          job.msf__Linked_To_Master_Job__r || // has a parent job
          job.msf__Is_Publication__c === true || // explicitly marked as publication
          job.msf__Is_Published__c === true // is published
        );
        
        logger.info(`Filtered ${possiblePublications.length} possible publications from ${allJobs.length} total jobs`);
        return possiblePublications;
      }
    } catch (error) {
      logger.error('Error in getPublications fallback:', error);
      return [];
    }
  }

  /**
   * Apply to a job publication specifically
   * @param {Object} applicationData - Application data 
   * @param {string} publicationId - The ID of the publication
   * @param {string} setApiName - API name for the controller
   * @returns {Object} - Response from the API
   */
  async applyToPublication(applicationData, publicationId, setApiName = 'jobbird') {
    try {
      logger.info(`Attempting to apply to publication ${publicationId}`);
      
      // Try several approaches to apply to a publication
      
      // 1. First try direct apply to the publication ID
      try {
        logger.info(`Approach 1: Applying directly to publication ID ${publicationId}`);
        const result = await this.createApplication(applicationData, setApiName, publicationId);
        return result;
      } catch (error1) {
        logger.warn(`Direct application to publication failed: ${error1.message}`);
        
        // 2. Try to get publication details first
        try {
          // Get all publications
          const publications = await this.getPublications();
          const publication = publications.find(p => p.Id === publicationId);
          
          if (publication) {
            logger.info(`Found publication: ${publication.Name} (${publication.Id})`);
            
            // If publication has a parent job, try applying to that
            if (publication.msf__Linked_To_Master_Job__r?.Id) {
              const parentJobId = publication.msf__Linked_To_Master_Job__r.Id;
              logger.info(`Approach 2: Applying to parent job ${parentJobId} of publication ${publicationId}`);
              
              try {
                // Apply using the parent job ID instead
                const result = await this.createApplication(applicationData, setApiName, parentJobId);
                return result;
              } catch (error2) {
                logger.warn(`Application to parent job failed: ${error2.message}`);
              }
            }
            
            // 3. Try with special publication parameters
            logger.info('Approach 3: Applying with special publication parameters');
            const payload = {
              setApiName: setApiName,
              fields: applicationData,
              publicationId: publicationId,
              isPublication: true
            };
            
            const url = `/services/apexrest/msf/api/job/Apply?id=${encodeURIComponent(publicationId)}&isPublication=true`;
            try {
              const response = await this.client.post(url, payload);
              return response.data;
            } catch (error3) {
              logger.warn(`Application with special parameters failed: ${error3.message}`);
              throw error3;
            }
          } else {
            logger.error(`Could not find publication with ID ${publicationId}`);
            throw new Error(`Publication ${publicationId} not found in Mysolution`);
          }
        } catch (error) {
          logger.error('Error in publication lookup:', error);
          throw error;
        }
      }
    } catch (finalError) {
      logger.error(`All attempts to apply to publication ${publicationId} failed:`, finalError);
      throw new Error(`Failed to apply to publication: ${finalError.message}`);
    }
  }
}

// Create and export a single instance
const mysolutionAPI = new MysolutionAPI();
export default mysolutionAPI; 