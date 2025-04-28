import { logger } from './logger.js';
import config from './config.js';

/**
 * Simple authentication middleware for API endpoints
 */
const auth = {
  /**
   * Check if a request has a valid API key
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  validateApiKey: (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey || apiKey !== config.app.adminApiKey) {
      logger.warn('Unauthorized API access attempt', {
        ip: req.ip,
        endpoint: req.originalUrl
      });
      
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid or missing API key'
      });
    }
    
    next();
  }
};

export default auth; 