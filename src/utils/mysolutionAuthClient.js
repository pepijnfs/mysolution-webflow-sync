import axios from 'axios';
import { logger } from './logger.js';
import config from './config.js';

class MysolutionAuthClient {
  constructor() {
    this.baseURL = config.mysolution.apiUrl;
    this.clientId = config.mysolution.clientId;
    this.clientSecret = config.mysolution.clientSecret;
    this.timeout = config.mysolution.timeout;
    this.retryAttempts = config.mysolution.retryAttempts;
    this.retryDelay = config.mysolution.retryDelay;
    
    // Token state
    this.token = null;
    this.tokenExpires = null;
    this.refreshPromise = null;
    
    // Validate required credentials
    if (!this.clientId || !this.clientSecret) {
      const error = new Error('Mysolution API credentials are not set');
      logger.error('Missing Mysolution API credentials', { error });
      throw error;
    }
  }
  
  /**
   * Check if token is expired or about to expire (with a buffer of 5 minutes)
   * @returns {boolean} True if token is expired or will expire soon
   */
  isTokenExpired() {
    if (!this.tokenExpires) return true;
    // 5 minute buffer to prevent token from expiring during a request
    return Date.now() >= (this.tokenExpires - (5 * 60 * 1000));
  }
  
  /**
   * Get current token or retrieve a new one if needed
   * @returns {Promise<string>} Valid access token
   */
  async getAccessToken() {
    // If we have a valid token, return it
    if (this.token && !this.isTokenExpired()) {
      logger.debug('Using existing Mysolution API token');
      return this.token;
    }
    
    // If a token refresh is already in progress, wait for it to complete
    if (this.refreshPromise) {
      logger.debug('Token refresh already in progress, waiting...');
      return this.refreshPromise;
    }
    
    // Start a new token refresh
    try {
      this.refreshPromise = this._fetchNewToken();
      const token = await this.refreshPromise;
      return token;
    } finally {
      // Clear the refresh promise regardless of outcome
      this.refreshPromise = null;
    }
  }
  
  /**
   * Fetch a new OAuth token with retry logic
   * @returns {Promise<string>} New access token
   * @private
   */
  async _fetchNewToken() {
    let attempts = 0;
    let lastError = null;
    
    // Try to get a token with retries
    while (attempts < this.retryAttempts) {
      try {
        const token = await this._requestNewToken();
        return token;
      } catch (error) {
        lastError = error;
        attempts++;
        
        // Log the retry attempt
        if (attempts < this.retryAttempts) {
          const waitTime = this.retryDelay * attempts;
          logger.warn(`Mysolution API token retrieval failed. Retrying in ${waitTime}ms (attempt ${attempts}/${this.retryAttempts})`, {
            error: error.message,
            attempt: attempts,
            maxAttempts: this.retryAttempts
          });
          
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
    
    // If we've exhausted all retries, throw the last error
    logger.error(`Mysolution API authentication failed after ${this.retryAttempts} attempts`, {
      error: lastError.message
    });
    throw lastError;
  }
  
  /**
   * Makes the actual API request to get a new token
   * @returns {Promise<string>} New access token
   * @private
   */
  async _requestNewToken() {
    try {
      logger.debug('Requesting new Mysolution API token');
      
      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');
      params.append('client_id', this.clientId);
      params.append('client_secret', this.clientSecret);
      
      const response = await axios.post(
        `${this.baseURL}/services/oauth2/token`,
        params.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: this.timeout
        }
      );
      
      // Store the token and calculate expiration
      this.token = response.data.access_token;
      const expiresIn = response.data.expires_in || 3600;
      this.tokenExpires = Date.now() + (expiresIn * 1000);
      
      logger.info('Successfully obtained Mysolution API token', {
        expiresIn,
        expiresAt: new Date(this.tokenExpires).toISOString()
      });
      
      return this.token;
    } catch (error) {
      // Enhanced error logging
      const errorDetails = {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      };
      
      logger.error('Error obtaining Mysolution API token', errorDetails);
      throw error;
    }
  }
  
  /**
   * Clears the current token, forcing a new token to be retrieved on the next request
   */
  invalidateToken() {
    logger.info('Invalidating Mysolution API token');
    this.token = null;
    this.tokenExpires = null;
  }
}

// Create and export a single instance
const mysolutionAuthClient = new MysolutionAuthClient();
export default mysolutionAuthClient; 