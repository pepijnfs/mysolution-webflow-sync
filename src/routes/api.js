import express from 'express';
import { logger } from '../utils/logger.js';
import { processNewCandidate, processJobApplication } from '../services/candidatesSync.js';
import multer from 'multer';

const router = express.Router();

// Set up multer for memory storage (for handling file uploads)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  }
});

/**
 * @route   POST /api/candidates/apply
 * @desc    Process a job application from Webflow
 * @access  Public
 */
router.post('/candidates/apply', upload.any(), async (req, res) => {
  try {
    logger.info('Received job application from Webflow form handler');
    
    // Log all received data for debugging
    logger.debug('Form data fields:', Object.keys(req.body));
    logger.debug('Files received:', req.files ? req.files.map(f => ({ fieldname: f.fieldname, originalname: f.originalname })) : 'None');
    
    // Get form data from request body
    const formData = { ...req.body };
    
    // Process any uploaded files
    if (req.files && req.files.length > 0) {
      // Find the file that looks like a CV (could be any field name)
      const cvFile = req.files.find(file => {
        const fieldname = file.fieldname.toLowerCase();
        const originalname = file.originalname.toLowerCase();
        
        // Look for common CV field names or file patterns
        return fieldname.includes('cv') || 
               fieldname.includes('resume') || 
               fieldname.includes('file') || 
               originalname.includes('cv') ||
               originalname.includes('resume') ||
               ['.pdf', '.doc', '.docx'].some(ext => originalname.endsWith(ext));
      });
      
      if (cvFile) {
        logger.info('CV file found in upload:', {
          fieldname: cvFile.fieldname,
          filename: cvFile.originalname,
          size: cvFile.size,
          mimetype: cvFile.mimetype
        });
        
        // Add to formData as 'cv' to ensure consistent processing
        formData.cv = cvFile;
      } else {
        logger.warn('Files were uploaded but none appear to be a CV', {
          uploadedFiles: req.files.map(f => f.fieldname)
        });
      }
    } else {
      logger.warn('No files uploaded with the application');
    }
    
    // Get job ID from form data
    const jobId = formData['job-id'] || formData['jobId'] || formData['mysolution-id'] || 
                  formData['mysolution_id'] || formData['id'] || formData['vacancy_id'] || 
                  formData['vacancy-id'];
    
    if (!jobId) {
      logger.error('No job ID provided in application', { 
        formFields: Object.keys(formData),
        formData: JSON.stringify(formData)
      });
      return res.status(400).json({
        success: false,
        error: 'Job ID is required. Please ensure the vacancy ID is properly set.'
      });
    }
    
    logger.info(`Processing job application for job ID: ${jobId}`);
    
    // Process the application
    const result = await processJobApplication(jobId, formData);
    
    if (result.success) {
      return res.status(200).json({
        success: true,
        message: 'Application submitted successfully'
      });
    } else {
      // Important: Return detailed error message for display on the form
      return res.status(400).json({
        success: false,
        error: result.error || 'Failed to process application'
      });
    }
  } catch (error) {
    logger.error('Error processing job application:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'An unexpected error occurred'
    });
  }
});

/**
 * @route   POST /api/candidates/apply/:jobId
 * @desc    Process a job application with a specific job ID (file upload version)
 * @access  Public
 */
router.post('/candidates/apply/:jobId', upload.any(), async (req, res) => {
  try {
    const jobId = req.params.jobId;
    logger.info(`Received job application from Webflow for job ${jobId}`);
    
    // Get form data from request body
    const formData = { ...req.body };
    
    // Process any uploaded files
    if (req.files && req.files.length > 0) {
      // Find the file that looks like a CV (could be any field name)
      const cvFile = req.files.find(file => {
        const fieldname = file.fieldname.toLowerCase();
        const originalname = file.originalname.toLowerCase();
        
        // Look for common CV field names or file patterns
        return fieldname.includes('cv') || 
               fieldname.includes('resume') || 
               fieldname.includes('file') || 
               originalname.includes('cv') ||
               originalname.includes('resume') ||
               ['.pdf', '.doc', '.docx'].some(ext => originalname.endsWith(ext));
      });
      
      if (cvFile) {
        // Add to formData as 'cv' to ensure consistent processing
        formData.cv = cvFile;
      }
    }
    
    // Add job ID to form data
    formData['job-id'] = jobId;
    
    // Process the application
    const result = await processJobApplication(jobId, formData);
    
    if (result.success) {
      return res.status(200).json({
        success: true,
        message: 'Application submitted successfully'
      });
    } else {
      // Important: Return detailed error message for display on the form
      return res.status(400).json({
        success: false,
        error: result.error || 'Failed to process application'
      });
    }
  } catch (error) {
    logger.error(`Error processing job application for job ${req.params.jobId}:`, error);
    return res.status(500).json({
      success: false,
      error: error.message || 'An unexpected error occurred'
    });
  }
});

export default router; 