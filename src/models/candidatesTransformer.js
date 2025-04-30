import { logger } from '../utils/logger.js';
import { Buffer } from 'buffer';

/**
 * Transform a Webflow candidate to Mysolution format
 * @param {Object} webflowCandidate - Candidate data from Webflow form submission
 * @param {string} jobId - Optional job ID to associate the candidate with
 * @returns {Object} - Candidate data formatted for Mysolution
 */
function transformWebflowToMysolution(webflowCandidate, jobId = null) {
  try {
    // Handle case where candidate is missing or invalid
    if (!webflowCandidate) {
      throw new Error('No candidate data provided');
    }
    
    // Map Webflow form fields to Mysolution fields
    // There are multiple possible field names from different form configurations
    const email = webflowCandidate['email'] || webflowCandidate['Email'] || webflowCandidate['e-mail'] || '';
    const firstName = webflowCandidate['first-name'] || webflowCandidate['First-Name'] || webflowCandidate['name'] || webflowCandidate['Name'] || '';
    const lastName = webflowCandidate['last-name'] || webflowCandidate['Last-Name'] || webflowCandidate['achternaam'] || webflowCandidate['surname'] || '';
    const phone = webflowCandidate['phone'] || webflowCandidate['Phone'] || webflowCandidate['telefoonnummer'] || webflowCandidate['telephone'] || '';
    
    // Extract additional fields if available
    const message = webflowCandidate['message'] || webflowCandidate['Message'] || webflowCandidate['cover-letter'] || webflowCandidate['Cover-Letter'] || '';
    const middleName = webflowCandidate['middle-name'] || webflowCandidate['MiddleName'] || webflowCandidate['tussenvoegsel'] || '';
    
    // Log all available fields for debugging
    logger.info('All available form fields:', Object.keys(webflowCandidate));
    logger.info('Mapped fields:', { email, firstName, middleName, lastName, phone, message });
    
    // Format fields according to Mysolution's expected structure
    // Based on our successful test, use the field names from the job application configuration
    const fields = {};
    
    // Add basic required fields - using exact field names from job application configuration
    if (email) fields['Email'] = { value: email };
    if (firstName) fields['First Name'] = { value: firstName };
    if (lastName) fields['Last Name'] = { value: lastName };
    if (middleName) fields['Middle Name'] = { value: middleName };
    if (phone) fields['Mobile'] = { value: phone };
    
    // For the motivation/message, use the "Motivation" field name from the configuration
    if (message) fields['Motivation'] = { value: message };
    
    // Job ID should NOT be in the fields, it should be passed in the URL
    
    // Handle file upload if present
    if (webflowCandidate['cv'] || webflowCandidate['resume']) {
      const fileData = webflowCandidate['cv'] || webflowCandidate['resume'];
      if (fileData && fileData.buffer) {
        // Determine the file extension based on mimetype
        let fileExtension = '';
        switch (fileData.mimetype) {
        case 'application/pdf':
          fileExtension = '.pdf';
          break;
        case 'application/msword':
          fileExtension = '.doc';
          break;
        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
          fileExtension = '.docx';
          break;
        case 'text/plain':
          fileExtension = '.txt';
          break;
        default:
          fileExtension = '';
        }

        // Use original filename if available, otherwise generate one with the correct extension
        const fileName = fileData.originalname || `resume${fileExtension}`;
        const base64Data = Buffer.from(fileData.buffer).toString('base64');
        
        // Use field name from job application configuration
        fields['CV'] = {
          fileName: fileName,
          value: base64Data
        };
      }
    }
    
    // Log the final transformed data structure
    logger.info('Transformed data structure:', {
      fieldCount: Object.keys(fields).length,
      fields: Object.keys(fields)
    });
    
    // Return only the fields object, which is what the Mysolution API expects
    return fields;
  } catch (error) {
    logger.error('Error transforming Webflow candidate to Mysolution format:', error);
    throw error;
  }
}

/**
 * Transform a Mysolution candidate to Webflow format
 * @param {Object} mysolutionCandidate - Candidate data from Mysolution API
 * @returns {Object} - Candidate data formatted for Webflow
 */
function transformMysolutionToWebflow(mysolutionCandidate) {
  try {
    // Handle case where candidate is missing or invalid
    if (!mysolutionCandidate) {
      throw new Error('No candidate data provided');
    }

    // Create a transformed candidate object for Webflow
    const webflowCandidate = {
      'name': `${mysolutionCandidate.firstName || ''} ${mysolutionCandidate.lastName || ''}`.trim() || 'Anonymous Candidate',
      'slug': createSlug(`${mysolutionCandidate.firstName || ''}-${mysolutionCandidate.lastName || ''}`),
      'candidate-id': mysolutionCandidate.id,
      'first-name': mysolutionCandidate.firstName || '',
      'last-name': mysolutionCandidate.lastName || '',
      'email': mysolutionCandidate.email || '',
      'phone': mysolutionCandidate.phone || '',
      'city': mysolutionCandidate.address ? mysolutionCandidate.address.city || '' : '',
      'country': mysolutionCandidate.address ? mysolutionCandidate.address.country || '' : '',
      'postal-code': mysolutionCandidate.address ? mysolutionCandidate.address.postalCode || '' : '',
      'street-address': mysolutionCandidate.address ? mysolutionCandidate.address.street || '' : '',
      'cover-letter': mysolutionCandidate.coverLetter || '',
      'current-position': mysolutionCandidate.currentPosition || '',
      'current-company': mysolutionCandidate.currentCompany || '',
      'linkedin-url': mysolutionCandidate.linkedInUrl || '',
      'portfolio-url': mysolutionCandidate.portfolioUrl || '',
      'availability': mysolutionCandidate.availability || '',
      'desired-salary': mysolutionCandidate.desiredSalary || '',
      'source': mysolutionCandidate.source || 'Mysolution ATS',
      'additional-notes': mysolutionCandidate.additionalNotes || '',
      'submission-date': new Date().toISOString(),
      // Add more fields as needed based on Webflow candidate schema
    };

    return webflowCandidate;
  } catch (error) {
    logger.error('Error transforming Mysolution candidate to Webflow format:', error);
    throw error;
  }
}

/**
 * Helper function to create a URL-friendly slug from a candidate name
 * @param {string} name - Candidate name
 * @returns {string} - URL-friendly slug
 */
function createSlug(name) {
  if (!name) return 'candidate';
  
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with a single one
    .trim()
    .substring(0, 100); // Limit the length of the slug
}

export {
  transformWebflowToMysolution,
  transformMysolutionToWebflow
}; 