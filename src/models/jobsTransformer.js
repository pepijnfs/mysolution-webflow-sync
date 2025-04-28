import { logger } from '../utils/logger.js';
import webflowAPI from '../api/webflow.js';

/**
 * Transform a Mysolution job to Webflow format
 * @param {Object} mysolutionJob - Job data from Mysolution API
 * @returns {Promise<Object>} - Job data formatted for Webflow
 */
export async function transformMysolutionToWebflow(mysolutionJob) {
  try {
    console.log('===== TRANSFORM MYSOLUTION TO WEBFLOW =====');
    console.log('INPUT Mysolution Job Data:', JSON.stringify(mysolutionJob, null, 2));

    // Check for valid job data with consistent ID handling (Mysolution uses capital 'I')
    if (!mysolutionJob) {
      throw new Error('Invalid job data - missing job object');
    }
    
    // Handle case differences in job ID - Mysolution uses job.Id (capital I)
    const jobId = mysolutionJob.Id;
    if (!jobId) {
      throw new Error('Invalid job data - missing ID field');
    }

    // Log the job ID for debugging
    console.log(`Processing job with Mysolution ID: ${jobId}`);

    // List of valid options for key fields (these must match exactly what Webflow accepts)
    const validOptions = {
      // Based on screenshot
      hoursPerWeek: ['16-24 uur', '24-32 uur', '32-36 uur', '36-40 uur'],
      // These should be verified in Webflow
      salaryRanges: [
        'In overleg',
        'Tot €2.000',
        '€2.000 - €3.000',
        '€3.000 - €4.000',
        '€4.000 - €5.000',
        '€5.000 - €6.000',
        '€6.000 - €7.000',
        '€7.000 - €8.000',
        '€8.000 - €10.000',
        '€10.000+'
      ],
      employmentTypes: ['Vast', 'Interim']
    };

    console.log('Using valid options:', JSON.stringify(validOptions, null, 2));

    // Handle salary mapping
    let vacatureSalaris = validOptions.salaryRanges[0]; // Default to 'In overleg'
    if (mysolutionJob.msf__Salary_From__c) {
      // Map numeric salary to appropriate option
      const salaryFrom = parseFloat(mysolutionJob.msf__Salary_From__c);
      const salaryRangeMapping = [
        { max: 2000, value: validOptions.salaryRanges[1] },
        { max: 3000, value: validOptions.salaryRanges[2] },
        { max: 4000, value: validOptions.salaryRanges[3] },
        { max: 5000, value: validOptions.salaryRanges[4] },
        { max: 6000, value: validOptions.salaryRanges[5] },
        { max: 7000, value: validOptions.salaryRanges[6] },
        { max: 8000, value: validOptions.salaryRanges[7] },
        { max: 10000, value: validOptions.salaryRanges[8] },
        { max: Infinity, value: validOptions.salaryRanges[9] }
      ];
      
      for (const range of salaryRangeMapping) {
        if (salaryFrom <= range.max) {
          vacatureSalaris = range.value;
          break;
        }
      }
    }
    
    // Map hours per week to valid Webflow options
    // Default to highest range
    let urenPerWeek = validOptions.hoursPerWeek[3]; // '36-40 uur'
    
    if (mysolutionJob.msf__Hours_Per_Week__c) {
      const hours = parseFloat(mysolutionJob.msf__Hours_Per_Week__c);
      if (hours <= 24) {
        urenPerWeek = validOptions.hoursPerWeek[0]; // '16-24 uur'
      } else if (hours <= 32) {
        urenPerWeek = validOptions.hoursPerWeek[1]; // '24-32 uur'
      } else if (hours <= 36) {
        urenPerWeek = validOptions.hoursPerWeek[2]; // '32-36 uur'
      } else {
        urenPerWeek = validOptions.hoursPerWeek[3]; // '36-40 uur'
      }
    } else if (mysolutionJob.msf__Hours_Per_Week_Range__c) {
      // Map to closest valid option
      const hoursRange = mysolutionJob.msf__Hours_Per_Week_Range__c;
      
      if (hoursRange.includes('16') || hoursRange.includes('8-')) {
        urenPerWeek = validOptions.hoursPerWeek[0]; // '16-24 uur'
      } else if (hoursRange.includes('24')) {
        urenPerWeek = validOptions.hoursPerWeek[1]; // '24-32 uur'
      } else if (hoursRange.includes('32')) {
        urenPerWeek = validOptions.hoursPerWeek[2]; // '32-36 uur'
      } else {
        urenPerWeek = validOptions.hoursPerWeek[3]; // '36-40 uur'
      }
    }

    // Map employment type
    let vacatureType = validOptions.employmentTypes[0]; // Default to 'Vast'
    if (mysolutionJob.msf__Employment_Type__c) {
      const employmentType = mysolutionJob.msf__Employment_Type__c;
      if (employmentType.toLowerCase().includes('interim')) {
        vacatureType = validOptions.employmentTypes[1]; // 'Interim'
      }
    }

    // Handle sector reference - look up the sector by name in the sectors collection
    let sectorRef = null;
    if (mysolutionJob.BS_Sector__c) {
      try {
        logger.debug(`Looking up sector for "${mysolutionJob.BS_Sector__c}"`);
        const sector = await webflowAPI.findSectorByName(mysolutionJob.BS_Sector__c);
        
        if (sector) {
          // Format reference as a simple string ID - this is what Webflow expects for ItemRef fields
          sectorRef = sector.id;
          logger.debug(`Found sector reference for "${mysolutionJob.BS_Sector__c}": ${sector.id}`);
        } else {
          logger.warn(`No sector found for "${mysolutionJob.BS_Sector__c}", job-companies field will not be set`);
        }
      } catch (error) {
        logger.error(`Error finding sector for "${mysolutionJob.BS_Sector__c}":`, error);
      }
    } else {
      logger.debug('No sector specified in Mysolution job');
    }

    // Create a transformed job object for Webflow
    const webflowJob = {
      'name': mysolutionJob.Name || 'Untitled Job',
      'slug': createSlug(mysolutionJob.Name),
      'mysolution-id': jobId,
      'job-excerpt-v1': mysolutionJob.msf__Title__c || '',
      'job-long-description-page': mysolutionJob.msf__Title__c || '',
      'job-requirements': mysolutionJob.msf__Job_Requirements__c || '',
      'job-responsibilities': mysolutionJob.msf__Job_Description__c || '',
      'job-description': mysolutionJob.msf__Job_Description__c || '',
      'vacature-locatie': mysolutionJob.BS_Provincie__c || '',
      'vacature-type': vacatureType,
      'vacature-salaris': vacatureSalaris,
      'job-is-featured': mysolutionJob.msf__Show_On_Website__c || false,
      'uren-per-week': urenPerWeek,
    };
    
    // Only add the reference if we found a matching sector
    if (sectorRef) {
      webflowJob['job-companies'] = sectorRef;
      logger.debug(`Added sector reference to job data: ${sectorRef}`);
    }

    console.log('OUTPUT Webflow Job Data:', JSON.stringify(webflowJob, null, 2));
    console.log('=======================================');

    return webflowJob;
  } catch (error) {
    console.error('ERROR transforming Mysolution job to Webflow format:', error);
    logger.error('Error transforming Mysolution job to Webflow format:', error);
    throw error;
  }
}

/**
 * Transform a Webflow job to Mysolution format
 * @param {Object} webflowJob - Job data from Webflow API
 * @returns {Object} - Job data formatted for Mysolution
 */
export function transformWebflowToMysolution(webflowJob) {
  try {
    // Handle case where job is missing or invalid
    if (!webflowJob || !webflowJob.fields) {
      throw new Error('No valid job data provided');
    }

    const fields = webflowJob.fields;
    
    // Create a transformed job object for Mysolution
    const mysolutionJob = {
      title: fields.name || 'Untitled Job',
      description: fields['job-description'] || '',
      status: reverseMapJobStatus(fields['job-status']) || 'open',
      location: fields['job-location'] || '',
      department: fields['job-department'] || '',
      employmentType: fields['job-employment-type'] || 'Full-time',
      requirements: fields['job-requirements'] || '',
      responsibilities: fields['job-responsibilities'] || '',
      benefits: fields['job-benefits'] || '',
      job_posting_urls: fields['job-application-url'] ? [fields['job-application-url']] : [],
      // Additional fields can be added based on the Mysolution schema
    };

    return mysolutionJob;
  } catch (error) {
    logger.error('Error transforming Webflow job to Mysolution format:', error);
    throw error;
  }
}

/**
 * Helper function to create a URL-friendly slug from a job title
 * @param {string} title - Job title
 * @returns {string} - URL-friendly slug
 */
function createSlug(title) {
  if (!title) return 'job';
  
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with a single one
    .trim()
    .substring(0, 100); // Limit the length of the slug
}

/**
 * Map Mysolution job status to Webflow status
 * @param {string} status - Mysolution job status
 * @returns {string} - Webflow job status
 */
function mapJobStatus(status) {
  const statusMap = {
    'open': 'active',
    'closed': 'inactive',
    'archived': 'draft'
  };
  
  return statusMap[status] || 'draft';
}

/**
 * Map Webflow job status to Mysolution status
 * @param {string} status - Webflow job status
 * @returns {string} - Mysolution job status
 */
function reverseMapJobStatus(status) {
  const statusMap = {
    'active': 'open',
    'inactive': 'closed',
    'draft': 'archived'
  };
  
  return statusMap[status] || 'open';
} 