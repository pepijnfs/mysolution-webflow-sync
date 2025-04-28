import express from 'express';
import { logger } from '../utils/logger.js';
import { processNewCandidate } from '../services/candidatesSync.js';
import { jobsSync } from '../services/jobsSync.js';

const router = express.Router();

/**
 * @route   POST /api/webhooks/webflow/form
 * @desc    Handle Webflow form submissions
 * @access  Public
 */
router.post('/webflow/form', async (req, res) => {
  try {
    logger.info('Received Webflow form submission webhook');
    
    // Validate webhook
    const webflowFormName = req.body._form_name;
    const formData = req.body;
    
    if (!webflowFormName) {
      logger.error('Invalid Webflow webhook: Missing form name');
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Invalid Webflow webhook: Missing form name'
      });
    }
    
    logger.info(`Processing form submission for form: ${webflowFormName}`);
    
    // Handle different form types
    if (webflowFormName === 'job-application' || webflowFormName.includes('application')) {
      // Process as job application
      const result = await processNewCandidate(formData);
      
      if (result.success) {
        logger.info('Successfully processed job application form');
        return res.status(200).json({
          success: true,
          message: 'Form processed successfully'
        });
      } else {
        logger.error('Error processing job application form:', result.error);
        return res.status(400).json({
          success: false,
          error: 'Form Processing Error',
          message: result.error
        });
      }
    } else {
      // Handle other form types or return error
      logger.warn(`Unhandled form type: ${webflowFormName}`);
      return res.status(400).json({
        success: false,
        error: 'Unsupported Form',
        message: `Form type '${webflowFormName}' is not supported`
      });
    }
  } catch (error) {
    logger.error('Error processing Webflow webhook:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
});

/**
 * @route   POST /api/webhooks/mysolution/job
 * @desc    Handle Mysolution job update webhooks
 * @access  Private
 */
router.post('/mysolution/job', async (req, res) => {
  try {
    logger.info('Received Mysolution job webhook');
    
    // Validate webhook
    const eventType = req.body.event;
    
    if (!eventType) {
      logger.error('Invalid Mysolution webhook: Missing event type');
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Invalid Mysolution webhook: Missing event type'
      });
    }
    
    logger.info(`Processing Mysolution webhook for event: ${eventType}`);
    
    // Handle job events (created, updated, deleted)
    if (eventType.includes('job')) {
      // For any job-related event, trigger a jobs sync
      // This is a simplified approach; in a production system, 
      // you might want to sync only the affected job for efficiency
      const result = await jobsSync();
      
      logger.info('Jobs sync completed after receiving Mysolution webhook');
      return res.status(200).json({
        success: true,
        message: 'Webhook processed successfully',
        data: result
      });
    } else {
      // Handle other event types or return error
      logger.warn(`Unhandled Mysolution event type: ${eventType}`);
      return res.status(400).json({
        success: false,
        error: 'Unsupported Event',
        message: `Event type '${eventType}' is not supported`
      });
    }
  } catch (error) {
    logger.error('Error processing Mysolution webhook:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
});

export default router; 