import { logger } from '../utils/logger.js';

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

    // Create a transformed candidate object for Mysolution
    const mysolutionCandidate = {
      firstName: webflowCandidate['first-name'] || '',
      lastName: webflowCandidate['last-name'] || '',
      email: webflowCandidate['email'] || '',
      phone: webflowCandidate['phone'] || '',
      address: {
        city: webflowCandidate['city'] || '',
        country: webflowCandidate['country'] || '',
        postalCode: webflowCandidate['postal-code'] || '',
        street: webflowCandidate['street-address'] || ''
      },
      coverLetter: webflowCandidate['cover-letter'] || '',
      currentPosition: webflowCandidate['current-position'] || '',
      currentCompany: webflowCandidate['current-company'] || '',
      linkedInUrl: webflowCandidate['linkedin-url'] || '',
      portfolioUrl: webflowCandidate['portfolio-url'] || '',
      availability: webflowCandidate['availability'] || '',
      desiredSalary: webflowCandidate['desired-salary'] || '',
      source: 'Webflow Website',
      additionalNotes: webflowCandidate['additional-notes'] || '',
      // Add more fields as needed based on Mysolution candidate schema
    };

    // Create application data if job ID is provided
    if (jobId) {
      const applicationData = {
        jobId: jobId,
        candidateId: '', // Will be filled after candidate creation
        status: 'new',
        applicationDate: new Date().toISOString(),
        source: 'Webflow Website'
      };
      
      return {
        candidate: mysolutionCandidate,
        application: applicationData
      };
    }

    return { candidate: mysolutionCandidate };
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