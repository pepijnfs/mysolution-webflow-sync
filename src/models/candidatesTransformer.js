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
    const fields = {};
    
    // Add basic required fields - using exact field names from job application configuration
    if (email) fields['Email'] = { value: email };
    if (firstName) fields['First Name'] = { value: firstName };
    if (lastName) fields['Last Name'] = { value: lastName };
    if (middleName) fields['Middle Name'] = { value: middleName };
    if (phone) fields['Mobile'] = { value: phone };
    
    // For the motivation/message, use the "Motivation" field name from the configuration
    if (message) fields['Motivation'] = { value: message };
    
    // Enhanced CV file handling
    if (webflowCandidate['cv'] || webflowCandidate['resume']) {
      const fileData = webflowCandidate['cv'] || webflowCandidate['resume'];
      
      // Log detailed file information
      logger.debug('Raw file data received:', {
        hasBuffer: !!fileData?.buffer,
        originalName: fileData?.originalname,
        mimeType: fileData?.mimetype,
        size: fileData?.buffer?.length,
        isBuffer: Buffer.isBuffer(fileData?.buffer)
      });

      if (fileData && fileData.buffer) {
        try {
          // Ensure we have a proper buffer and handle different input types
          let fileBuffer;
          if (Buffer.isBuffer(fileData.buffer)) {
            fileBuffer = fileData.buffer;
          } else if (ArrayBuffer.isView(fileData.buffer)) {
            // Handle TypedArray or DataView
            fileBuffer = Buffer.from(fileData.buffer.buffer);
          } else if (fileData.buffer instanceof ArrayBuffer) {
            fileBuffer = Buffer.from(fileData.buffer);
          } else if (typeof fileData.buffer === 'string') {
            // If it's already a base64 string, decode it first
            if (fileData.buffer.includes('base64,')) {
              fileBuffer = Buffer.from(fileData.buffer.split('base64,')[1], 'base64');
            } else {
              fileBuffer = Buffer.from(fileData.buffer, 'binary');
            }
          } else {
            // Last resort - try to convert whatever we have
            fileBuffer = Buffer.from(fileData.buffer);
          }

          logger.debug('Buffer conversion result:', {
            isBuffer: Buffer.isBuffer(fileBuffer),
            length: fileBuffer.length,
            sample: fileBuffer.slice(0, 16).toString('hex')
          });

          // Determine file extension and validate mime type
          let fileExtension = '';
          const mimeType = fileData.mimetype?.toLowerCase() || '';
          
          switch (mimeType) {
                  case 'application/pdf': {
          fileExtension = '.pdf';
          break;
        }
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
            // Try to extract extension from original filename
            const originalExt = fileData.originalname?.split('.').pop()?.toLowerCase();
            if (originalExt && ['pdf', 'doc', 'docx', 'txt'].includes(originalExt)) {
              fileExtension = '.' + originalExt;
              logger.debug(`Using extension from original filename: ${fileExtension}`);
            } else {
              logger.warn(`Unrecognized mime type: ${mimeType}, defaulting to .pdf`);
              fileExtension = '.pdf';
            }
          }

          // Use original filename if available, otherwise generate one
          const fileName = fileData.originalname || `resume${fileExtension}`;
          
          // Convert to base64 with proper encoding
          // First verify the buffer is valid
          if (fileBuffer.length === 0) {
            throw new Error('Empty file buffer');
          }

          // Check for common file signatures/magic numbers
          const fileSignature = fileBuffer.slice(0, 4).toString('hex');
          logger.debug('File signature:', fileSignature);

          // Convert to base64 without any manipulation
          const base64Data = fileBuffer.toString('base64');
          
          // Verify the base64 string
          try {
            const verificationBuffer = Buffer.from(base64Data, 'base64');
            if (verificationBuffer.length !== fileBuffer.length) {
              logger.warn('Base64 verification failed - length mismatch', {
                original: fileBuffer.length,
                encoded: verificationBuffer.length
              });
            }
          } catch (verifyError) {
            logger.error('Base64 verification failed:', verifyError);
          }
          
          // Log encoding results
          logger.debug('File encoding results:', {
            fileName,
            originalSize: fileBuffer.length,
            base64Length: base64Data.length,
            mimeType,
            fileSignature,
            base64Sample: base64Data.substring(0, 100) + '...' // Log first 100 chars for debugging
          });

          // Add to fields using exact format from Mysolution API example
          fields['CV'] = {
            fileName: fileName,
            value: base64Data
          };

          logger.info('Successfully processed CV file:', {
            fileName,
            size: fileBuffer.length,
            encodedSize: base64Data.length,
            mimeType
          });
        } catch (error) {
          logger.error('Error processing CV file:', {
            error: error.message,
            stack: error.stack,
            fileInfo: {
              originalName: fileData.originalname,
              mimeType: fileData.mimetype
            }
          });
          throw new Error(`Failed to process CV file: ${error.message}`);
        }
      } else {
        logger.warn('CV file data received but no buffer found');
      }
    }
    
    // Log the final transformed data structure
    logger.info('Final transformed data structure:', {
      fieldCount: Object.keys(fields).length,
      fields: Object.keys(fields),
      hasCv: !!fields['CV']
    });
    
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