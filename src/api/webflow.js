import axios from 'axios';
import { logger } from '../utils/logger.js';
import config from '../utils/config.js';

// Webflow API client
class WebflowAPI {
  constructor() {
    this.baseURL = 'https://api.webflow.com/v2';
    this.apiKey = config.webflow.apiKey;
    this.siteId = config.webflow.siteId;
    this.jobsCollectionId = config.webflow.jobsCollectionId;
    this.candidatesCollectionId = config.webflow.candidatesCollectionId;
    this.sectorsCollectionId = config.webflow.sectorsCollectionId;
    this.timeout = config.webflow.timeout;
    this.rateLimit = config.webflow.rateLimit;
    this.customDomains = [];
    
    // Rate limiting state
    this.requestQueue = [];
    this.processing = false;
    this.requestsThisMinute = 0;
    this.rateLimitResetTime = Date.now() + 60000; // 1 minute from now
    
    if (!this.apiKey) {
      logger.error('Webflow API key is not set');
      throw new Error('WEBFLOW_API_TOKEN is required');
    }

    if (!this.siteId) {
      logger.error('Webflow Site ID is not set');
      throw new Error('WEBFLOW_SITE_ID is required');
    }

    if (!this.jobsCollectionId) {
      logger.error('Webflow Jobs Collection ID is not set');
      throw new Error('WEBFLOW_JOBS_COLLECTION_ID is required');
    }

    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'accept-version': '1.0.0'
      },
      timeout: this.timeout
    });

    // Add response interceptor for logging and rate limit tracking
    this.client.interceptors.response.use(
      response => {
        // Track rate limits from response headers if available
        if (response.headers['x-ratelimit-remaining']) {
          const remaining = parseInt(response.headers['x-ratelimit-remaining'], 10);
          // Calculate current request count based on remaining 
          this.requestsThisMinute = this.rateLimit - remaining;
          // Make sure it's at least 1 (for the current request)
          if (this.requestsThisMinute < 1) this.requestsThisMinute = 1;
        } else {
          // If no header, just increment the counter by 1
          this.requestsThisMinute += 1;
        }
        
        if (response.headers['x-ratelimit-reset']) {
          this.rateLimitResetTime = parseInt(response.headers['x-ratelimit-reset'], 10) * 1000;
        }
        
        return response;
      },
      error => {
        // Enhanced error logging with rate limit information
        const errorInfo = {
          url: error.config?.url,
          method: error.config?.method,
          status: error.response?.status,
          data: error.response?.data,
          message: error.message
        };
        
        // Handle rate limit exceeded errors
        if (error.response?.status === 429) {
          const resetTime = error.response.headers['x-ratelimit-reset'];
          const waitTime = resetTime ? (parseInt(resetTime, 10) * 1000) - Date.now() : 60000;
          const resetDate = new Date(Date.now() + waitTime);
          
          const humanReadableMsg = `Webflow API rate limit reached! The API allows ${this.rateLimit} requests per minute, but this limit has been exceeded. The system will automatically resume at ${resetDate.toLocaleTimeString()}. This is normal during large syncs and the system will automatically retry.`;
          
          console.log('⚠️ ' + humanReadableMsg);
          logger.warn(humanReadableMsg, {
            ...errorInfo,
            rateLimitReset: resetDate.toISOString(),
            waitTimeMs: waitTime,
            humanReadable: true
          });
          
          // Update rate limit state - set current usage to the limit
          this.requestsThisMinute = this.rateLimit;
          this.rateLimitResetTime = Date.now() + waitTime;
        } 
        // Handle authentication errors
        else if (error.response?.status === 401) {
          const humanReadableMsg = 'Webflow API authentication failed. The API key may have expired or been revoked. Please check your Webflow API settings.';
          console.log('❌ ' + humanReadableMsg);
          logger.error(humanReadableMsg, errorInfo);
        } 
        // Handle not found errors
        else if (error.response?.status === 404) {
          const humanReadableMsg = `The requested resource was not found in Webflow (URL: ${error.config?.url}). This could mean the item was deleted or the ID is incorrect.`;
          console.log('❌ ' + humanReadableMsg);
          logger.error(humanReadableMsg, errorInfo);
        }
        // Handle other errors
        else {
          const humanReadableMsg = `Webflow API error: ${error.response?.data?.message || error.message}. This might be temporary - the system will retry automatically.`;
          console.log('❌ ' + humanReadableMsg);
          logger.error(humanReadableMsg, errorInfo);
        }
        
        return Promise.reject(error);
      }
    );
  }

  /**
   * Add a request to the rate-limited queue
   * @param {Function} requestFn - Function that returns a promise for the request
   * @returns {Promise<any>} - Promise that resolves with the request result
   * @private
   */
  _enqueueRequest(requestFn) {
    return new Promise((resolve, reject) => {
      // Add to queue
      this.requestQueue.push({ requestFn, resolve, reject });
      
      // Start processing if not already
      if (!this.processing) {
        this._processQueue();
      }
    });
  }

  /**
   * Process the request queue with rate limiting
   * @private
   */
  async _processQueue() {
    if (this.requestQueue.length === 0) {
      this.processing = false;
      return;
    }
    
    this.processing = true;
    
    // Check if we need to wait for rate limit reset
    const now = Date.now();
    if (this.requestsThisMinute >= this.rateLimit) {
      const waitTime = Math.max(this.rateLimitResetTime - now, 0);
      
      if (waitTime > 0) {
        logger.debug(`Rate limit reached. Waiting ${waitTime}ms before next request.`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        // Reset counter after waiting
        this.requestsThisMinute = 0;
        this.rateLimitResetTime = Date.now() + 60000;
      }
    }
    
    // Check if minute has elapsed and reset counter
    if (now > this.rateLimitResetTime) {
      this.requestsThisMinute = 0;
      this.rateLimitResetTime = now + 60000;
    }
    
    // Process next request
    const { requestFn, resolve, reject } = this.requestQueue.shift();
    
    try {
      // Execute the request and increment counter
      this.requestsThisMinute++;
      const result = await requestFn();
      resolve(result);
    } catch (error) {
      reject(error);
    }
    
    // Continue processing queue
    setImmediate(() => this._processQueue());
  }

  /**
   * Execute an API request with rate limiting
   * @param {string} method - HTTP method (get, post, put, delete)
   * @param {string} url - URL path
   * @param {object} options - Request options (data, params)
   * @returns {Promise<any>} - Request response data
   * @private
   */
  _makeRequest(method, url, options = {}) {
    return this._enqueueRequest(async () => {
      try {
        const response = await this.client[method](url, options);
        return response.data;
      } catch (error) {
        // Specific error handling for each error type
        if (error.response) {
          // Server responded with error status
          // Log more detailed error information for validation errors
          if (error.response.status === 400 && error.response.data) {
            console.error('DETAILED API ERROR:', JSON.stringify(error.response.data, null, 2));
            logger.error('Detailed Webflow API validation error:', error.response.data);
          }
          
          throw new Error(
            `Webflow API ${error.response.status} error: ${
              error.response.data?.message || error.response.data?.error || error.message
            }`
          );
        } else if (error.request) {
          // Request was made but no response received
          throw new Error(`Webflow API request timeout or no response: ${error.message}`);
        } else {
          // Error in request setup
          throw new Error(`Webflow API request error: ${error.message}`);
        }
      }
    });
  }

  // Site endpoints
  async getSite() {
    const siteInfo = await this._makeRequest('get', `sites/${this.siteId}`);
    // Store custom domain IDs for publishing
    if (siteInfo.customDomains && siteInfo.customDomains.length > 0) {
      this.customDomains = siteInfo.customDomains.map(domain => domain.id);
    }
    return siteInfo;
  }

  async publishSite() {
    try {
      console.log('==== PUBLISHING SITE TO WEBFLOW SUBDOMAIN (STAGING) ====');
      // Always get the latest site data to ensure we have the correct domain IDs
      console.log('Fetching site information...');
      const siteInfo = await this.getSite();
      console.log(`Retrieved site information for site ${siteInfo.name} (${this.siteId})`);
      
      // Create a payload that ONLY publishes to the Webflow subdomain (staging)
      // This ensures that the site is only published to baselifesciences.webflow.io
      const payload = {
        publishToWebflowSubdomain: true
      };
      
      console.log('Publishing only to Webflow subdomain (baselifesciences.webflow.io)');
      console.log('Publish payload:', JSON.stringify(payload, null, 2));
      
      // Make the publish request with the properly formatted payload
      console.log('Sending publish request to Webflow API...');
      const result = await this._makeRequest('post', `sites/${this.siteId}/publish`, payload);
      console.log('Site publish request successful:', JSON.stringify(result, null, 2));
      console.log('==== PUBLISHING COMPLETED SUCCESSFULLY ====');
      
      return result;
    } catch (error) {
      console.error('==== ERROR PUBLISHING SITE ====');
      console.error('Publish error details:', error);
      logger.error('Error publishing site:', error);
      throw error;
    }
  }

  // Collection endpoints
  async getCollections() {
    return this._makeRequest('get', `sites/${this.siteId}/collections`);
  }

  async getCollection(collectionId) {
    return this._makeRequest('get', `collections/${collectionId}`);
  }

  /**
   * Get collection by name instead of ID
   * @param {string} collectionName - Name of the collection to find
   * @returns {Promise<object|null>} Collection object or null if not found
   */
  async getCollectionByName(collectionName) {
    const collections = await this.getCollections();
    return collections.find(collection => 
      collection.name.toLowerCase() === collectionName.toLowerCase() ||
      collection.slug.toLowerCase() === collectionName.toLowerCase()
    ) || null;
  }

  /**
   * Check if a collection exists by ID
   * @param {string} collectionId - ID of the collection to check
   * @returns {Promise<boolean>} True if collection exists
   */
  async collectionExists(collectionId) {
    try {
      await this.getCollection(collectionId);
      return true;
    } catch (error) {
      if (error.message && error.message.includes('404')) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get the structure (schema/fields) of a collection
   * @param {string} collectionId - ID of the collection
   * @returns {Promise<object[]>} Array of field definitions
   */
  async getCollectionStructure(collectionId) {
    const collection = await this.getCollection(collectionId);
    return collection.fields || [];
  }

  /**
   * Validate that the Vacatures collection has all required fields
   * @returns {Promise<object>} Validation result with success flag and any missing fields
   */
  async validateVacaturesCollection() {
    try {
      // Required fields for job synchronization
      const requiredFields = [
        'name',
        'slug',
        'mysolution-id',
        'job-excerpt-v1',
        'job-long-description-page',
        'job-requirements',
        'job-responsibilities',
        'job-description',
        'vacature-type',
        'vacature-locatie',
        'vacature-salaris',
        'job-is-featured'
      ];
      
      // Get the collection structure
      const fields = await this.getCollectionStructure(this.jobsCollectionId);
      
      // Check if all required fields exist
      const fieldNames = fields.map(field => field.slug || field.id || field.name);
      const missingFields = requiredFields.filter(field => !fieldNames.includes(field));
      
      if (missingFields.length > 0) {
        logger.warn('Vacatures collection is missing required fields', { missingFields });
        return {
          success: false,
          missingFields
        };
      }
      
      logger.info('Vacatures collection structure validated successfully');
      return {
        success: true
      };
    } catch (error) {
      logger.error('Error validating Vacatures collection structure', { error: error.message });
      throw new Error(`Failed to validate Vacatures collection: ${error.message}`);
    }
  }

  /**
   * Get collection items with pagination
   * @param {string} collectionId - ID of the collection
   * @param {object} options - Query options (limit, offset, etc.)
   * @returns {Promise<{ items: object[], total: number, limit: number, offset: number }>} Paginated items
   */
  async getPaginatedItems(collectionId, options = {}) {
    try {
      const params = {
        limit: options.limit || 100,
        offset: options.offset || 0,
        sort: options.sort || [],
        ...options.filter && { filter: options.filter }
      };
      
      // Make the request
      const response = await this._makeRequest('get', `/collections/${collectionId}/items`, { params });
      
      return {
        items: response.items || [],
        total: response.total || 0,
        limit: params.limit,
        offset: params.offset
      };
    } catch (error) {
      logger.error(`Error fetching paginated items from collection ${collectionId}`, { 
        error: error.message, 
        options 
      });
      throw error;
    }
  }

  /**
   * Get all items from a collection, handling pagination automatically
   * @param {string} collectionId - ID of the collection
   * @param {object} options - Query options (sort, filter)
   * @returns {Promise<object[]>} All collection items
   */
  async getAllItems(collectionId, options = {}) {
    try {
      const batchSize = 100;
      let allItems = [];
      let offset = 0;
      let hasMore = true;
      
      // Options without pagination parameters
      const queryOptions = {
        ...options,
        limit: batchSize
      };
      
      while (hasMore) {
        queryOptions.offset = offset;
        
        const { items, total } = await this.getPaginatedItems(collectionId, queryOptions);
        
        allItems = [...allItems, ...items];
        offset += batchSize;
        
        // Check if we've retrieved all items
        hasMore = allItems.length < total;
      }
      
      logger.info(`Retrieved ${allItems.length} items from collection ${collectionId}`);
      return allItems;
    } catch (error) {
      logger.error(`Error fetching all items from collection ${collectionId}`, { 
        error: error.message,
        options
      });
      throw error;
    }
  }

  /**
   * Find item in collection by a specific field value
   * @param {string} collectionId - ID of the collection
   * @param {string} fieldName - Field to search by
   * @param {any} fieldValue - Value to search for
   * @returns {Promise<object|null>} Found item or null
   */
  async findItemByField(collectionId, fieldName, fieldValue) {
    try {
      // Webflow API doesn't support server-side filtering by custom fields,
      // so we need to retrieve items and filter client-side
      const items = await this.getItems(collectionId);
      
      return items.find(item => {
        // Handle both direct fields and nested fieldData
        if (item.fieldData && item.fieldData[fieldName] !== undefined) {
          return item.fieldData[fieldName] === fieldValue;
        }
        return item[fieldName] === fieldValue;
      }) || null;
    } catch (error) {
      logger.error(`Error finding item by field ${fieldName} in collection ${collectionId}`, {
        error: error.message,
        fieldName,
        fieldValue
      });
      throw error;
    }
  }

  // Collection items endpoints
  async getItems(collectionId, options = {}) {
    return this._makeRequest('get', `/collections/${collectionId}/items`, { params: options });
  }

  async getItem(collectionId, itemId) {
    return this._makeRequest('get', `/collections/${collectionId}/items/${itemId}`);
  }

  async createItem(collectionId, itemData) {
    return this._makeRequest('post', `collections/${collectionId}/items`, {
      fieldData: itemData,
      isDraft: false
    });
  }

  async updateItem(collectionId, itemId, itemData) {
    return this._makeRequest('patch', `collections/${collectionId}/items/${itemId}`, {
      fieldData: itemData,
      isDraft: false,
      isArchived: false
    });
  }

  async deleteItem(collectionId, itemId) {
    return this._makeRequest('delete', `/collections/${collectionId}/items/${itemId}`);
  }

  // Job-specific methods
  async getJobs(options = {}) {
    logger.debug('Fetching jobs from Webflow');
    return this.getItems(this.jobsCollectionId, options);
  }

  async getJob(jobId) {
    return this.getItem(this.jobsCollectionId, jobId);
  }

  /**
   * Get all jobs, handling pagination automatically
   * @param {object} options - Query options (sort, filter)
   * @returns {Promise<object[]>} All jobs
   */
  async getAllJobs(options = {}) {
    return this.getAllItems(this.jobsCollectionId, options);
  }

  /**
   * Find a job by Mysolution ID
   * @param {string} mysolutionId - Mysolution ID to search for
   * @returns {Promise<object|null>} Job data or null if not found
   */
  async findJobByMysolutionId(mysolutionId) {
    if (!mysolutionId) {
      console.log('WARNING: Empty Mysolution ID provided to findJobByMysolutionId');
      return null;
    }
    
    console.log(`Looking for job with Mysolution ID: ${mysolutionId}`);
    const result = await this.findItemByField(this.jobsCollectionId, 'mysolution-id', mysolutionId);
    
    if (result) {
      console.log(`Found job in Webflow with Mysolution ID ${mysolutionId}: ${result.id}`);
    } else {
      console.log(`No job found in Webflow with Mysolution ID ${mysolutionId}`);
    }
    
    return result;
  }

  /**
   * Check if a job with the given Mysolution ID exists
   * @param {string} mysolutionId - Mysolution ID to check
   * @returns {Promise<boolean>} True if job exists
   */
  async jobExistsByMysolutionId(mysolutionId) {
    const job = await this.findJobByMysolutionId(mysolutionId);
    return job !== null;
  }

  /**
   * Create a job in the jobs collection
   * @param {object} jobData - Job data to create
   * @returns {Promise<object>} Created job data with action metadata
   */
  async createJob(jobData) {
    console.log('===== CREATING JOB IN WEBFLOW =====');
    console.log('Job data being sent to Webflow API:', JSON.stringify(jobData, null, 2));
    
    try {
      // Check for null or undefined values in top-level properties
      const invalidFields = [];
      Object.entries(jobData).forEach(([key, value]) => {
        if (value === null || value === undefined) {
          invalidFields.push(key);
        }
      });
      
      if (invalidFields.length > 0) {
        console.warn('WARNING: Job data contains null/undefined values which may cause validation errors:', invalidFields);
        // Remove null/undefined fields to prevent validation errors
        invalidFields.forEach(field => {
          console.log(`Removing null/undefined field: ${field}`);
          delete jobData[field];
        });
      }
      
      // Wrap job data in the required structure for Webflow API v2
      const payload = {
        fieldData: jobData,
        isDraft: false
      };
      
      console.log('Formatted payload for Webflow API:', JSON.stringify(payload, null, 2));
      
      const result = await this._makeRequest('post', `collections/${this.jobsCollectionId}/items`, payload);
      console.log('Webflow API creation response:', JSON.stringify(result, null, 2));
      
      return {
        ...result,
        action: 'created'
      };
    } catch (error) {
      console.error('Error creating job in Webflow:', error.message);
      throw error;
    }
  }

  /**
   * Update a job in the jobs collection
   * @param {string} jobId - ID of the job to update
   * @param {object} jobData - Job data to update
   * @returns {Promise<object>} Updated job data with action metadata
   */
  async updateJob(jobId, jobData) {
    console.log('===== UPDATING JOB IN WEBFLOW =====');
    console.log(`Updating job ID: ${jobId}`);
    console.log('Job data being sent to Webflow API:', JSON.stringify(jobData, null, 2));
    
    try {
      // Check for null or undefined values in top-level properties
      const invalidFields = [];
      Object.entries(jobData).forEach(([key, value]) => {
        if (value === null || value === undefined) {
          invalidFields.push(key);
        }
      });
      
      if (invalidFields.length > 0) {
        console.warn('WARNING: Job data contains null/undefined values which may cause validation errors:', invalidFields);
        // Remove null/undefined fields to prevent validation errors
        invalidFields.forEach(field => {
          console.log(`Removing null/undefined field: ${field}`);
          delete jobData[field];
        });
      }
      
      // Wrap job data in the required structure for Webflow API v2
      const payload = {
        fieldData: jobData,
        isDraft: false,
        isArchived: false
      };
      
      console.log('Formatted payload for Webflow API:', JSON.stringify(payload, null, 2));
      
      const result = await this._makeRequest('patch', `collections/${this.jobsCollectionId}/items/${jobId}`, payload);
      console.log('Webflow API update response:', JSON.stringify(result, null, 2));
      
      return {
        ...result,
        action: 'updated'
      };
    } catch (error) {
      console.error('Error updating job in Webflow:', error.message);
      throw error;
    }
  }

  /**
   * Create or update a job by Mysolution ID
   * @param {string} mysolutionId - Mysolution job ID
   * @param {object} jobData - Job data
   * @returns {Promise<object>} - Created or updated job
   */
  async createOrUpdateJobByMysolutionId(mysolutionId, jobData) {
    if (!mysolutionId) {
      throw new Error('Mysolution ID is required');
    }
    
    try {
      // Validate job data to ensure it matches Webflow's expectations
      if (!jobData['name']) {
        logger.error('Job data is missing required "name" field');
        throw new Error('Job name is required');
      }
      
      // Validate and clean up field data to prevent validation errors
      // Remove any null or undefined values
      Object.keys(jobData).forEach(key => {
        if (jobData[key] === null || jobData[key] === undefined) {
          logger.debug(`Removing null/undefined field ${key} from job data`);
          delete jobData[key];
        }
      });
      
      // Remove problematic custom archive fields if they exist
      const fieldsToRemove = ['archived', 'archive-reason', 'archive-date'];
      fieldsToRemove.forEach(field => {
        if (field in jobData) {
          logger.debug(`Removing custom archive field ${field} from job data`);
          delete jobData[field];
        }
      });
      
      // Check if sector reference is properly formatted
      if (jobData['job-companies'] && typeof jobData['job-companies'] === 'string') {
        const sectorId = jobData['job-companies'];
        logger.debug(`Found sector ID in jobData: ${sectorId}`);
        
        // Ensure it's a valid ID before proceeding
        try {
          // Attempt to get the sector to validate it exists
          const sectorsCollectionId = await this.getSectorsCollection();
          if (sectorsCollectionId) {
            try {
              await this.getItem(sectorsCollectionId, sectorId);
              logger.debug(`Verified sector ID ${sectorId} exists in collection ${sectorsCollectionId}`);
            } catch (error) {
              // If sector doesn't exist, log warning and remove from job data
              logger.warn(`Sector ID ${sectorId} not found in collection ${sectorsCollectionId}, removing reference`);
              delete jobData['job-companies'];
            }
          }
        } catch (error) {
          logger.warn(`Error validating sector ID ${sectorId}:`, error);
          // Remove invalid reference
          delete jobData['job-companies'];
        }
      }
      
      // Ensure slug is properly formatted
      if (jobData['slug']) {
        // Convert to lowercase, replace spaces with hyphens, remove special characters
        jobData['slug'] = jobData['slug']
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^\w\-]+/g, '')
          .replace(/\-\-+/g, '-')
          .replace(/^-+/, '')
          .replace(/-+$/, '');
      }
      
      // Validate job data against collection schema
      console.log('Validating job data against Webflow collection schema...');
      const validatedJobData = await this.validateJobData(jobData);
      
      // Find existing job
      const existingJob = await this.findJobByMysolutionId(mysolutionId);
      
      if (existingJob) {
        logger.debug(`Updating existing job with Mysolution ID ${mysolutionId}`);
        return this.updateJob(existingJob.id, validatedJobData);
      } else {
        logger.debug(`Creating new job with Mysolution ID ${mysolutionId}`);
        return this.createJob(validatedJobData);
      }
    } catch (error) {
      logger.error(`Error creating or updating job with Mysolution ID ${mysolutionId}:`, error);
      throw error;
    }
  }

  async deleteJob(jobId) {
    logger.debug('Deleting job from Webflow', { jobId });
    return this.deleteItem(this.jobsCollectionId, jobId);
  }

  /**
   * Archive a job in Webflow (marks it as archived without deleting it)
   * @param {string} jobId - ID of the job to archive
   * @returns {Promise<object>} Update result
   */
  async archiveJob(jobId) {
    console.log(`===== ARCHIVING JOB IN WEBFLOW =====`);
    console.log(`Archiving job ID: ${jobId}`);
    
    try {
      // Create payload with isArchived flag set to true
      const payload = {
        fieldData: {}, // No field data changes required
        isDraft: false,
        isArchived: true
      };
      
      console.log('Archiving job with payload:', JSON.stringify(payload, null, 2));
      
      const result = await this._makeRequest('patch', `collections/${this.jobsCollectionId}/items/${jobId}`, payload);
      console.log('Webflow API archive response:', JSON.stringify(result, null, 2));
      
      return {
        ...result,
        action: 'archived'
      };
    } catch (error) {
      console.error(`Error archiving job ${jobId} in Webflow:`, error.message);
      throw error;
    }
  }

  /**
   * Delete a job by Mysolution ID
   * @param {string} mysolutionId - Mysolution ID of the job to delete
   * @returns {Promise<boolean>} True if job was deleted, false if not found
   */
  async deleteJobByMysolutionId(mysolutionId) {
    try {
      const job = await this.findJobByMysolutionId(mysolutionId);
      if (job) {
        await this.deleteJob(job.id);
        logger.info(`Deleted job with Mysolution ID ${mysolutionId}`);
        return true;
      }
      logger.warn(`Job with Mysolution ID ${mysolutionId} not found for deletion`);
      return false;
    } catch (error) {
      logger.error(`Error deleting job with Mysolution ID ${mysolutionId}`, {
        error: error.message
      });
      throw error;
    }
  }

  // Candidate-specific methods
  async getCandidates(options = {}) {
    if (!this.candidatesCollectionId) {
      logger.error('Webflow Candidates Collection ID is not set');
      throw new Error('WEBFLOW_CANDIDATES_COLLECTION_ID is required for this operation');
    }
    return this.getItems(this.candidatesCollectionId, options);
  }

  async getCandidate(candidateId) {
    if (!this.candidatesCollectionId) {
      logger.error('Webflow Candidates Collection ID is not set');
      throw new Error('WEBFLOW_CANDIDATES_COLLECTION_ID is required for this operation');
    }
    return this.getItem(this.candidatesCollectionId, candidateId);
  }

  async createCandidate(candidateData) {
    if (!this.candidatesCollectionId) {
      logger.error('Webflow Candidates Collection ID is not set');
      throw new Error('WEBFLOW_CANDIDATES_COLLECTION_ID is required for this operation');
    }
    return this.createItem(this.candidatesCollectionId, candidateData);
  }

  async updateCandidate(candidateId, candidateData) {
    if (!this.candidatesCollectionId) {
      logger.error('Webflow Candidates Collection ID is not set');
      throw new Error('WEBFLOW_CANDIDATES_COLLECTION_ID is required for this operation');
    }
    return this.updateItem(this.candidatesCollectionId, candidateId, candidateData);
  }

  async deleteCandidate(candidateId) {
    if (!this.candidatesCollectionId) {
      logger.error('Webflow Candidates Collection ID is not set');
      throw new Error('WEBFLOW_CANDIDATES_COLLECTION_ID is required for this operation');
    }
    return this.deleteItem(this.candidatesCollectionId, candidateId);
  }

  /**
   * Get the sectors collection ID
   * @returns {Promise<string>} Collection ID of the sectors collection
   */
  async getSectorsCollection() {
    try {
      // Use the configured sectors collection ID if available
      if (this.sectorsCollectionId) {
        logger.info(`Using configured sectors collection ID: ${this.sectorsCollectionId}`);
        try {
          // Verify that the collection exists
          const collection = await this.getCollection(this.sectorsCollectionId);
          logger.info(`Verified sectors collection: ${collection.name} (${collection.id})`);
          return this.sectorsCollectionId;
        } catch (error) {
          logger.error(`Invalid sectors collection ID: ${this.sectorsCollectionId}`, { 
            error: error.message,
            stack: error.stack
          });
          // Continue to try finding the collection
        }
      }

      // Get all collections
      logger.debug('Fetching all collections to find sectors collection');
      const collections = await this.getCollections();
      logger.debug(`Found ${collections.length} collections`);
      
      for (const collection of collections) {
        logger.debug(`Collection: ${collection.name} (${collection.id})`);
      }
      
      // Find the sectors collection (likely named "Vacature Sectoren")
      const sectorsCollection = collections.find(collection => 
        collection.name.toLowerCase().includes('sector') || 
        collection.slug.toLowerCase().includes('sector')
      );
      
      if (!sectorsCollection) {
        logger.warn('Could not find sectors collection. Job-companies references will not be set.');
        return null;
      }
      
      // Store for future use
      this.sectorsCollectionId = sectorsCollection.id;
      logger.info(`Found sectors collection: ${sectorsCollection.name} (${sectorsCollection.id})`);
      
      return sectorsCollection.id;
    } catch (error) {
      logger.error('Error finding sectors collection:', { 
        error: error.message,
        stack: error.stack
      });
      return null;
    }
  }
  
  /**
   * Get all sectors from the sectors collection
   * @returns {Promise<Array>} List of sectors
   */
  async getAllSectors() {
    try {
      // Force refresh if sectors aren't cached or were cached more than 1 hour ago
      const now = Date.now();
      const needsRefresh = !this.sectors || 
                          !this.lastSectorsFetch || 
                          (now - this.lastSectorsFetch) > 3600000; // 1 hour
      
      if (!needsRefresh && this.sectors) {
        logger.debug(`Using cached sectors (${this.sectors.length} items)`);
        return this.sectors;
      }
      
      // Get sectors collection ID
      logger.debug('Getting sectors collection ID');
      const sectorsCollectionId = await this.getSectorsCollection();
      
      if (!sectorsCollectionId) {
        logger.warn('No sectors collection ID found, unable to get sectors');
        return [];
      }
      
      // Get all sectors
      logger.debug(`Fetching items from sectors collection: ${sectorsCollectionId}`);
      const sectors = await this.getAllItems(sectorsCollectionId);
      
      // Cache sectors for future use
      this.sectors = sectors;
      this.lastSectorsFetch = now;
      
      logger.info(`Fetched ${sectors.length} sectors from collection ${sectorsCollectionId}`);
      
      // Log all sector names and IDs at debug level
      if (sectors.length > 0) {
        logger.debug('Available sectors:');
        sectors.forEach(sector => {
          logger.debug(`- ${sector.name} (${sector.id})`);
        });
      } else {
        logger.warn('No sectors found in collection');
      }
      
      return sectors;
    } catch (error) {
      logger.error('Error fetching sectors:', { 
        error: error.message,
        stack: error.stack
      });
      return [];
    }
  }
  
  /**
   * Find a sector by name
   * @param {string} sectorName - Name of the sector to find
   * @returns {Promise<Object|null>} Sector object or null if not found
   */
  async findSectorByName(sectorName) {
    if (!sectorName) {
      return null;
    }
    
    try {
      // Get all sectors
      const sectors = await this.getAllSectors();
      
      // If we don't have any sectors, log and return null
      if (!sectors || sectors.length === 0) {
        logger.warn(`No sectors available in collection when looking for "${sectorName}"`);
        return null;
      }
      
      // Log the actual fields in the first sector to help with debugging
      if (sectors.length > 0) {
        logger.debug(`Sample sector data structure: ${JSON.stringify(sectors[0])}`);
      }
      
      // Normalize the search name (lowercase, trim, remove special chars)
      const normalizedSearch = sectorName.toLowerCase()
        .trim()
        .replace(/&/g, 'and')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ');
      
      logger.debug(`Looking for sector match for "${sectorName}" (normalized: "${normalizedSearch}")`);
      
      // Define matching strategies in order of preference
      const matchStrategies = [
        // 1. Exact match on name field
        s => s.name && s.name.toLowerCase() === normalizedSearch,
        
        // 2. Exact match on fieldData.name if available
        s => s.fieldData && s.fieldData.name && 
             s.fieldData.name.toLowerCase() === normalizedSearch,
        
        // 3. Normalized match (remove special chars, standardize spacing)
        s => {
          const name = s.name || (s.fieldData && s.fieldData.name) || '';
          const normalizedName = name.toLowerCase()
            .trim()
            .replace(/&/g, 'and')
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ');
          return normalizedName === normalizedSearch;
        },
        
        // 4. Contains match (sector name contains search term or vice versa)
        s => {
          const name = s.name || (s.fieldData && s.fieldData.name) || '';
          const normalizedName = name.toLowerCase()
            .trim()
            .replace(/&/g, 'and')
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ');
          return normalizedName.includes(normalizedSearch) || normalizedSearch.includes(normalizedName);
        },
        
        // 5. Word match (at least one word is shared)
        s => {
          const name = s.name || (s.fieldData && s.fieldData.name) || '';
          const normalizedName = name.toLowerCase()
            .trim()
            .replace(/&/g, 'and')
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ');
          
          const nameWords = normalizedName.split(' ');
          const searchWords = normalizedSearch.split(' ');
          
          return nameWords.some(word => searchWords.includes(word) && word.length > 2);
        }
      ];
      
      // Try each matching strategy in order
      for (const strategy of matchStrategies) {
        const match = sectors.find(strategy);
        if (match) {
          logger.debug(`Found sector match for "${sectorName}": ${match.name || (match.fieldData && match.fieldData.name)} (${match.id})`);
          return match;
        }
      }
      
      logger.debug(`No sector match found for "${sectorName}"`);
      return null;
    } catch (error) {
      logger.error(`Error finding sector by name "${sectorName}":`, { 
        error: error.message,
        stack: error.stack
      });
      return null;
    }
  }

  /**
   * Validate job data against collection schema to prevent validation errors
   * @param {object} jobData - Job data to validate
   * @returns {Promise<object>} - Validated and cleaned job data
   */
  async validateJobData(jobData) {
    try {
      // Get collection schema/structure
      const fields = await this.getCollectionStructure(this.jobsCollectionId);
      
      // Extract valid field slugs/IDs from collection
      const validFields = fields.map(field => field.slug || field.id);
      console.log('Valid fields in collection:', validFields);
      
      // Explicitly blacklist fields we know are problematic
      const blacklistedFields = ['archived', 'archive-reason', 'archive-date'];
      
      // Keep track of fields that are not in the schema
      const invalidFields = [];
      const cleanedData = {};
      
      // Only keep fields that exist in the schema
      Object.entries(jobData).forEach(([key, value]) => {
        // Skip null/undefined values
        if (value === null || value === undefined) {
          return;
        }
        
        // Skip blacklisted fields
        if (blacklistedFields.includes(key)) {
          invalidFields.push(key);
          return;
        }
        
        // Check if field exists in schema
        if (validFields.includes(key)) {
          cleanedData[key] = value;
        } else {
          invalidFields.push(key);
        }
      });
      
      // Log any invalid fields
      if (invalidFields.length > 0) {
        console.warn(`Removing ${invalidFields.length} fields not in schema:`, invalidFields);
        logger.warn('Removing fields not in Webflow schema', { invalidFields });
      }
      
      return cleanedData;
    } catch (error) {
      logger.error('Error validating job data against schema:', error);
      console.error('Error validating job data against schema:', error.message);
      
      // If we can't validate, return the original data as a fallback
      return jobData;
    }
  }
}

const webflowAPI = new WebflowAPI();
export default webflowAPI; 