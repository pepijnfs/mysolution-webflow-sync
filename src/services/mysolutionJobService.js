import axios from 'axios';
import { logger } from '../utils/logger.js';
import config from '../utils/config.js';
import mysolutionAuthClient from '../utils/mysolutionAuthClient.js';

class MysolutionJobService {
  constructor() {
    this.baseURL = config.mysolution.apiUrl;
    this.timeout = config.mysolution.timeout;
    this.retryAttempts = config.mysolution.retryAttempts;
    this.retryDelay = config.mysolution.retryDelay;
    
    // Create axios instance with base configuration
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: this.timeout
    });
    
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
        logger.error('Request preparation error:', error);
        return Promise.reject(error);
      }
    );
    
    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      response => {
        return response;
      },
      error => {
        // Log the error details
        logger.error('Mysolution API error:', {
          url: error.config?.url,
          method: error.config?.method,
          status: error.response?.status,
          data: error.response?.data,
          message: error.message
        });
        
        // Handle authentication errors
        if (error.response?.status === 401 || 
            error.response?.status === 403 ||
            error.response?.data?.error === 'invalid_token') {
          logger.warn('Authentication error detected, invalidating token');
          mysolutionAuthClient.invalidateToken();
        }
        
        return Promise.reject(error);
      }
    );
  }

  /**
   * Make a request to Mysolution API with automatic retry for network errors
   * @param {string} method HTTP method (get, post, etc.)
   * @param {string} url API endpoint URL
   * @param {Object} options Request options (params, data, etc.)
   * @returns {Promise<any>} API response data
   * @private
   */
  async _makeRequest(method, url, options = {}) {
    let attempts = 0;
    let lastError = null;
    
    while (attempts < this.retryAttempts) {
      try {
        logger.debug(`Making ${method.toUpperCase()} request to ${url}`, { options });
        
        const response = await this.client[method](url, options);
        return response.data;
      } catch (error) {
        lastError = error;
        attempts++;
        
        // If not a network error or we've hit max retries, throw the error
        const isNetworkError = !error.response || error.code === 'ECONNABORTED';
        if (!isNetworkError || attempts >= this.retryAttempts) {
          break;
        }
        
        // Log retry attempt
        const waitTime = this.retryDelay * attempts;
        logger.warn(`Request failed due to network error. Retrying in ${waitTime}ms (attempt ${attempts}/${this.retryAttempts})`, {
          error: error.message,
          url,
          method,
          attempt: attempts,
          maxAttempts: this.retryAttempts
        });
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    // If we've exhausted all retries, throw the last error
    logger.error(`Request failed after ${this.retryAttempts} attempts`, {
      error: lastError.message,
      url,
      method
    });
    throw lastError;
  }
  
  /**
   * Get jobs with optional filtering and pagination
   * @param {Object} options Query options
   * @param {boolean} options.showOnWebsite Only include jobs marked to show on website
   * @param {string} options.status Filter by job status
   * @param {string} options.professionalField Filter by professional field
   * @param {Date} options.updatedSince Filter by last update date
   * @param {number} options.limit Maximum number of results to return
   * @param {number} options.offset Number of records to skip
   * @returns {Promise<Array>} Array of job records
   */
  async getJobs(options = {}) {
    try {
      // Use the exact endpoint from Postman collection
      const params = { ...options };
      
      // Format date parameters if provided
      if (params.updatedSince instanceof Date) {
        params.updatedSince = params.updatedSince.toISOString();
      }
      
      // Make request to the job Get endpoint
      const jobs = await this._makeRequest('get', '/services/apexrest/msf/api/job/Get', { params });
      
      logger.info(`Retrieved ${jobs.length} jobs`);
      return jobs;
    } catch (error) {
      logger.error('Error retrieving jobs from Mysolution', {
        error: error.message,
        options
      });
      throw error;
    }
  }
  
  /**
   * Get all jobs matching criteria, handling pagination automatically
   * @param {Object} options Query options
   * @returns {Promise<Array>} Complete array of job records
   */
  async getAllJobs(options = {}) {
    try {
      const allJobs = [];
      let currentOffset = 0;
      const limit = options.limit || 100; // Default to 100 per page
      let hasMore = true;
      
      // Keep fetching pages until we get fewer results than the limit
      while (hasMore) {
        const pageOptions = {
          ...options,
          limit,
          offset: currentOffset
        };
        
        const jobs = await this.getJobs(pageOptions);
        
        if (jobs.length > 0) {
          allJobs.push(...jobs);
          
          // Check if we've reached the end
          if (jobs.length < limit) {
            hasMore = false;
          } else {
            currentOffset += limit;
          }
          
          logger.info(`Retrieved ${jobs.length} jobs, total ${allJobs.length} so far`);
        } else {
          // No more jobs
          hasMore = false;
        }
      }
      
      logger.info(`Retrieved all ${allJobs.length} jobs matching criteria`);
      return allJobs;
    } catch (error) {
      logger.error('Error retrieving all jobs from Mysolution', {
        error: error.message,
        options
      });
      throw error;
    }
  }
  
  /**
   * Get a single job by ID
   * @param {string} jobId The job ID to retrieve
   * @returns {Promise<Object>} The job record
   */
  async getJobById(jobId) {
    try {
      if (!jobId) {
        throw new Error('Job ID is required');
      }

      logger.debug(`Fetching job with ID ${jobId}`);
      
      // Use the id parameter with the Get endpoint as shown in the API documentation
      const jobs = await this._makeRequest('get', '/services/apexrest/msf/api/job/Get', {
        params: { id: jobId }
      });
      
      // Check if we received data
      if (!jobs || !Array.isArray(jobs) || jobs.length === 0) {
        const error = new Error(`Job with ID ${jobId} not found`);
        logger.error('Job not found', { jobId });
        throw error;
      }
      
      // If multiple jobs returned (unlikely), take the first one
      const job = jobs[0];
      
      // Double-check the ID as a safety measure
      if (job.Id !== jobId) {
        logger.warn(`Retrieved job ID ${job.Id} does not match requested ID ${jobId}`);
      }
      
      logger.info(`Successfully retrieved job with ID ${jobId}`);
      return job;
    } catch (error) {
      // Handle specifically not found errors vs other errors
      if (error.message && error.message.includes('not found')) {
        logger.error(`Job with ID ${jobId} not found`, { jobId });
      } else {
        logger.error(`Error retrieving job with ID ${jobId}`, {
          error: error.message,
          jobId
        });
      }
      throw error;
    }
  }
  
  /**
   * Get jobs that have been updated since a specific date
   * @param {Date} since Date to check updates from
   * @param {Object} options Additional query options
   * @returns {Promise<Array>} Updated job records
   */
  async getUpdatedJobs(since, options = {}) {
    if (!(since instanceof Date)) {
      throw new Error('since parameter must be a Date object');
    }
    
    return this.getJobs({
      ...options,
      updatedSince: since
    });
  }
  
  /**
   * Get only jobs marked to show on website
   * @param {Object} options Additional query options
   * @returns {Promise<Array>} Jobs marked for website display
   */
  async getWebsiteJobs(options = {}) {
    return this.getJobs({
      ...options,
      showOnWebsite: true
    });
  }
}

// Create and export a single instance
const mysolutionJobService = new MysolutionJobService();
export default mysolutionJobService; 