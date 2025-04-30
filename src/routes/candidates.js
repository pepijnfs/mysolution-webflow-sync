import express from 'express';
import { logger } from '../utils/logger.js';
import { 
  processNewCandidate,
  updateCandidate,
  processJobApplication
} from '../services/candidatesSync.js';
import mysolutionAPI from '../api/mysolution.js';
import multer from 'multer';

const router = express.Router();

// Setup multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Check if the file is a PDF, DOC, DOCX, or TXT
    if (file.fieldname === 'cv') {
      const allowedMimeTypes = [
        'application/pdf', // PDF
        'application/msword', // DOC
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
        'text/plain' // TXT
      ];
      
      if (allowedMimeTypes.includes(file.mimetype)) {
        // Accept the file
        return cb(null, true);
      } else {
        // Reject the file
        return cb(new Error('Only PDF, DOC, DOCX, and TXT files are allowed for CV uploads.'), false);
      }
    }
    
    // For other file fields, accept all
    cb(null, true);
  }
});

/**
 * @route   POST /api/candidates
 * @desc    Create a new candidate
 * @access  Public
 */
router.post('/', async (req, res) => {
  try {
    const result = await processNewCandidate(req.body);
    
    if (result.success) {
      return res.status(201).json({
        success: true,
        message: 'Candidate created successfully',
        data: result
      });
    } else {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: result.error
      });
    }
  } catch (error) {
    logger.error('Error creating candidate:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/candidates
 * @desc    Get all candidates
 * @access  Private
 */
router.get('/', async (req, res) => {
  try {
    const candidates = await mysolutionAPI.getCandidates();
    return res.json({
      success: true,
      count: candidates.length,
      data: candidates
    });
  } catch (error) {
    logger.error('Error fetching candidates:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/candidates/:id
 * @desc    Get a single candidate by ID
 * @access  Private
 */
router.get('/:id', async (req, res) => {
  try {
    const candidate = await mysolutionAPI.getCandidateById(req.params.id);
    return res.json({
      success: true,
      data: candidate
    });
  } catch (error) {
    logger.error(`Error fetching candidate ${req.params.id}:`, error);
    
    // Handle 404 errors specifically
    if (error.response && error.response.status === 404) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: `Candidate with ID ${req.params.id} not found`
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
});

/**
 * @route   PUT /api/candidates/:id
 * @desc    Update a candidate
 * @access  Private
 */
router.put('/:id', async (req, res) => {
  try {
    const result = await updateCandidate(req.params.id, req.body);
    
    if (result.success) {
      return res.json({
        success: true,
        message: 'Candidate updated successfully',
        data: result
      });
    } else {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: result.error
      });
    }
  } catch (error) {
    logger.error(`Error updating candidate ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
});

/**
 * @route   POST /api/candidates/apply/:jobId
 * @desc    Submit a job application for a specific job
 * @access  Public
 */
router.post('/apply/:jobId', upload.single('cv'), async (req, res) => {
  try {
    const jobId = req.params.jobId;
    logger.info(`Processing application for job ${jobId}`);
    
    // Get form data from request body and add the uploaded file if present
    const formData = req.body;
    
    // Add file to form data if available
    if (req.file) {
      formData.cv = req.file;
    }
    
    // Add job ID to form data
    formData['job-id'] = jobId;
    
    const result = await processJobApplication(jobId, formData);
    
    if (result.success) {
      return res.status(201).json({
        success: true,
        message: 'Application submitted successfully',
        data: result
      });
    } else {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: result.error
      });
    }
  } catch (error) {
    logger.error(`Error processing application for job ${req.params.jobId}:`, error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
});

export default router; 