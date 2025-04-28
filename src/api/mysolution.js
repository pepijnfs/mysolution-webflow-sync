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
      console.log('Fetching jobs from Mysolution API');
      
      // No need to call authenticate explicitly - the request interceptor handles this
      
      const response = await this.client.get('/services/apexrest/msf/api/job/Get');
      console.log(`Raw Mysolution API response:`, JSON.stringify({
        status: response.status,
        headers: response.headers,
        data: response.data ? { length: response.data.length } : null
      }, null, 2));
      
      const jobs = response.data || [];
      console.log(`Parsed ${jobs.length} jobs from Mysolution API`);
      
      if (jobs.length > 0) {
        // Analyze the first job to find modification date fields
        const firstJob = jobs[0];
        console.log(`First job structure:`, JSON.stringify(firstJob, null, 2));
        
        // Analyze date fields to help with incremental sync
        const dateAnalysis = analyzeJobModificationDates(firstJob);
        console.log(`Job date fields analysis:`, JSON.stringify(dateAnalysis, null, 2));
        
        if (dateAnalysis.hasModificationDate) {
          console.log(`Most reliable modification date field found: ${dateAnalysis.recommendedField} with value ${dateAnalysis.recommendedValue}`);
          logger.info(`Identified job modification date field: ${dateAnalysis.recommendedField}`);
        } else {
          console.log(`WARNING: No modification date fields found in job data. Incremental sync may not work correctly.`);
          logger.warn(`No modification date fields found in job data`);
        }
        
        // Save first job to a debug file for examination
        const fs = await import('fs');
        fs.writeFileSync('debug-job.json', JSON.stringify(firstJob, null, 2));
        console.log('First job saved to debug-job.json for examination');
      }
      
      return jobs;
    } catch (error) {
      console.error('Error fetching jobs from Mysolution:', error);
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
        logger.info('No last sync time provided, fetching all jobs');
        return this.getJobs(params);
      }

      // Create a new date object from the lastSyncTime
      const lastSync = new Date(lastSyncTime);
      
      // Format lastSync for the Mysolution API
      const formattedLastSync = lastSync.toISOString();
      
      // Try two approaches:
      // 1. First, try with API filtering parameters
      // 2. If that doesn't work, fetch all and filter client-side
      
      // Approach 1: API filtering
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
      console.log(`INCREMENTAL SYNC: Attempting API filtering with parameters:`, JSON.stringify(apiFilterParams, null, 2));
      
      try {
        const response = await this.client.get('/services/apexrest/msf/api/job/Get', { 
          params: apiFilterParams
        });
        
        const jobCount = response.data ? response.data.length : 0;
        console.log(`INCREMENTAL SYNC: API filtered response returned ${jobCount} jobs`);
        
        // If we got jobs back, assume filtering worked
        if (jobCount > 0) {
          logger.info(`API filtering returned ${jobCount} jobs modified since ${formattedLastSync}`);
          return response.data;
        } else {
          console.log(`API filtering returned 0 jobs - will try client-side filtering as fallback`);
        }
      } catch (error) {
        console.log(`API filtering attempt failed with error: ${error.message}. Trying client-side filtering.`);
      }
      
      // Approach 2: Client-side filtering
      // Since API filtering didn't work, get all jobs and filter them ourselves
      logger.info(`API filtering unsuccessful, falling back to client-side filtering for jobs modified since ${formattedLastSync}`);
      console.log(`INCREMENTAL SYNC: Falling back to client-side filtering by date`);
      
      const allJobs = await this.getJobs(params);
      
      // The getJobs method already analyzes date fields, now filter based on that
      // Use the most reliable date field for filtering
      const filteredJobs = allJobs.filter(job => {
        const analysis = analyzeJobModificationDates(job);
        
        if (!analysis.hasModificationDate) {
          console.log(`WARNING: Job ${job.Id} has no modification date, including by default`);
          return true; // Include jobs with no modification date
        }
        
        const jobModDate = new Date(analysis.recommendedValue);
        const lastSyncDate = new Date(lastSyncTime);
        
        // Make sure we're comparing the dates correctly
        // If the job was modified after our last sync time, include it
        const isNewer = jobModDate > lastSyncDate;
        
        // Log details for every job to diagnose issues
        console.log(`Job ${job.Id || 'Unknown'} (${job.Name || 'Unnamed'}):`);
        console.log(`  - Modification field: ${analysis.recommendedField}`);
        console.log(`  - Modification date: ${analysis.recommendedValue}`);
        console.log(`  - Last sync time: ${lastSyncTime}`);
        console.log(`  - Include in sync: ${isNewer ? 'YES (newer)' : 'NO (not modified)'}`);
        
        return isNewer;
      });
      
      logger.info(`Client-side filtering found ${filteredJobs.length} jobs modified since ${formattedLastSync} out of ${allJobs.length} total jobs`);
      console.log(`INCREMENTAL SYNC: Client-side filtering found ${filteredJobs.length} jobs modified since ${formattedLastSync}`);
      
      if (filteredJobs.length === 0) {
        console.log(`INCREMENTAL SYNC: No jobs have been modified since last sync ${formattedLastSync}`);
      } else {
        console.log(`INCREMENTAL SYNC: Found ${filteredJobs.length} jobs modified since last sync:`);
        filteredJobs.forEach(job => {
          console.log(`  - Job ${job.Id || 'Unknown'} (${job.Name || 'Unnamed'})`);
        });
      }
      
      return filteredJobs;
    } catch (error) {
      logger.error('Error fetching changed jobs from Mysolution:', error);
      throw error;
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
  async createApplication(applicationData, setApiName = 'default') {
    try {
      const payload = {
        setApiName,
        fields: applicationData
      };
      
      const response = await this.client.post('/services/apexrest/msf/api/job/Apply', payload);
      return response.data;
    } catch (error) {
      logger.error('Error creating application in Mysolution:', error);
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
}

// Create and export a single instance
const mysolutionAPI = new MysolutionAPI();
export default mysolutionAPI; 