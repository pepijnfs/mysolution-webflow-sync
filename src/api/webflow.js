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
    this.employeesCollectionId = config.webflow.employeesCollectionId;
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
            
            // For validation errors, try to extract and include specific field errors in the message
            if (error.response.data.code === 'validation_error' && 
                error.response.data.details && 
                error.response.data.details.length > 0) {
              
              // Create a detailed error message with all field errors
              const fieldErrors = error.response.data.details.map(detail => {
                return `${detail.param}: ${detail.description}`;
              }).join('; ');
              
              throw new Error(
                `Webflow API ${error.response.status} error: ${error.response.data.message} - ${fieldErrors}`
              );
            }
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
      console.log('==== PUBLISHING SITE TO ALL DOMAINS (STAGING + PRODUCTION) ====');
      // Always get the latest site data to ensure we have the correct domain IDs
      console.log('Fetching site information...');
      const siteInfo = await this.getSite();
      console.log(`Retrieved site information for site ${siteInfo.name} (${this.siteId})`);
      
      // Create a payload that publishes to BOTH the Webflow subdomain AND custom domains
      // This ensures that the site is published to both baselifesciences.webflow.io AND baseselect.nl
      const payload = {
        publishToWebflowSubdomain: true
      };
      
      // Add custom domain IDs if available to also publish to main baseselect.nl domain
      if (this.customDomains && this.customDomains.length > 0) {
        payload.customDomains = this.customDomains;
        console.log(`Publishing to Webflow subdomain AND ${this.customDomains.length} custom domain(s) including baseselect.nl`);
      } else {
        console.log('Publishing to Webflow subdomain only (no custom domains found)');
      }
      
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
      let pageCount = 0;
      let totalFetched = 0;
      
      // Options without pagination parameters
      const queryOptions = {
        ...options,
        limit: batchSize
      };
      
      console.log(`===== PAGINATION: Starting getAllItems for collection ${collectionId} =====`);
      console.log(`- Using batch size: ${batchSize}`);
      
      while (hasMore) {
        queryOptions.offset = offset;
        pageCount++;
        
        console.log(`\n- Fetching page ${pageCount} with offset ${offset}...`);
        const { items, total } = await this.getPaginatedItems(collectionId, queryOptions);
        
        // If no items returned or empty array, we're done
        if (!items || items.length === 0) {
          console.log(`- Page ${pageCount}: No items returned, stopping pagination`);
          hasMore = false;
          break;
        }
        
        const currentBatchSize = items.length;
        totalFetched += currentBatchSize;
        console.log(`- Page ${pageCount}: Retrieved ${currentBatchSize} items, total so far: ${totalFetched}`);
        
        allItems = [...allItems, ...items];
        offset += items.length;
        
        // Check if we've retrieved all items - two ways to determine:
        // 1. If total is provided (and is a valid non-zero number) and we've reached it
        if (total !== undefined && total > 0) {
          console.log(`- Total items reported by API: ${total}, fetched so far: ${allItems.length}`);
          if (allItems.length >= total) {
            console.log(`- Stopping pagination: reached reported total of ${total} items`);
            hasMore = false;
            break;
          }
        } else {
          console.log(`- API returned invalid total count: ${total}, ignoring and continuing pagination`);
        }
        
        // 2. If we received fewer items than requested batch size (indicates last page)
        if (currentBatchSize < batchSize) {
          console.log(`- Received ${currentBatchSize} items (less than batch size ${batchSize})`);
          console.log('- This indicates we\'ve reached the last page, stopping pagination');
          hasMore = false;
          break;
        }
        
        // 3. If we're on the first page, always try to get at least one more page
        // This handles cases where the API doesn't report the correct total count
        if (pageCount === 1 && currentBatchSize === batchSize) {
          console.log(`- First page returned exactly ${batchSize} items, forcing request of at least one more page`);
          hasMore = true;
        }
        
        // Safety check - prevent infinite loops
        if (pageCount > 100) {
          console.log('- SAFETY LIMIT: Reached max page count (100), stopping pagination');
          logger.warn(`Reached maximum page count (100) when fetching items from collection ${collectionId}`);
          hasMore = false;
          break;
        }
      }
      
      console.log(`\n===== PAGINATION COMPLETE: Retrieved ${allItems.length} total items across ${pageCount} pages =====`);
      logger.info(`Retrieved ${allItems.length} items from collection ${collectionId} in ${pageCount} pages`);
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
      const items = await this.getAllItems(collectionId);
      
      logger.debug(`Retrieved ${items.length} items to search for ${fieldName}=${fieldValue}`);
      
      const item = items.find(item => {
        // Handle both direct fields and nested fieldData
        if (item.fieldData && item.fieldData[fieldName] !== undefined) {
          return item.fieldData[fieldName] === fieldValue;
        }
        return item[fieldName] === fieldValue;
      }) || null;
      
      if (item) {
        logger.debug(`Found item with ${fieldName}=${fieldValue}: ${item.id}`);
      } else {
        logger.debug(`No item found with ${fieldName}=${fieldValue}`);
      }
      
      return item;
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
      
      try {
        const result = await this._makeRequest('post', `collections/${this.jobsCollectionId}/items`, payload);
        console.log('Webflow API creation response:', JSON.stringify(result, null, 2));
        
        return {
          ...result,
          action: 'created'
        };
      } catch (error) {
        // Check if it's a duplicate slug error
        if (error.message.includes('Validation Error') && 
            error.message.includes('slug') && 
            error.message.includes('already in database')) {
          
          console.log('Detected duplicate slug error. Generating a unique slug and retrying...');
          
          // Generate a unique slug with random suffix
          const originalSlug = jobData['slug'] || '';
          jobData['slug'] = this._generateUniqueSlug(originalSlug);
          
          console.log(`Generated unique slug: ${jobData['slug']}`);
          
          // Update payload with new slug
          payload.fieldData = jobData;
          
          // Retry the request with the new slug
          const retryResult = await this._makeRequest('post', `collections/${this.jobsCollectionId}/items`, payload);
          console.log('Retry successful with new slug:', retryResult);
          
          return {
            ...retryResult,
            action: 'created (with unique slug)'
          };
        }
        
        // If it's not a slug error or the retry failed, rethrow
        throw error;
      }
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
      // Preserve existing URL slug on updates to avoid breaking links
      if (Object.prototype.hasOwnProperty.call(jobData, 'slug')) {
        console.log('Preserving existing slug on update – removing provided slug from payload');
        delete jobData['slug'];
      }
      
      // Enhanced debugging for validation errors
      console.log('DETAILED JOB DATA VALIDATION:');
      console.log('- vacature-salaris:', jobData['vacature-salaris'], typeof jobData['vacature-salaris']);
      console.log('- vacature-type:', jobData['vacature-type'], typeof jobData['vacature-type']);
      console.log('- uren-per-week:', jobData['uren-per-week'], typeof jobData['uren-per-week']);
      console.log('- hourly:', jobData['hourly'], typeof jobData['hourly']);
      
      // Verify that dropdown values are among allowed options
      const allowedSalaryOptions = [
        'In overleg',
        '35.000-40.000',
        '40.000-45.000',
        '45.000-50.000',
        '50.000-55.000',
        '55.000-60.000',
        '60.000-65.000',
        '65.000-70.000',
        '70.000-75.000',
        '75.000-80.000',
        '80.000-85.000',
        '85.000-90.000',
        '90.000-95.000',
        '95.000-100.000',
        '100.000-105.000',
        '105.000-110.000',
        '110.000-115.000',
        '115.000-120.000',
        '125.000+'
      ];
      
      const allowedEmploymentTypes = ['Vast', 'Interim'];
      const allowedHoursOptions = ['16-24 uur', '24-32 uur', '32-36 uur', '36-40 uur'];
      const allowedHourlyOptions = [
        'In overleg',
        '55-60',
        '60-65',
        '65-70',
        '70-75',
        '75-80',
        '80-85',
        '85-90',
        '90-95',
        '95-100',
        '100-105',
        '105-110',
        '110-115',
        '115-120',
        '120-125',
        '125+'
      ];
      
      // Check and fix salary option
      if (jobData['vacature-salaris'] && !allowedSalaryOptions.includes(jobData['vacature-salaris'])) {
        console.log(`WARNING: Invalid salary option: "${jobData['vacature-salaris']}"`);
        console.log(`Allowed options are: ${allowedSalaryOptions.join(', ')}`);
        jobData['vacature-salaris'] = 'In overleg'; // Default to safe value
      }
      
      // Check and fix employment type
      if (jobData['vacature-type'] && !allowedEmploymentTypes.includes(jobData['vacature-type'])) {
        console.log(`WARNING: Invalid employment type: "${jobData['vacature-type']}"`);
        console.log(`Allowed options are: ${allowedEmploymentTypes.join(', ')}`);
        jobData['vacature-type'] = 'Vast'; // Default to safe value
      }
      
      // Check and fix hours option
      if (jobData['uren-per-week'] && !allowedHoursOptions.includes(jobData['uren-per-week'])) {
        console.log(`WARNING: Invalid hours option: "${jobData['uren-per-week']}"`);
        console.log(`Allowed options are: ${allowedHoursOptions.join(', ')}`);
        jobData['uren-per-week'] = '36-40 uur'; // Default to safe value
      }
      
      // Check and fix hourly rate option
      if (jobData['hourly'] && !allowedHourlyOptions.includes(jobData['hourly'])) {
        console.log(`WARNING: Invalid hourly rate option: "${jobData['hourly']}"`);
        console.log(`Allowed options are: ${allowedHourlyOptions.join(', ')}`);
        jobData['hourly'] = 'In overleg'; // Default to safe value
      }
      
      // Separate handling for option fields that need to be cleared
      const optionFieldsToHandle = {
        'vacature-salaris': null,
        'hourly': null
      };
      
      // Track fields to clear (with explicit null values)
      const fieldsToSetNull = [];
      
      // Check for null values in dropdown fields that should be explicitly cleared
      Object.entries(jobData).forEach(([key, value]) => {
        if (key in optionFieldsToHandle && value === null) {
          fieldsToSetNull.push(key);
          console.log(`Field ${key} will be explicitly set to null to clear it`);
        }
      });
      
      // CRITICAL FIX: Final check to ensure internal jobs keep their sector
      const internalSectorId = '65f935a2e6b9d7f69afed2bb';
      if (jobData['job-companies'] === internalSectorId) {
        console.log(`🔒 PRESERVING INTERNAL JOB SECTOR: Job ${jobId} has internal sector ID, ensuring it's preserved`);
      }
      
      // Check for other null or undefined values in top-level properties
      const invalidFields = [];
      Object.entries(jobData).forEach(([key, value]) => {
        // Skip fields that we're intentionally setting to null
        if (fieldsToSetNull.includes(key)) {
          return;
        }
        
        if (value === null || value === undefined) {
          invalidFields.push(key);
        }
      });
      
      if (invalidFields.length > 0) {
        console.warn('WARNING: Job data contains null/undefined values which may cause validation errors:', invalidFields);
        // Remove null/undefined fields to prevent validation errors (except explicit null fields)
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
      
      // Final safety check: ALWAYS preserve internal sector ID if it's set
      if (payload.fieldData['job-companies'] === internalSectorId) {
        console.log(`✅ FINAL CHECK: Internal sector ID confirmed for job ${jobId}`);
      } else if (jobData['job-companies'] === internalSectorId) {
        console.log(`🔄 FINAL FIX: Restoring internal sector ID for job ${jobId} that was lost in the payload`);
        payload.fieldData['job-companies'] = internalSectorId;
      }
      
      console.log('Formatted payload for Webflow API:', JSON.stringify(payload, null, 2));
      
      try {
        const result = await this._makeRequest('patch', `collections/${this.jobsCollectionId}/items/${jobId}`, payload);
        console.log('Webflow API update response:', JSON.stringify(result, null, 2));
        
        return {
          ...result,
          action: 'updated'
        };
      } catch (error) {
        // Check if it's a duplicate slug error – on updates, never regenerate slug, just remove and retry
        if (error.message.includes('Validation Error') && 
            error.message.includes('slug') && 
            error.message.includes('already in database')) {
          console.log('Detected duplicate slug error during update. Will preserve existing slug by removing it from payload and retrying...');
          if (Object.prototype.hasOwnProperty.call(jobData, 'slug')) {
            delete jobData['slug'];
            payload.fieldData = jobData;
          }
          const retryResult = await this._makeRequest('patch', `collections/${this.jobsCollectionId}/items/${jobId}`, payload);
          console.log('Retry successful after preserving slug:', retryResult);
          return {
            ...retryResult,
            action: 'updated (slug preserved)'
          };
        }
        
        // Enhanced error reporting for validation errors
        console.error('ERROR updating job in Webflow:', error.message);
        
        if (error.message.includes('Validation Error')) {
          console.error('VALIDATION ERROR DETAILS:');
          console.error('This is likely caused by an invalid option in a dropdown field.');
          console.error('Job data that failed validation:', JSON.stringify(jobData, null, 2));
          
          // Try a more minimal update as fallback
          console.log('Attempting fallback with minimal data set...');
          const minimalData = {
            'name': jobData['name'],
            'slug': jobData['slug'],
            'mysolution-id': jobData['mysolution-id'],
            'vacature-salaris': 'In overleg',
            'vacature-type': 'Vast',
            'uren-per-week': '36-40 uur',
            'hourly': 'In overleg'
          };
          
          console.log('Fallback minimal data:', JSON.stringify(minimalData, null, 2));
          
          const fallbackPayload = {
            fieldData: minimalData,
            isDraft: false,
            isArchived: false
          };
          
          try {
            console.log('Attempting fallback update with minimal data...');
            const fallbackResult = await this._makeRequest('patch', `collections/${this.jobsCollectionId}/items/${jobId}`, fallbackPayload);
            console.log('Fallback update succeeded:', JSON.stringify(fallbackResult, null, 2));
            
            return {
              ...fallbackResult,
              action: 'updated (fallback)'
            };
          } catch (fallbackError) {
            console.error('Fallback update also failed:', fallbackError.message);
            throw new Error(`Both normal and fallback updates failed: ${error.message}`);
          }
        }
        
        throw error;
      }
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
      
      // Additional validation for dropdown fields
      this._validateDropdownFields(jobData);
      
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
        
        // Special handling for internal job sector (Interne Vacature)
        const internalSectorId = '65f935a2e6b9d7f69afed2bb';
        if (sectorId === internalSectorId) {
          logger.info(`Job has internal sector ID (${internalSectorId}), preserving it for Webflow update`);
          // Continue with this ID without additional validation
        } else {
          // For non-internal sectors, ensure it's a valid ID before proceeding
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
      }
      
      // Ensure slug is properly formatted
      if (jobData['slug']) {
        // Convert to lowercase, replace spaces with hyphens, remove special characters
        jobData['slug'] = jobData['slug']
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^\w-]+/g, '')
          .replace(/--+/g, '-')
          .replace(/^-+/, '')
          .replace(/-+$/, '');
      }
      
      // Validate job data against collection schema
      console.log('Validating job data against Webflow collection schema...');
      const validatedJobData = await this.validateJobData(jobData);
      
      // CRITICAL FIX: Explicitly ensure internal jobs ALWAYS have the Interne Vacature sector
      // This is a hardcoded protection to ensure Webflow doesn't overwrite the internal sector
      const internalSectorId = '65f935a2e6b9d7f69afed2bb';
      if (validatedJobData['job-companies'] === internalSectorId) {
        console.log(`✅ ENSURING INTERNAL JOB: Using Internal Sector ID ${internalSectorId} for job ${mysolutionId}`);
      } else if (jobData['job-companies'] === internalSectorId) {
        // The sector ID was lost in validation, restore it
        console.log(`⚠️ FIXING INTERNAL JOB: Sector ID was lost during validation, restoring ${internalSectorId} for job ${mysolutionId}`);
        validatedJobData['job-companies'] = internalSectorId;
      }
      
      // Find existing job
      const existingJob = await this.findJobByMysolutionId(mysolutionId);
      
      try {
        if (existingJob) {
          logger.debug(`Updating existing job with Mysolution ID ${mysolutionId}`);
          return this.updateJob(existingJob.id, validatedJobData);
        } else {
          logger.debug(`Creating new job with Mysolution ID ${mysolutionId}`);
          return this.createJob(validatedJobData);
        }
      } catch (error) {
        // Handle specific validation errors
        if (error.message.includes('Validation Error')) {
          // Check if it's specifically a duplicate slug error
          if (error.message.includes('slug') && error.message.includes('already in database')) {
            logger.warn(`Slug already exists for job with Mysolution ID ${mysolutionId}, generating a unique slug`);
            console.log(`Slug collision detected for job with Mysolution ID ${mysolutionId}, generating a unique slug`);
            
            // Generate a new unique slug using the helper method
            const originalSlug = validatedJobData['slug'] || '';
            validatedJobData['slug'] = this._generateUniqueSlug(originalSlug);
            
            logger.debug(`Generated unique slug: ${validatedJobData['slug']}`);
            console.log(`New unique slug: ${validatedJobData['slug']}`);
            
            // Retry the operation with the new slug
            if (existingJob) {
              return this.updateJob(existingJob.id, validatedJobData);
            } else {
              return this.createJob(validatedJobData);
            }
          }
        }
        
        // If it's not a slug error or the retry failed, rethrow
        throw error;
      }
    } catch (error) {
      logger.error(`Error creating or updating job with Mysolution ID ${mysolutionId}:`, error);
      throw error;
    }
  }

  /**
   * Validate dropdown fields to ensure they have valid option values
   * @param {object} jobData - Job data to validate
   * @private
   */
  _validateDropdownFields(jobData) {
    // Define valid options for dropdown fields
    const validOptions = {
      'vacature-salaris': [
        'In overleg',
        '35.000-40.000',
        '40.000-45.000',
        '45.000-50.000',
        '50.000-55.000',
        '55.000-60.000',
        '60.000-65.000',
        '65.000-70.000',
        '70.000-75.000',
        '75.000-80.000',
        '80.000-85.000',
        '85.000-90.000',
        '90.000-95.000',
        '95.000-100.000',
        '100.000-105.000',
        '105.000-110.000',
        '110.000-115.000',
        '115.000-120.000',
        '125.000+'
      ],
      'vacature-type': ['Vast', 'Interim'],
      'uren-per-week': ['16-24 uur', '24-32 uur', '32-36 uur', '36-40 uur'],
      'hourly': [
        'In overleg',
        '55-60',
        '60-65',
        '65-70',
        '70-75',
        '75-80',
        '80-85',
        '85-90',
        '90-95',
        '95-100',
        '100-105',
        '105-110',
        '110-115',
        '115-120',
        '120-125',
        '125+'
      ]
    };
    
    // Validate each dropdown field
    Object.entries(validOptions).forEach(([field, options]) => {
      if (field in jobData && !options.includes(jobData[field])) {
        logger.warn(`Invalid value for ${field}: "${jobData[field]}". Must be one of: ${options.join(', ')}`);
        console.warn(`Invalid value for ${field}: "${jobData[field]}". Setting to default.`);
        
        // Set to first option as default
        jobData[field] = options[0];
      }
    });
    
    return jobData;
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
    console.log('===== ARCHIVING JOB IN WEBFLOW =====');
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
      const rawSectors = await this.getAllItems(sectorsCollectionId);
      
      // Process sectors to extract name from fieldData if needed
      const sectors = rawSectors.map(sector => {
        // Handle case where name is stored in fieldData
        if (!sector.name && sector.fieldData && sector.fieldData.name) {
          return {
            ...sector,
            name: sector.fieldData.name,
            // Preserve the original _id as well
            _id: sector._id || sector.id
          };
        }
        return sector;
      });
      
      // Cache sectors for future use
      this.sectors = sectors;
      this.lastSectorsFetch = now;
      
      logger.info(`Fetched ${sectors.length} sectors from collection ${sectorsCollectionId}`);
      
      // Log all sector names and IDs at debug level
      if (sectors.length > 0) {
        logger.debug('Available sectors:');
        sectors.forEach(sector => {
          const name = sector.name || (sector.fieldData ? sector.fieldData.name : 'unnamed');
          const id = sector._id || sector.id || 'no-id';
          logger.debug(`- ${name} (${id})`);
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
   * Find a sector by name with fuzzy matching
   * Uses multiple matching techniques to find the closest match
   * @param {string} sectorName - The sector name to find
   * @returns {Promise<Object|null>} - The found sector or null
   */
  async findSectorByName(sectorName) {
    try {
      // Safety check
      if (!sectorName) {
        logger.warn('Cannot find sector without a name');
        return null;
      }

      // Log the input sector name for debugging
      logger.debug(`Finding sector by name: "${sectorName}"`);
      
      // Direct aliases for exact naming mismatches
      const exactAliases = {
        'Food & FCMG': 'Food & FMCG'
      };
      
      // Check if we have a direct alias match
      if (sectorName in exactAliases) {
        const aliasedName = exactAliases[sectorName];
        logger.debug(`Using exact alias: "${sectorName}" -> "${aliasedName}"`);
        sectorName = aliasedName;
      }
      
      const allSectors = await this.getAllSectors();
      
      if (!allSectors || allSectors.length === 0) {
        logger.warn('No sectors found in Webflow');
        return null;
      }

      // Helper function to get the name of a sector, checking various properties
      const getSectorName = (sector) => {
        if (!sector) return null;
        
        if (sector.name) return sector.name;
        if (sector.fieldData && sector.fieldData.name) return sector.fieldData.name;
        
        return null;
      };
      
      // Helper function to get the ID of a sector
      const getSectorId = (sector) => {
        if (!sector) return null;
        
        return sector._id || sector.id || null;
      };
      
      // Log available sectors for debugging
      logger.debug('Available sectors:', allSectors.map(s => {
        const name = getSectorName(s);
        const id = getSectorId(s);
        
        if (!name) {
          logger.warn('Invalid sector object:', s);
          return 'INVALID SECTOR';
        }
        
        return `"${name}" (${id})`;
      }));
      
      // Try direct name match first (case insensitive)
      for (const sector of allSectors) {
        const sectorName1 = getSectorName(sector);
        if (!sectorName1) continue;
        
        // Check for exact match (case insensitive)
        if (sectorName1.toLowerCase() === sectorName.toLowerCase()) {
          logger.debug(`Found exact sector match for "${sectorName}": ${sectorName1} (${getSectorId(sector)})`);
          return {
            id: getSectorId(sector),
            name: sectorName1
          };
        }
      }
      
      // If we get here, continue with the existing matching logic
      // Add a special case for common problematic sectors
      const specialCases = {
        'Food & FCMG': ['food', 'fcmg', 'fmcg', 'consumer goods'],
        'Food & FMCG': ['food', 'fcmg', 'fmcg', 'consumer goods'],
        'IT': ['technology', 'tech', 'information technology'],
        'Healthcare': ['health', 'healthcare', 'medical', 'zorg']
      };
      
      // Check if we have a special case mapping for this sector
      if (sectorName in specialCases) {
        logger.debug(`Using special case mapping for "${sectorName}"`);
        // Try to find a sector that matches any of the special case keywords
        for (const sector of allSectors) {
          const sectorName1 = getSectorName(sector);
          if (!sectorName1) continue;
          
          const sectorNameLower = sectorName1.toLowerCase();
          // Check if any of the special case keywords match
          const matches = specialCases[sectorName].some(keyword => 
            sectorNameLower.includes(keyword)
          );
          
          if (matches) {
            logger.debug(`Found special case match for "${sectorName}": ${sectorName1} (${getSectorId(sector)})`);
            return {
              id: getSectorId(sector),
              name: sectorName1
            };
          }
        }
      }
      
      // Normalize the input sector name
      const normalizeName = (name) => {
        if (!name) {
          logger.warn('Attempted to normalize undefined or null name');
          return '';
        }
        try {
          return name.toString()
            .toLowerCase()
            .replace(/[&.,]/g, ' ')       // Replace special chars with spaces
            .replace(/\s+/g, ' ')         // Normalize spaces
            .trim();
        } catch (error) {
          logger.error(`Error normalizing name "${name}":`, error);
          return '';
        }
      };
      
      const normalizedSectorName = normalizeName(sectorName);
      logger.debug(`Normalized sector name: "${normalizedSectorName}"`);
      
      // Step 1: Try exact match (case insensitive)
      const exactMatch = allSectors.find(sector => {
        const sectorName1 = getSectorName(sector);
        if (!sectorName1) {
          logger.warn('Found sector with missing name property:', sector);
          return false;
        }
        return normalizeName(sectorName1) === normalizedSectorName;
      });
      
      if (exactMatch) {
        const exactMatchName = getSectorName(exactMatch);
        logger.debug(`Found exact sector match for "${sectorName}": ${exactMatchName} (${getSectorId(exactMatch)})`);
        return {
          id: getSectorId(exactMatch),
          name: exactMatchName
        };
      }
      
      // Step 2: Try substring match (either contained within)
      const substringMatches = allSectors.filter(sector => {
        const sectorName1 = getSectorName(sector);
        if (!sectorName1) {
          logger.warn('Found sector with missing name property:', sector);
          return false;
        }
        const normalizedSector = normalizeName(sectorName1);
        return normalizedSector.includes(normalizedSectorName) ||
               normalizedSectorName.includes(normalizedSector);
      });
      
      if (substringMatches.length === 1) {
        const match = substringMatches[0];
        const matchName = getSectorName(match);
        logger.debug(`Found substring sector match for "${sectorName}": ${matchName} (${getSectorId(match)})`);
        return {
          id: getSectorId(match),
          name: matchName
        };
      }
      
      // Step 3: Try word-by-word matching 
      const words = normalizedSectorName.split(/\s+/).filter(word => word.length > 2);
      
      if (words.length > 0) {
        // Score each sector by how many words they share
        const scoredSectors = allSectors.map(sector => {
          if (!sector || !sector.name) {
            logger.warn('Found sector with missing name property:', sector);
            return { sector, score: 0 };
          }
          
          const sectorWords = normalizeName(sector.name)
            .split(/\s+/)
            .filter(word => word.length > 2);
            
          // Count matching words
          const matchCount = words.filter(word => 
            sectorWords.some(sectorWord => 
              sectorWord.includes(word) || word.includes(sectorWord)
            )
          ).length;
          
          // Calculate score as percentage of matching words
          const score = matchCount / Math.max(words.length, sectorWords.length);
          
          return {
            sector,
            score
          };
        });
        
        // Find the sector with the highest score, if it's good enough
        const bestMatch = scoredSectors.reduce(
          (best, current) => current.score > best.score ? current : best, 
          { score: 0.3 } // Minimum threshold
        );
        
        if (bestMatch.sector) {
          logger.debug(`Found fuzzy sector match for "${sectorName}": ${bestMatch.sector.name} (${bestMatch.sector._id}) with score ${bestMatch.score.toFixed(2)}`);
          return {
            id: bestMatch.sector._id,  // Use _id for the id property
            name: bestMatch.sector.name
          };
        }
      }
      
      // Step 4: Try matching using common abbreviations or replacements
      const normalizedName = sectorName.toLowerCase()
        .replace(/and/g, '&')
        .replace(/\+/g, 'plus')
        .replace(/[^\w\s&]/g, '') // Remove non-word chars except & and spaces
        .trim();
      
      for (const sector of allSectors) {
        if (!sector || !sector.name) {
          logger.warn('Found sector with missing name property:', sector);
          continue;
        }
        
        const normalizedSectorName = sector.name.toLowerCase()
          .replace(/and/g, '&')
          .replace(/\+/g, 'plus')
          .replace(/[^\w\s&]/g, '')
          .trim();
        
        if (normalizedName === normalizedSectorName) {
          logger.debug(`Found normalized sector match for "${sectorName}": ${sector.name} (${sector._id})`);
          return {
            id: sector._id,  // Use _id for the id property
            name: sector.name
          };
        }
      }
      
      // No match found
      logger.warn(`No matching sector found for "${sectorName}"`);
      return null;
    } catch (error) {
      logger.error(`Error finding sector by name "${sectorName}":`, error);
      throw error;
    }
  }
  
  /**
   * Get the employees collection ID
   * @returns {Promise<string>} Collection ID of the employees collection
   */
  async getEmployeesCollection() {
    try {
      // Use the configured employees collection ID if available
      if (this.employeesCollectionId) {
        logger.info(`Using configured employees collection ID: ${this.employeesCollectionId}`);
        try {
          // Verify that the collection exists
          const collection = await this.getCollection(this.employeesCollectionId);
          logger.info(`Verified employees collection: ${collection.name} (${collection.id})`);
          return this.employeesCollectionId;
        } catch (error) {
          logger.error(`Invalid employees collection ID: ${this.employeesCollectionId}`, { 
            error: error.message,
            stack: error.stack
          });
          // Continue to try finding the collection
        }
      }

      // Get all collections
      logger.debug('Fetching all collections to find employees collection');
      const collectionsResponse = await this.getCollections();
      const collections = collectionsResponse.collections || collectionsResponse;
      logger.debug(`Found ${collections.length} collections`);
      
      // Find the employees collection (likely named "Medewerkers")
      const employeesCollection = collections.find(collection => 
        (collection.name && collection.name.toLowerCase().includes('medewerker')) || 
        (collection.slug && collection.slug.toLowerCase().includes('medewerker')) ||
        (collection.name && collection.name.toLowerCase().includes('employee')) || 
        (collection.slug && collection.slug.toLowerCase().includes('employee'))
      );
      
      if (!employeesCollection) {
        logger.warn('Could not find employees collection. Contactpersoon references will not be set.');
        return null;
      }
      
      // Store for future use
      this.employeesCollectionId = employeesCollection.id;
      logger.info(`Found employees collection: ${employeesCollection.name} (${employeesCollection.id})`);
      
      return employeesCollection.id;
    } catch (error) {
      logger.error('Error finding employees collection:', { 
        error: error.message,
        stack: error.stack
      });
      return null;
    }
  }
  
  /**
   * Get all employees from the employees collection
   * @returns {Promise<Array>} List of employees
   */
  async getAllEmployees() {
    try {
      // Force refresh if employees aren't cached or were cached more than 1 hour ago
      const now = Date.now();
      const needsRefresh = !this.employees || 
                          !this.lastEmployeesFetch || 
                          (now - this.lastEmployeesFetch) > 3600000; // 1 hour
      
      if (!needsRefresh && this.employees) {
        logger.debug(`Using cached employees (${this.employees.length} items)`);
        return this.employees;
      }
      
      // Get employees collection ID
      logger.debug('Getting employees collection ID');
      const employeesCollectionId = await this.getEmployeesCollection();
      
      if (!employeesCollectionId) {
        logger.warn('No employees collection ID found, unable to get employees');
        return [];
      }
      
      // Get all employees
      logger.debug(`Fetching items from employees collection: ${employeesCollectionId}`);
      const rawEmployees = await this.getAllItems(employeesCollectionId);
      
      // Process employees to extract name from fieldData if needed
      const employees = rawEmployees.map(employee => {
        // Handle case where name is stored in fieldData
        if (!employee.name && employee.fieldData && employee.fieldData.name) {
          return {
            ...employee,
            name: employee.fieldData.name,
            // Preserve the original _id as well
            _id: employee._id || employee.id
          };
        }
        return employee;
      });
      
      // Cache employees for future use
      this.employees = employees;
      this.lastEmployeesFetch = now;
      
      logger.info(`Fetched ${employees.length} employees from collection ${employeesCollectionId}`);
      
      // Log all employee names and IDs at debug level
      if (employees.length > 0) {
        logger.debug('Available employees:');
        employees.forEach(employee => {
          const name = employee.name || (employee.fieldData ? employee.fieldData.name : 'unnamed');
          const id = employee._id || employee.id || 'no-id';
          logger.debug(`- ${name} (${id})`);
        });
      } else {
        logger.warn('No employees found in collection');
      }
      
      return employees;
    } catch (error) {
      logger.error('Error fetching employees:', { 
        error: error.message,
        stack: error.stack
      });
      return [];
    }
  }
  
  /**
   * Find an employee by name with fuzzy matching
   * Uses multiple matching techniques to find the closest match
   * @param {string} employeeName - The employee name to find
   * @returns {Promise<Object|null>} - The found employee or null
   */
  async findEmployeeByName(employeeName) {
    try {
      // Safety check
      if (!employeeName) {
        logger.warn('Cannot find employee without a name');
        return null;
      }

      // Log the input employee name for debugging
      logger.debug(`Finding employee by name: "${employeeName}"`);
      
      const allEmployees = await this.getAllEmployees();
      
      if (!allEmployees || allEmployees.length === 0) {
        logger.warn('No employees found in Webflow');
        return null;
      }

      // Helper function to get the name of an employee, checking various properties
      const getEmployeeName = (employee) => {
        if (!employee) return null;
        
        if (employee.name) return employee.name;
        if (employee.fieldData && employee.fieldData.name) return employee.fieldData.name;
        
        return null;
      };
      
      // Helper function to get the ID of an employee
      const getEmployeeId = (employee) => {
        if (!employee) return null;
        
        return employee._id || employee.id || null;
      };
      
      // Log available employees for debugging
      logger.debug('Available employees:', allEmployees.map(e => {
        const name = getEmployeeName(e);
        const id = getEmployeeId(e);
        
        if (!name) {
          logger.warn('Invalid employee object:', e);
          return 'INVALID EMPLOYEE';
        }
        
        return `"${name}" (${id})`;
      }));
      
      // Try direct name match first (case insensitive)
      for (const employee of allEmployees) {
        const employeeName1 = getEmployeeName(employee);
        if (!employeeName1) continue;
        
        // Check for exact match (case insensitive)
        if (employeeName1.toLowerCase() === employeeName.toLowerCase()) {
          logger.debug(`Found exact employee match for "${employeeName}": ${employeeName1} (${getEmployeeId(employee)})`);
          return {
            id: getEmployeeId(employee),
            name: employeeName1
          };
        }
      }
      
      // Normalize the input employee name
      const normalizeName = (name) => {
        if (!name) {
          logger.warn('Attempted to normalize undefined or null name');
          return '';
        }
        try {
          return name.toString()
            .toLowerCase()
            .replace(/[&.,]/g, ' ')       // Replace special chars with spaces
            .replace(/\s+/g, ' ')         // Normalize spaces
            .trim();
        } catch (error) {
          logger.error(`Error normalizing name "${name}":`, error);
          return '';
        }
      };
      
      const normalizedEmployeeName = normalizeName(employeeName);
      logger.debug(`Normalized employee name: "${normalizedEmployeeName}"`);
      
      // Step 1: Try exact match (case insensitive)
      const exactMatch = allEmployees.find(employee => {
        const employeeName1 = getEmployeeName(employee);
        if (!employeeName1) {
          logger.warn('Found employee with missing name property:', employee);
          return false;
        }
        return normalizeName(employeeName1) === normalizedEmployeeName;
      });
      
      if (exactMatch) {
        const exactMatchName = getEmployeeName(exactMatch);
        logger.debug(`Found exact employee match for "${employeeName}": ${exactMatchName} (${getEmployeeId(exactMatch)})`);
        return {
          id: getEmployeeId(exactMatch),
          name: exactMatchName
        };
      }
      
      // Step 2: Try substring match (either contained within)
      const substringMatches = allEmployees.filter(employee => {
        const employeeName1 = getEmployeeName(employee);
        if (!employeeName1) {
          logger.warn('Found employee with missing name property:', employee);
          return false;
        }
        const normalizedEmployee = normalizeName(employeeName1);
        return normalizedEmployee.includes(normalizedEmployeeName) ||
               normalizedEmployeeName.includes(normalizedEmployee);
      });
      
      if (substringMatches.length === 1) {
        const match = substringMatches[0];
        const matchName = getEmployeeName(match);
        logger.debug(`Found substring employee match for "${employeeName}": ${matchName} (${getEmployeeId(match)})`);
        return {
          id: getEmployeeId(match),
          name: matchName
        };
      }
      
      // Step 3: Try word-by-word matching 
      const words = normalizedEmployeeName.split(/\s+/).filter(word => word.length > 1); // Names can have short words
      
      if (words.length > 0) {
        // Score each employee by how many words they share
        const scoredEmployees = allEmployees.map(employee => {
          const employeeName1 = getEmployeeName(employee);
          if (!employeeName1) {
            logger.warn('Found employee with missing name property:', employee);
            return { employee, score: 0 };
          }
          
          const employeeWords = normalizeName(employeeName1)
            .split(/\s+/)
            .filter(word => word.length > 1);
            
          // Count matching words
          const matchCount = words.filter(word => 
            employeeWords.some(employeeWord => 
              employeeWord.includes(word) || word.includes(employeeWord)
            )
          ).length;
          
          // Calculate score as percentage of matching words
          const score = matchCount / Math.max(words.length, employeeWords.length);
          
          return {
            employee,
            score
          };
        });
        
        // Find the employee with the highest score, if it's good enough
        const bestMatch = scoredEmployees.reduce(
          (best, current) => current.score > best.score ? current : best, 
          { score: 0.5 } // Higher threshold for names since they should be more precise
        );
        
        if (bestMatch.employee) {
          const bestMatchName = getEmployeeName(bestMatch.employee);
          const bestMatchId = getEmployeeId(bestMatch.employee);
          logger.debug(`Found fuzzy employee match for "${employeeName}": ${bestMatchName} (${bestMatchId}) with score ${bestMatch.score.toFixed(2)}`);
          return {
            id: bestMatchId,
            name: bestMatchName
          };
        }
      }
      
      // No match found
      logger.warn(`No matching employee found for "${employeeName}"`);
      return null;
    } catch (error) {
      logger.error(`Error finding employee by name "${employeeName}":`, error);
      throw error;
    }
  }

  /**
   * Generate a unique slug by adding a random suffix if needed
   * @param {string} slug - The original slug
   * @returns {string} - A unique slug with random suffix if needed
   * @private
   */
  _generateUniqueSlug(slug) {
    if (!slug) return '';
    
    // Check if the slug already has a random suffix (6 alphanumeric chars after last dash)
    const suffixRegex = /-[a-z0-9]{6}$/;
    const hasRandomSuffix = suffixRegex.test(slug);
    
    // If it already has a random suffix, generate a completely new one
    // to avoid chains of suffixes like slug-abc123-def456
    if (hasRandomSuffix) {
      const baseSlug = slug.replace(suffixRegex, '');
      console.log(`Slug already has a random suffix. Using base slug: ${baseSlug}`);
      slug = baseSlug;
    }
    
    // Clean the slug first
    let cleanSlug = slug
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w-]+/g, '')
      .replace(/--+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');
      
    // Generate a random 6-character alphanumeric suffix
    const generateRandomSuffix = () => {
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      let result = '';
      for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    };
    
    // Add random suffix
    const suffix = generateRandomSuffix();
    const uniqueSlug = `${cleanSlug}-${suffix}`;
    console.log(`Generated unique slug with suffix: ${uniqueSlug}`);
    
    return uniqueSlug;
  }

  /**
   * Clean HTML content to prevent issues with string concatenation when sending to Webflow API
   * @param {string} html - HTML content to clean
   * @returns {string} - Clean HTML content
   * @private
   */
  _cleanHtmlContent(html) {
    if (!html || typeof html !== 'string') return html;
    
    // Check if the content appears to be a concatenated string (contains \n +)
    if (html.includes('\n') && html.includes('\\n')) {
      console.log('Detected potential concatenated HTML string, cleaning...');
      
      try {
        // Remove string concatenation artifacts and normalize line breaks
        let cleaned = html
          // Join concatenated strings by removing + and quotes
          .replace(/"\s*\+\s*"/g, '')
          // Replace escaped newlines with actual newlines
          .replace(/\\n/g, '\n')
          // Normalize actual newlines
          .replace(/\n+/g, '\n')
          // Remove any remaining JavaScript string artifacts
          .replace(/^['"]|['"]$/g, '');
        
        console.log('HTML cleanup successful');
        return cleaned;
      } catch (error) {
        console.error('Error cleaning HTML content:', error);
        // Return the original if cleaning fails
        return html;
      }
    }
    
    return html;
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
      
      // Valid options for dropdown fields
      const validOptions = {
        'vacature-salaris': [
          'In overleg',
          '35.000-40.000',
          '40.000-45.000',
          '45.000-50.000',
          '50.000-55.000',
          '55.000-60.000',
          '60.000-65.000',
          '65.000-70.000',
          '70.000-75.000',
          '75.000-80.000',
          '80.000-85.000',
          '85.000-90.000',
          '90.000-95.000',
          '95.000-100.000',
          '100.000-105.000',
          '105.000-110.000',
          '110.000-115.000',
          '115.000-120.000',
          '125.000+'
        ],
        'vacature-type': ['Vast', 'Interim'],
        'hourly': [
          'In overleg',
          '55-60',
          '60-65',
          '65-70',
          '70-75',
          '75-80',
          '80-85',
          '85-90',
          '90-95',
          '95-100',
          '100-105',
          '105-110',
          '110-115',
          '115-120',
          '120-125',
          '125+'
        ]
      };
      
      // Keep track of fields that are not in the schema
      const invalidFields = [];
      const cleanedData = {};
      
      // Log the raw job data for debugging
      console.log('Raw job data before validation:', JSON.stringify(jobData, null, 2));
      
      // Check for unexpected types on each field
      Object.entries(jobData).forEach(([key, value]) => {
        // Skip null/undefined values
        if (value === null || value === undefined) {
          return;
        }
        
        // Clean HTML content for known HTML fields
        if (key === 'job-description' || key === 'job-requirements' || 
            key === 'job-excerpt-v1' || key === 'job-long-description-page') {
          if (typeof value === 'string') {
            jobData[key] = this._cleanHtmlContent(value);
            console.log(`Cleaned HTML content for ${key}`);
          }
        }
        
        // Check for dropdown fields with predefined options
        if (key in validOptions) {
          if (!validOptions[key].includes(value)) {
            console.warn(`Invalid value "${value}" for field "${key}", must be one of: ${validOptions[key].join(', ')}`);
            
            // For salary, try to find the closest match
            if (key === 'vacature-salaris' && value !== 'In overleg' && !isNaN(parseInt(value, 10))) {
              const numValue = parseInt(value, 10);
              const numericOptions = validOptions[key]
                .filter(opt => opt !== 'In overleg')
                .map(opt => parseInt(opt, 10));
              
              // Find the closest option (not exceeding the value)
              let closestOption = null;
              for (const option of numericOptions) {
                if (option <= numValue && (closestOption === null || option > closestOption)) {
                  closestOption = option;
                }
              }
              
              if (closestOption !== null) {
                const fixedValue = closestOption.toString();
                console.warn(`Fixed invalid salary value "${value}" to "${fixedValue}"`);
                jobData[key] = fixedValue;
              } else {
                // If no proper match found, default to 'In overleg'
                console.warn(`No valid salary option found for "${value}", defaulting to "In overleg"`);
                jobData[key] = 'In overleg';
              }
            } else {
              // For other fields, default to the first valid option
              console.warn(`Setting field "${key}" to default value "${validOptions[key][0]}"`);
              jobData[key] = validOptions[key][0];
            }
          }
        }
        
        // Ensure salary is a string
        if (key === 'vacature-salaris' && typeof value !== 'string') {
          console.warn(`Salary value "${value}" is not a string, converting to string`);
          jobData[key] = String(value);
        }
        
        // Handle slug field - keep the original slug clean but don't add a suffix right away
        // We'll only add a suffix if there's a collision later
        if (key === 'slug' && typeof value === 'string') {
          // Keep the original slug clean but don't add a suffix right away
          // We'll only add a suffix if there's a collision later
          const cleanSlug = value
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^\w-]+/g, '')
            .replace(/--+/g, '-')
            .replace(/^-+/, '')
            .replace(/-+$/, '');
          
          if (cleanSlug !== value) {
            console.log(`Cleaned slug from "${value}" to "${cleanSlug}"`);
            jobData[key] = cleanSlug;
          }
        }
      });
      
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
      
      // Log the cleaned data for debugging
      console.log('Cleaned job data after validation:', JSON.stringify(cleanedData, null, 2));
      
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