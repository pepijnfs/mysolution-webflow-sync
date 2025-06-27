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
      employmentTypes: ['Vast', 'Interim'],
      // These must match exactly what Webflow accepts - updated based on inspection results
      salaryRanges: [
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
      // Hourly rate ranges for freelancers/contractors
      hourlyRates: [
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

    console.log('Using valid options:', JSON.stringify(validOptions, null, 2));

    // Handle salary mapping - map to the closest valid option
    let vacatureSalaris = validOptions.salaryRanges[0]; // Default to 'In overleg'
    if (mysolutionJob.Jaarsalaris__c) {
      try {
        logger.debug(`Processing salary value: "${mysolutionJob.Jaarsalaris__c}"`);
        
        // Skip parsing if already "In overleg" (or case variations)
        if (mysolutionJob.Jaarsalaris__c.toLowerCase().includes('overleg')) {
          logger.debug('Salary value is already "In overleg", keeping default');
          vacatureSalaris = 'In overleg';
        }
        // Check for common patterns with formatted ranges
        else if (mysolutionJob.Jaarsalaris__c.includes('35.000') && mysolutionJob.Jaarsalaris__c.includes('40.000')) {
          vacatureSalaris = '35.000-40.000';
          logger.debug(`Mapped exact range "${mysolutionJob.Jaarsalaris__c}" to predefined range: ${vacatureSalaris}`);
        }
        else if (mysolutionJob.Jaarsalaris__c.includes('40.000') && mysolutionJob.Jaarsalaris__c.includes('45.000')) {
          vacatureSalaris = '40.000-45.000';
          logger.debug(`Mapped exact range "${mysolutionJob.Jaarsalaris__c}" to predefined range: ${vacatureSalaris}`);
        }
        // Extract numbers for custom mapping
        else {
          // Try to extract salary range numbers (e.g. "40.000 – 45.000")
          const rangeMatch = mysolutionJob.Jaarsalaris__c.match(/(\d+)(?:\.(\d+))?(?:[ \-–]+)(\d+)(?:\.(\d+))?/);
          
          if (rangeMatch) {
            // We have a range like "40.000 - 45.000"
            const lowerBound = parseInt(rangeMatch[1] + (rangeMatch[2] || ''), 10);
            const upperBound = parseInt(rangeMatch[3] + (rangeMatch[4] || ''), 10);
            
            logger.debug(`Extracted salary range from "${mysolutionJob.Jaarsalaris__c}": ${lowerBound} to ${upperBound}`);
            
            // Find the appropriate predefined range that contains this range
            let bestMatch = null;
            let bestMatchLower = 0;
            
            for (const option of validOptions.salaryRanges) {
              if (option === 'In overleg' || option === '125.000+') continue;
              
              const rangeParts = option.split('-');
              if (rangeParts.length !== 2) continue;
              
              const rangeLower = parseInt(rangeParts[0].replace(/\./g, ''), 10);
              const rangeUpper = parseInt(rangeParts[1].replace(/\./g, ''), 10);
              
              // Find the range that best contains our target range
              if (rangeLower <= lowerBound && rangeUpper >= upperBound) {
                if (bestMatch === null || rangeLower > bestMatchLower) {
                  bestMatch = option;
                  bestMatchLower = rangeLower;
                }
              }
            }
            
            // If no direct match, find the range with closest starting point
            if (bestMatch === null) {
              let closestLower = null;
              let closestDistance = Number.MAX_SAFE_INTEGER;
              
              for (const option of validOptions.salaryRanges) {
                if (option === 'In overleg' || option === '125.000+') continue;
                
                const rangeParts = option.split('-');
                if (rangeParts.length !== 2) continue;
                
                const rangeLower = parseInt(rangeParts[0].replace(/\./g, ''), 10);
                const distance = Math.abs(rangeLower - lowerBound);
                
                if (distance < closestDistance) {
                  closestDistance = distance;
                  closestLower = option;
                }
              }
              
              if (closestLower !== null) {
                bestMatch = closestLower;
              }
            }
            
            if (bestMatch !== null) {
              vacatureSalaris = bestMatch;
              logger.debug(`Mapped salary range to closest Webflow option: ${vacatureSalaris}`);
            } else {
              logger.warn('Could not find an appropriate salary range option, using default');
            }
          } else {
            // Single number (e.g. "40.000")
            const singleMatch = mysolutionJob.Jaarsalaris__c.match(/(\d+)(?:\.(\d+))?/);
            if (singleMatch) {
              const salaryNum = parseInt(singleMatch[1] + (singleMatch[2] || ''), 10);
              logger.debug(`Extracted single salary value ${salaryNum} from "${mysolutionJob.Jaarsalaris__c}"`);
              
              // For a single value, find the range where this salary fits
              let bestMatch = null;
              
              for (const option of validOptions.salaryRanges) {
                if (option === 'In overleg') continue;
                
                if (option === '125.000+') {
                  if (salaryNum >= 125000) {
                    bestMatch = option;
                    break;
                  }
                  continue;
                }
                
                const rangeParts = option.split('-');
                if (rangeParts.length !== 2) continue;
                
                const rangeLower = parseInt(rangeParts[0].replace(/\./g, ''), 10);
                const rangeUpper = parseInt(rangeParts[1].replace(/\./g, ''), 10);
                
                if (salaryNum >= rangeLower && salaryNum <= rangeUpper) {
                  bestMatch = option;
                  break;
                }
              }
              
              // If no direct fit found, use the closest range
              if (bestMatch === null) {
                let closestOption = null;
                let closestDistance = Number.MAX_SAFE_INTEGER;
                
                for (const option of validOptions.salaryRanges) {
                  if (option === 'In overleg') continue;
                  
                  if (option === '125.000+') {
                    const distance = Math.abs(125000 - salaryNum);
                    if (distance < closestDistance) {
                      closestDistance = distance;
                      closestOption = option;
                    }
                    continue;
                  }
                  
                  const rangeParts = option.split('-');
                  if (rangeParts.length !== 2) continue;
                  
                  const rangeLower = parseInt(rangeParts[0].replace(/\./g, ''), 10);
                  const rangeMiddle = (parseInt(rangeParts[0].replace(/\./g, ''), 10) + 
                                     parseInt(rangeParts[1].replace(/\./g, ''), 10)) / 2;
                  
                  // Calculate distance to the middle of the range
                  const distance = Math.abs(rangeMiddle - salaryNum);
                  if (distance < closestDistance) {
                    closestDistance = distance;
                    closestOption = option;
                  }
                }
                
                if (closestOption !== null) {
                  bestMatch = closestOption;
                }
              }
              
              if (bestMatch !== null) {
                vacatureSalaris = bestMatch;
                logger.debug(`Mapped single salary ${salaryNum} to Webflow range: ${vacatureSalaris}`);
              } else {
                logger.warn(`Could not find an appropriate salary option for ${salaryNum}, using default`);
              }
            } else {
              // Only log warning if not "In overleg" or similar
              if (!mysolutionJob.Jaarsalaris__c.toLowerCase().includes('overleg')) {
                logger.warn(`Could not parse salary value from "${mysolutionJob.Jaarsalaris__c}", using default`);
              } else {
                logger.debug(`Salary value "${mysolutionJob.Jaarsalaris__c}" indicates negotiable, using "In overleg"`);
              }
            }
          }
        }
        
        // Final validation check - ensure the mapped value is in the allowed options
        if (!validOptions.salaryRanges.includes(vacatureSalaris)) {
          logger.warn(`Mapped salary value "${vacatureSalaris}" is not in the allowed options list. Using default.`);
          vacatureSalaris = 'In overleg';
        } else {
          logger.debug(`Final salary value "${vacatureSalaris}" is valid in the options list.`);
        }
      } catch (error) {
        logger.error(`Error parsing salary value: ${error.message}`);
        // Fallback to default
        vacatureSalaris = 'In overleg';
      }
    }
    
    // Handle hourly rate mapping - similar to salary but for hourly rates
    let hourlyRate = validOptions.hourlyRates[0]; // Default to 'In overleg'
    if (mysolutionJob.Uurtarief__c) {
      try {
        logger.debug(`Processing hourly rate value: "${mysolutionJob.Uurtarief__c}"`);
        
        // Skip parsing if already "In overleg" (or case variations)
        if (mysolutionJob.Uurtarief__c.toLowerCase().includes('overleg')) {
          logger.debug('Hourly rate value is already "In overleg", keeping default');
          hourlyRate = 'In overleg';
        }
        else {
          // Try to extract hourly rate range numbers (e.g. "60 – 65")
          const rangeMatch = mysolutionJob.Uurtarief__c.match(/(\d+)(?:\.(\d+))?(?:[ \-–]+)(\d+)(?:\.(\d+))?/);
          
          if (rangeMatch) {
            // We have a range like "60 - 65"
            const lowerBound = parseInt(rangeMatch[1] + (rangeMatch[2] || ''), 10);
            const upperBound = parseInt(rangeMatch[3] + (rangeMatch[4] || ''), 10);
            
            logger.debug(`Extracted hourly rate range from "${mysolutionJob.Uurtarief__c}": ${lowerBound} to ${upperBound}`);
            
            // Find the appropriate predefined range that contains this range
            let bestMatch = null;
            
            for (const option of validOptions.hourlyRates) {
              if (option === 'In overleg' || option === '125+') continue;
              
              const rangeParts = option.split('-');
              if (rangeParts.length !== 2) continue;
              
              const rangeLower = parseInt(rangeParts[0], 10);
              const rangeUpper = parseInt(rangeParts[1], 10);
              
              // Find the range that best contains our target range
              if (rangeLower <= lowerBound && rangeUpper >= upperBound) {
                bestMatch = option;
                break;
              }
            }
            
            // If no direct match, find the closest range
            if (bestMatch === null) {
              let closestOption = null;
              let closestDistance = Number.MAX_SAFE_INTEGER;
              
              for (const option of validOptions.hourlyRates) {
                if (option === 'In overleg' || option === '125+') continue;
                
                const rangeParts = option.split('-');
                if (rangeParts.length !== 2) continue;
                
                const rangeLower = parseInt(rangeParts[0], 10);
                const rangeUpper = parseInt(rangeParts[1], 10);
                const rangeMiddle = (rangeLower + rangeUpper) / 2;
                
                // Use the middle of both ranges to compare
                const inputMiddle = (lowerBound + upperBound) / 2;
                const distance = Math.abs(rangeMiddle - inputMiddle);
                
                if (distance < closestDistance) {
                  closestDistance = distance;
                  closestOption = option;
                }
              }
              
              if (closestOption !== null) {
                bestMatch = closestOption;
              }
            }
            
            if (bestMatch !== null) {
              hourlyRate = bestMatch;
              logger.debug(`Mapped hourly rate range to closest Webflow option: ${hourlyRate}`);
            } else {
              logger.warn('Could not find an appropriate hourly rate range option, using default');
            }
          } else {
            // Single number (e.g. "65")
            const singleMatch = mysolutionJob.Uurtarief__c.match(/(\d+)(?:\.(\d+))?/);
            if (singleMatch) {
              const rateNum = parseInt(singleMatch[1] + (singleMatch[2] || ''), 10);
              logger.debug(`Extracted single hourly rate value ${rateNum} from "${mysolutionJob.Uurtarief__c}"`);
              
              // For a single value, find the range where this rate fits
              let bestMatch = null;
              
              for (const option of validOptions.hourlyRates) {
                if (option === 'In overleg') continue;
                
                if (option === '125+') {
                  if (rateNum >= 125) {
                    bestMatch = option;
                    break;
                  }
                  continue;
                }
                
                const rangeParts = option.split('-');
                if (rangeParts.length !== 2) continue;
                
                const rangeLower = parseInt(rangeParts[0], 10);
                const rangeUpper = parseInt(rangeParts[1], 10);
                
                if (rateNum >= rangeLower && rateNum <= rangeUpper) {
                  bestMatch = option;
                  break;
                }
              }
              
              // If no direct fit found, use the closest range
              if (bestMatch === null) {
                let closestOption = null;
                let closestDistance = Number.MAX_SAFE_INTEGER;
                
                for (const option of validOptions.hourlyRates) {
                  if (option === 'In overleg') continue;
                  
                  if (option === '125+') {
                    const distance = Math.abs(125 - rateNum);
                    if (distance < closestDistance) {
                      closestDistance = distance;
                      closestOption = option;
                    }
                    continue;
                  }
                  
                  const rangeParts = option.split('-');
                  if (rangeParts.length !== 2) continue;
                  
                  const rangeLower = parseInt(rangeParts[0], 10);
                  const rangeUpper = parseInt(rangeParts[1], 10);
                  const rangeMiddle = (rangeLower + rangeUpper) / 2;
                  
                  // Calculate distance to the middle of the range
                  const distance = Math.abs(rangeMiddle - rateNum);
                  if (distance < closestDistance) {
                    closestDistance = distance;
                    closestOption = option;
                  }
                }
                
                if (closestOption !== null) {
                  bestMatch = closestOption;
                }
              }
              
              if (bestMatch !== null) {
                hourlyRate = bestMatch;
                logger.debug(`Mapped single hourly rate ${rateNum} to Webflow range: ${hourlyRate}`);
              } else {
                logger.warn(`Could not find an appropriate hourly rate option for ${rateNum}, using default`);
              }
            } else {
              // Only log warning if not "In overleg" or similar
              if (!mysolutionJob.Uurtarief__c.toLowerCase().includes('overleg')) {
                logger.warn(`Could not parse hourly rate value from "${mysolutionJob.Uurtarief__c}", using default`);
              } else {
                logger.debug(`Hourly rate value "${mysolutionJob.Uurtarief__c}" indicates negotiable, using "In overleg"`);
              }
            }
          }
        }
        
        // Final validation check - ensure the mapped value is in the allowed options
        if (!validOptions.hourlyRates.includes(hourlyRate)) {
          logger.warn(`Mapped hourly rate value "${hourlyRate}" is not in the allowed options list. Using default.`);
          hourlyRate = 'In overleg';
        } else {
          logger.debug(`Final hourly rate value "${hourlyRate}" is valid in the options list.`);
        }
      } catch (error) {
        logger.error(`Error parsing hourly rate value: ${error.message}`);
        // Fallback to default
        hourlyRate = 'In overleg';
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
    if (mysolutionJob.BS_Soort_dienstverband__c) {
      const employmentType = mysolutionJob.BS_Soort_dienstverband__c;
      if (employmentType.toLowerCase().includes('interim')) {
        vacatureType = validOptions.employmentTypes[1]; // 'Interim'
      }
    }

    // Handle sector reference - look up the sector by name in the sectors collection
    let sectorRef = null;
    
    // Check if the job is marked as internal
    const isInternalJob = mysolutionJob.msf__Show_On_Internal__c === true;
    
    if (isInternalJob) {
      // For internal jobs, always use the "Interne Vacature" sector
      // This takes precedence over any sector that might be set in BS_Sector__c
      const interneVacatureId = '65f935a2e6b9d7f69afed2bb';
      sectorRef = interneVacatureId;
      
      // Log a warning if a sector was also specified to help administrators identify potential issues
      if (mysolutionJob.BS_Sector__c) {
        logger.warn(`Internal job (${jobId}) has both internal flag AND sector "${mysolutionJob.BS_Sector__c}" set. ` +
                   'Ignoring specified sector and using "Interne Vacature" instead.');
      }
      
      logger.debug(`Job is marked as internal, setting sector to "Interne Vacature" (${interneVacatureId})`);
    } else if (mysolutionJob.BS_Sector__c) {
      try {
        logger.debug(`Looking up sector for "${mysolutionJob.BS_Sector__c}"`);
        const sector = await webflowAPI.findSectorByName(mysolutionJob.BS_Sector__c);
        
        if (sector && sector.id) {
          // Format reference as a simple string ID - this is what Webflow expects for ItemRef fields
          sectorRef = sector.id;
          logger.debug(`Found sector reference for "${mysolutionJob.BS_Sector__c}": ${sector.id} (${sector.name})`);
        } else {
          logger.warn(`No sector found for "${mysolutionJob.BS_Sector__c}", job-companies field will not be set`);
        }
      } catch (error) {
        logger.error(`Error finding sector for "${mysolutionJob.BS_Sector__c}":`, error);
      }
    } else {
      logger.debug('No sector specified in Mysolution job');
    }

    // Handle employee/contactpersoon reference - look up the employee by name in the employees collection
    let employeeRef = null;
    
    // Check if there's an Owner with a Name
    if (mysolutionJob.Owner && mysolutionJob.Owner.Name) {
      try {
        logger.debug(`Looking up employee for "${mysolutionJob.Owner.Name}"`);
        const employee = await webflowAPI.findEmployeeByName(mysolutionJob.Owner.Name);
        
        if (employee && employee.id) {
          // Format reference as a simple string ID - this is what Webflow expects for ItemRef fields
          employeeRef = employee.id;
          logger.debug(`Found employee reference for "${mysolutionJob.Owner.Name}": ${employee.id} (${employee.name})`);
        } else {
          logger.warn(`No employee found for "${mysolutionJob.Owner.Name}", contactpersoon field will not be set`);
        }
      } catch (error) {
        logger.error(`Error finding employee for "${mysolutionJob.Owner.Name}":`, error);
      }
    } else {
      logger.debug('No owner specified in Mysolution job');
    }

    // Clean job name from unnecessary quotes
    const cleanName = mysolutionJob.Name ? cleanJobTitle(mysolutionJob.Name) : 'Untitled Job';
    
    // Determine employment type from BS_Soort_dienstverband__c
    const isInterim = mysolutionJob.BS_Soort_dienstverband__c === 'Interim';
    logger.debug(`Job employment type: ${mysolutionJob.BS_Soort_dienstverband__c}, isInterim: ${isInterim}`);
    
    // Create a transformed job object for Webflow
    const webflowJob = {
      'name': cleanName,
      'slug': createSlug(cleanName),
      'mysolution-id': jobId,
      'job-excerpt-v1': cleanExcerpt(mysolutionJob.msf__Title__c || ''),
      'job-long-description-page': cleanExcerpt(mysolutionJob.msf__Title__c || ''),
      'job-requirements': formatRequirementsForWebflow(mysolutionJob.msf__Job_Description__c || ''),
      'job-responsibilities': formatHtmlContent(mysolutionJob.msf__Application_Procedure__c || ''),
      'job-description': formatHtmlContent(mysolutionJob.msf__Job_Requirements__c || ''),
      'vacature-wat-wij-bieden': formatHtmlContent(mysolutionJob.msf__Employment_Conditions__c || ''),
      'vacature-locatie': mysolutionJob.BS_Provincie__c || '',
      'vacature-type': vacatureType,
      'job-is-featured': mysolutionJob.msf__Show_On_Website__c || false,
      'uren-per-week': urenPerWeek,
    };
    
    // Add information about internal job status
    if (isInternalJob) {
      logger.debug(`Job is marked as internal: ${isInternalJob}`);
      // If you have a specific field in Webflow for marking internal jobs, you could set it here
    }
    
    // Apply conditional logic for salary vs hourly rate
    if (isInterim) {
      // For Interim jobs, use hourly rate in 'hourly' field
      webflowJob['hourly'] = hourlyRate;
      // Explicitly clear salary field to ensure it doesn't persist from prior state
      webflowJob['vacature-salaris'] = null; // Set to null to ensure it's removed in Webflow
      logger.debug(`Interim job: Setting hourly rate to ${hourlyRate}, clearing any existing salary`);
    } else {
      // For Vast jobs, use yearly salary in 'vacature-salaris' field
      webflowJob['vacature-salaris'] = vacatureSalaris;
      // Explicitly clear hourly rate field to ensure it doesn't persist from prior state
      webflowJob['hourly'] = null; // Set to null to ensure it's removed in Webflow
      logger.debug(`Permanent job: Setting salary to ${vacatureSalaris}, clearing any existing hourly rate`);
    }
    
    // Additional validation for dropdown fields
    // If these fields are not valid options, they will cause validation errors
    // Check salary range if set
    if (webflowJob['vacature-salaris'] && !validOptions.salaryRanges.includes(webflowJob['vacature-salaris'])) {
      logger.warn(`Invalid salary option: ${webflowJob['vacature-salaris']}. Using default.`);
      webflowJob['vacature-salaris'] = 'In overleg';
    }
    
    // Check employment type
    if (!validOptions.employmentTypes.includes(webflowJob['vacature-type'])) {
      logger.warn(`Invalid employment type: ${webflowJob['vacature-type']}. Using default.`);
      webflowJob['vacature-type'] = 'Vast';
    }
    
    // Check hours per week
    if (!validOptions.hoursPerWeek.includes(webflowJob['uren-per-week'])) {
      logger.warn(`Invalid hours option: ${webflowJob['uren-per-week']}. Using default.`);
      webflowJob['uren-per-week'] = '36-40 uur';
    }
    
    // Check hourly rate if set
    if (webflowJob['hourly'] && !validOptions.hourlyRates.includes(webflowJob['hourly'])) {
      logger.warn(`Invalid hourly rate option: ${webflowJob['hourly']}. Using default.`);
      webflowJob['hourly'] = 'In overleg';
    }
    
    // Log final validated values
    logger.debug(`Final validated field values:
    - Salary: ${webflowJob['vacature-salaris'] || 'Not set (Interim job)'}
    - Type: ${webflowJob['vacature-type']}
    - Hours: ${webflowJob['uren-per-week']}
    - Hourly Rate: ${webflowJob['hourly'] || 'Not set (Permanent job)'}`);
    
    // Only add the reference if we found a matching sector
    if (sectorRef) {
      webflowJob['job-companies'] = sectorRef;
      if (isInternalJob) {
        logger.debug(`Set sector reference to "Interne Vacature" (${sectorRef}) for internal job`);
      } else {
        logger.debug(`Added sector reference to job data: ${sectorRef}`);
      }
    }
    
    // Only add the employee reference if we found a matching employee
    if (employeeRef) {
      webflowJob['contactpersoon'] = employeeRef;
      logger.debug(`Added employee reference to job data: ${employeeRef}`);
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
      description: fields['job-requirements'] || '',
      status: reverseMapJobStatus(fields['job-status']) || 'open',
      location: fields['job-location'] || '',
      department: fields['job-department'] || '',
      employmentType: fields['job-employment-type'] || 'Full-time',
      requirements: fields['job-description'] || '',
      benefits: fields['vacature-wat-wij-bieden'] || '',
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

/**
 * Format HTML content to ensure proper display in Webflow
 * @param {string} htmlContent - HTML content from Mysolution
 * @returns {string} - Properly formatted HTML for Webflow
 */
function formatHtmlContent(htmlContent) {
  if (!htmlContent) return '';
  
  // Log the raw HTML content for debugging
  logger.debug('Raw HTML content:', htmlContent.substring(0, 200) + (htmlContent.length > 200 ? '...' : ''));
  
  // Remove markdown-style code blocks that might be included by Mysolution
  htmlContent = htmlContent.replace(/^```(?:html|css|js)?\s*/i, '');
  htmlContent = htmlContent.replace(/\s*```$/i, '');
  
  // Check and fix concatenated strings - a common issue when content includes JavaScript-style string concatenation
  if (htmlContent.includes('\n') && (htmlContent.includes('\\n') || htmlContent.includes('" +'))) {
    logger.debug('Detected concatenated string in HTML content, fixing...');
    htmlContent = htmlContent
      // Join concatenated strings by removing + and quotes
      .replace(/"\s*\+\s*"/g, '')
      // Replace escaped newlines with actual newlines
      .replace(/\\n/g, '\n')
      // Remove any remaining JavaScript string artifacts
      .replace(/^['"]|['"]$/g, '');
  }
  
  // Pre-process to fix common list item issues BEFORE main processing
  htmlContent = htmlContent
    // Fix double closing paragraph tags in list items (critical issue)
    .replace(/<\/p><\/p><\/li>/gi, '</p></li>')
    .replace(/<li><p>(.*?)<\/p><\/p><\/li>/gi, '<li><p>$1</p></li>');
  
  // First, clean up line breaks and ensure consistent formatting
  let formattedContent = htmlContent
    // Normalize line breaks - convert all to standard \n first
    .replace(/\r\n|\r/g, '\n')
    // IMPORTANT: Replace all raw newlines with HTML breaks to prevent Webflow truncation
    .replace(/\n/g, '<br>')
    // Remove any excessive breaks
    .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '<br>');
  
  // Split the content by HTML breaks or paragraph boundaries
  const paragraphs = formattedContent
    .split(/<br\s*\/?>\s*<br\s*\/?>|<\/p>\s*<p>|<\/p>\s*<br\s*\/?>\s*<p>|<\/div>\s*<div>/)
    .filter(para => para.trim().length > 0);
  
  // Rebuild HTML with proper paragraph structures but without excess spacing
  formattedContent = paragraphs.map(paragraph => {
    // Skip if already in a paragraph or other block element
    if (paragraph.trim().startsWith('<p') || 
        paragraph.trim().startsWith('<h') || 
        paragraph.trim().startsWith('<ul') || 
        paragraph.trim().startsWith('<ol') ||
        paragraph.trim().startsWith('<div')) {
      return paragraph.trim();
    }
    
    // Remove any trailing/leading <br> tags
    let clean = paragraph.trim().replace(/^<br\s*\/?>|<br\s*\/?>$/gi, '');
    
    // Only wrap with paragraph tags if not empty
    if (clean.length > 0) {
      return `<p>${clean}</p>`;
    }
    return '';
  }).join('');
  
  // Handle lists - preserve original formatting from Mysolution
  // NOTE: Mysolution provides clean list items without paragraph tags
  // Adding extra <p> tags causes spacing issues in Webflow
  formattedContent = formattedContent
    // Only fix lists that already have paragraph tags to prevent double wrapping
    .replace(/<li>\s*<p>/gi, '<li><p>')
    .replace(/<\/p>\s*<\/li>/gi, '</p></li>')
    // Fix any unclosed paragraph tags inside list items that already have them
    .replace(/<li><p>(.*?)(?:<\/li>|<li>)/gi, '<li><p>$1</p></li>');
  // DO NOT add paragraph tags to clean list items - preserve Mysolution formatting
  // .replace(/<li>([^<]+)<\/li>/gi, '<li><p>$1</p></li>') // REMOVED - causes spacing issues
  
  // Secondary fix for double closing paragraphs - catch any that might have been 
  // introduced during formatting
  formattedContent = formattedContent
    .replace(/<\/p><\/p><\/li>/gi, '</p></li>')
    .replace(/<li><p>(.*?)<\/p><\/p><\/li>/gi, '<li><p>$1</p></li>');
  
  // Fix any unclosed tags or malformed HTML
  if (formattedContent.includes('<p') && !formattedContent.includes('</p>')) {
    formattedContent += '</p>';
  }
  
  // Ensure proper HTML structure by wrapping the entire content if needed
  if (!formattedContent.trim().startsWith('<')) {
    formattedContent = `<p>${formattedContent}</p>`;
  }
  
  // CRITICAL FIX: Only add div wrapper when content has multiple block elements
  // Single lists don't need div wrapper - it causes excessive spacing in Webflow
  const hasMultipleBlocks = (formattedContent.match(/<(p|ul|ol|div|h[1-6])[^>]*>/gi) || []).length > 1;
  if (hasMultipleBlocks) {
    formattedContent = `<div>${formattedContent}</div>`;
  }
  
  // CRITICAL: Remove any raw newlines in the final output to prevent Webflow truncation
  formattedContent = formattedContent.replace(/\n/g, '');
  
  // One final check for double closing paragraph tags
  formattedContent = formattedContent
    .replace(/<\/p><\/p><\/li>/gi, '</p></li>')
    .replace(/<li><p>(.*?)<\/p><\/p><\/li>/gi, '<li><p>$1</p></li>');
  
  // CRITICAL FIX: Decode HTML entities that Webflow may have encoded
  // This ensures "&amp;" displays as "&" on the frontend
  formattedContent = formattedContent
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'');
  
  // Log the formatted HTML for debugging
  logger.debug('Formatted HTML content:', formattedContent.substring(0, 200) + (formattedContent.length > 200 ? '...' : ''));
  
  return formattedContent;
}

/**
 * Special formatter specifically for job requirements field in Webflow
 * @param {string} content - The job requirements content from Mysolution
 * @returns {string} - Formatted content optimized for Webflow's RichText field
 */
function formatRequirementsForWebflow(content) {
  if (!content) return '';

  // Log original content
  logger.debug('Original job requirements content:', content);
  
  // Remove markdown-style code blocks that might be included by Mysolution
  content = content.replace(/^```(?:html|css|js)?\s*/i, '');
  content = content.replace(/\s*```$/i, '');
  
  // Pre-process to fix common list item issues BEFORE main processing
  content = content
    // Fix double closing paragraph tags in list items (critical issue)
    .replace(/<\/p><\/p><\/li>/gi, '</p></li>')
    .replace(/<li><p>(.*?)<\/p><\/p><\/li>/gi, '<li><p>$1</p></li>');
  
  // Remove trailing space after </ul> tag that can appear in some edge cases
  content = content.replace(/<\/ul>\s+<br><\/p>/gi, '</ul></p>');
  content = content.replace(/<\/ul>\s+<\/p>/gi, '</ul></p>');
  
  // Check and fix concatenated strings - a common issue when content includes JavaScript-style string concatenation
  if (content.includes('\n') && (content.includes('\\n') || content.includes('" +'))) {
    logger.debug('Detected concatenated string in job requirements, fixing...');
    content = content
      // Join concatenated strings by removing + and quotes
      .replace(/"\s*\+\s*"/g, '')
      // Replace escaped newlines with actual newlines
      .replace(/\\n/g, '\n')
      // Remove any remaining JavaScript string artifacts
      .replace(/^['"]|['"]$/g, '');
  }
  
  // First detect if the content is already wrapped in <p> tags
  const isWrappedInTags = content.trim().startsWith('<p>') && content.trim().endsWith('</p>');
  
  // Clean up the content for formatting
  let cleanedContent = content
    // Remove non-breaking spaces and normalize whitespace
    .replace(/&nbsp;/g, ' ')
    // Normalize line breaks
    .replace(/\r\n|\r/g, '\n')
    // Clean up excessive whitespace
    .trim();
  
  // CRITICAL: For correctly handling <br> followed by <ul> - don't split these
  // Replace <br>\n<ul> with a special marker
  cleanedContent = cleanedContent.replace(/<br>\s*\n*\s*<ul/gi, '__LIST_MARKER__<ul');
  
  // Split by paragraphs (respecting HTML structure)
  const paragraphs = cleanedContent.split(/(?:<br\s*\/?>\s*){2,}|<\/p>\s*<p>|<p>\s*<\/p>|\n\s*\n/);
  
  let result = '';
  let hasList = false;
  
  // Process each paragraph
  paragraphs.forEach((para, index) => {
    if (!para.trim()) return;
    
    let processedPara = para.trim();
    
    // Restore list markers
    processedPara = processedPara.replace(/__LIST_MARKER__/g, '<br>');
    
    // Skip if this paragraph is actually a list - we'll handle it separately
    if (processedPara.startsWith('<ul') || processedPara.includes('<ul')) {
      hasList = true;
      // Add list without extra newlines
      result += processedPara;
      return;
    }
    
    // If paragraph already has HTML structure, preserve it
    if (processedPara.startsWith('<p') || 
        processedPara.startsWith('<h') || 
        processedPara.startsWith('<div')) {
      
      // Handle the case where paragraph contains a list after text
      if (processedPara.includes('<ul')) {
        // Split at the list
        const parts = processedPara.split(/<ul/);
        
        // Process the text part
        let textPart = parts[0];
        if (!textPart.startsWith('<p')) {
          textPart = `<p>${textPart}</p>`;
        }
        
        // Reconstruct with the list
        result += textPart + '<ul' + parts.slice(1).join('<ul');
      } else {
        result += processedPara;
      }
      return;
    }
    
    // Format the first paragraph without bold (removed automatic bold formatting)
    if (index === 0) {
      // Remove any existing HTML formatting
      processedPara = processedPara.replace(/<[^>]*>/g, '');
      result += `<p>${processedPara}</p>`;
    } else {
      result += `<p>${processedPara}</p>`;
    }
  });
  
  // Handle any lists in the content that weren't already processed
  if (cleanedContent.includes('<ul') || cleanedContent.includes('<li')) {
    // Extract lists from the original content
    const listMatches = cleanedContent.match(/<ul[^>]*>[\s\S]*?<\/ul>/gi);
    if (listMatches && !hasList) {
      // Only add the lists if they weren't already included in the paragraphs
      listMatches.forEach(list => {
        // PRESERVE Mysolution's clean list formatting - do NOT add paragraph tags
        // Adding <p> tags to list items causes spacing issues in Webflow
        result += list;
      });
    }
  }
  
  // If content already had <p> tags but we failed to extract the content,
  // use a more reliable approach to extract initial paragraph and lists
  if (isWrappedInTags && (!result || result.indexOf('<ul') === 0)) {
    let paraContent = '';
    
    // Extract the initial paragraph text from the content
    const initialParaMatch = content.match(/<p>([\s\S]*?)(?:<br>\s*\n*\s*<ul|<ul|<\/p>)/i);
    if (initialParaMatch && initialParaMatch[1].trim()) {
      paraContent = `<p>${initialParaMatch[1].trim()}</p>`;
    }
    
    // Extract lists
    const listMatches = content.match(/<ul[^>]*>[\s\S]*?<\/ul>/gi);
    if (listMatches) {
      // PRESERVE Mysolution's clean list formatting - do NOT add paragraph tags
      const listContent = listMatches.map(list => list).join('');
      
      // Combine paragraph and list
      result = paraContent + listContent;
    } else if (paraContent) {
      result = paraContent;
    }
  }
  
  // Final wrapping if needed
  if (!result.trim()) {
    result = `<p>${cleanedContent}</p>`;
  }
  
  // Fix any remaining issues with list items
  result = result
    // Fix duplicate closing paragraph tags
    .replace(/<\/p><\/p><\/li>/gi, '</p></li>')
    .replace(/<li><p>(.*?)<\/p><\/p><\/li>/gi, '<li><p>$1</p></li>')
    // Fix any unclosed paragraph tags in list items
    .replace(/<li>([^<]*)<p>([^<]*?)(?:<\/li>|<li>)/gi, '<li><p>$1$2</p></li>');
  
  // Remove any trailing whitespace before closing tags
  result = result.replace(/\s+(<\/[a-z0-9]+>)/gi, '$1');
  
  // Remove trailing space after </ul> tag which is common in some edge cases
  result = result.replace(/<\/ul>\s+(<br>)?<\/p>/gi, '</ul></p>');
  
  // Ensure proper HTML structure
  if (!result.startsWith('<')) {
    result = `<p>${result}</p>`;
  }
  
  // One final check for double closing paragraph tags
  result = result
    .replace(/<\/p><\/p><\/li>/gi, '</p></li>')
    .replace(/<li><p>(.*?)<\/p><\/p><\/li>/gi, '<li><p>$1</p></li>');
  
  // Remove any raw newlines in the final output to prevent Webflow truncation
  result = result.replace(/\n/g, '');
  
  // CRITICAL FIX: Decode HTML entities that Webflow may have encoded
  // This ensures "&amp;" displays as "&" on the frontend
  result = result
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'');
  
  // Log the final result for debugging
  logger.debug('Formatted job requirements for Webflow:', result);
  
  return result;
}

/**
 * Clean job title by removing unnecessary quotes
 * @param {string} title - Job title from Mysolution
 * @returns {string} - Cleaned job title
 */
function cleanJobTitle(title) {
  if (!title) return 'Untitled Job';
  
  // Remove outer quotes if present (both double and single quotes)
  let cleanedTitle = title.trim();
  
  // Check for surrounding quotes (both " and ')
  if ((cleanedTitle.startsWith('"') && cleanedTitle.endsWith('"')) || 
      (cleanedTitle.startsWith('\'') && cleanedTitle.endsWith('\''))) {
    cleanedTitle = cleanedTitle.substring(1, cleanedTitle.length - 1);
  }
  
  // Also handle escaped quotes
  cleanedTitle = cleanedTitle.replace(/\\"/g, '"');
  
  logger.debug(`Cleaned job title from "${title}" to "${cleanedTitle}"`);
  return cleanedTitle;
}

/**
 * Clean job excerpt by removing HTML tags and trimming
 * @param {string} excerpt - Job excerpt text
 * @returns {string} - Cleaned excerpt
 */
function cleanExcerpt(excerpt) {
  if (!excerpt) return '';
  
  // Remove HTML tags and trim
  let cleanedExcerpt = excerpt
    .replace(/<br\s*\/?>/gi, ' ') // Replace <br> with space
    .replace(/<[^>]*>/g, '')      // Remove all HTML tags
    .replace(/\s+/g, ' ')         // Normalize whitespace
    .trim();
  
  // CRITICAL FIX: Decode HTML entities that Webflow may have encoded
  // This ensures "&amp;" displays as "&" on the frontend
  cleanedExcerpt = cleanedExcerpt
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'');
  
  logger.debug(`Cleaned job excerpt from "${excerpt}" to "${cleanedExcerpt}"`);
  return cleanedExcerpt;
} 