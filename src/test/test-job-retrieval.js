// test-job-retrieval.js

import mysolutionAPI from '../api/mysolution.js';
import webflowAPI from '../api/webflow.js';
import { logger } from '../utils/logger.js';
  
/**
 * Test script to retrieve all jobs from Mysolution without any filtering
 */
async function testRetrieveAllJobs() {
  console.log('=== 🔍 TESTING COMPLETE JOB RETRIEVAL FROM MYSOLUTION ===');
  
  try {
    // 1. Get current jobs in Webflow for comparison
    console.log('📋 Retrieving current jobs from Webflow...');
    const webflowJobsResponse = await webflowAPI.getJobs();
    const webflowJobs = webflowJobsResponse.items || [];
    console.log(`📊 Current Webflow job count: ${webflowJobs.length}`);
    
    // Log the IDs of existing Webflow jobs
    console.log('Webflow job Mysolution IDs:');
    webflowJobs.forEach(job => {
      console.log(`  - ${job.fieldData['mysolution-id']} (${job.name})`);
    });
    
    // 2. Get all jobs directly from Mysolution using original method
    console.log('\n📥 Fetching jobs using standard getJobs() method...');
    const standardJobs = await mysolutionAPI.getJobs();
    console.log(`📊 Standard method returned ${standardJobs.length} jobs`);
    
    // 3. Test raw API call with no parameters
    console.log('\n📥 Testing raw API call with no parameters...');
    const rawResponse = await mysolutionAPI.client.get('/services/apexrest/msf/api/job/Get');
    const rawJobs = rawResponse.data || [];
    console.log(`📊 Raw API call returned ${rawJobs.length} jobs`);
    
    // 4. Try with specific parameter to show all jobs regardless of status
    console.log('\n📥 Testing API call with showAllStatuses=true parameter...');
    const allStatusesResponse = await mysolutionAPI.client.get('/services/apexrest/msf/api/job/Get', {
      params: { 
        showAllStatuses: true,
        includeInactive: true,
        includeUnpublished: true
      }
    });
    const allStatusesJobs = allStatusesResponse.data || [];
    console.log(`📊 All statuses API call returned ${allStatusesJobs.length} jobs`);
    
    // 5. Check job statuses
    const jobsByStatus = {};
    rawJobs.forEach(job => {
      const status = job.Status || 'Unknown';
      jobsByStatus[status] = (jobsByStatus[status] || 0) + 1;
    });
    
    console.log('\n📊 Job breakdown by status:');
    Object.entries(jobsByStatus).forEach(([status, count]) => {
      console.log(`  - ${status}: ${count} jobs`);
    });
    
    // 6. Check for any apparent filtering in job data
    console.log('\n🔍 Looking for possible filtering criteria in job data...');
    if (rawJobs.length > 0) {
      // Sample the first job to examine fields that might relate to filtering
      const sampleJob = rawJobs[0];
      const relevantFields = [
        'Status', 
        'IsActive', 
        'IsPublished', 
        'ShowOnWebsite', 
        'msf__ShowOnWebsite__c',
        'msf__Status__c',
        'msf__Active__c'
      ];
      
      console.log('Sample job filtering-related fields:');
      relevantFields.forEach(field => {
        if (field in sampleJob) {
          console.log(`  - ${field}: ${sampleJob[field]}`);
        }
      });
      
      // Generate statistics for common fields that might be used for filtering
      relevantFields.forEach(field => {
        const fieldValues = {};
        rawJobs.forEach(job => {
          if (field in job) {
            const value = job[field];
            fieldValues[value] = (fieldValues[value] || 0) + 1;
          }
        });
        
        if (Object.keys(fieldValues).length > 0) {
          console.log(`\nField "${field}" breakdown:`);
          Object.entries(fieldValues).forEach(([value, count]) => {
            console.log(`  - ${value}: ${count} jobs`);
          });
        }
      });
    }
    
    // 7. Compare the jobs missing from Webflow
    if (rawJobs.length > webflowJobs.length) {
      console.log('\n🔍 IDENTIFICATION OF MISSING JOBS:');
      
      // Create a set of Mysolution IDs in Webflow
      const webflowMysolutionIds = new Set(
        webflowJobs.map(job => job.fieldData['mysolution-id'])
      );
      
      // Find jobs that are in Mysolution but not in Webflow
      const missingJobs = rawJobs.filter(job => !webflowMysolutionIds.has(job.Id));
      
      console.log(`Found ${missingJobs.length} jobs in Mysolution that are not in Webflow`);
      
      // Group missing jobs by a potential filtering field (e.g., Status)
      const missingJobsByStatus = {};
      missingJobs.forEach(job => {
        const status = job.Status || 'Unknown';
        if (!missingJobsByStatus[status]) {
          missingJobsByStatus[status] = [];
        }
        missingJobsByStatus[status].push(job);
      });
      
      console.log('\nMissing jobs breakdown by status:');
      Object.entries(missingJobsByStatus).forEach(([status, jobs]) => {
        console.log(`  - ${status}: ${jobs.length} jobs`);
        // Show a sample of these jobs
        if (jobs.length > 0) {
          console.log('    Sample jobs:');
          jobs.slice(0, 3).forEach(job => {
            console.log(`    - ${job.Id}: ${job.Name}`);
          });
        }
      });
    }
    
    console.log('\n=== 🏁 TEST COMPLETE ===');
    console.log(`Total jobs in Mysolution: ${rawJobs.length}`);
    console.log(`Total jobs in Webflow: ${webflowJobs.length}`);
    
    return {
      webflowCount: webflowJobs.length,
      mysolutionCount: rawJobs.length,
      standardMethodCount: standardJobs.length,
      allStatusesCount: allStatusesJobs.length
    };
  } catch (error) {
    console.error('❌ Error in test script:', error);
    logger.error('Error in job retrieval test script:', error);
    throw error;
  }
}

/**
 * Fetch and analyze a specific job by ID to examine publication criteria fields
 * @param {string} jobId - The Mysolution job ID to fetch
 */
async function testSpecificJobFields(jobId = 'a0wd1000000Ju6XAAS') {
  console.log(`\n=== 🔍 EXAMINING SPECIFIC JOB (ID: ${jobId}) ===`);
  
  try {
    // Attempt to fetch the job directly from the API
    console.log(`Fetching job with ID: ${jobId}...`);
    
    // Try the getJobById method first
    let job;
    try {
      job = await mysolutionAPI.getJobById(jobId);
      console.log('Successfully retrieved job using getJobById method');
    } catch (error) {
      console.log(`getJobById method failed with error: ${error.message}`);
      console.log('Falling back to direct API call...');
      
      // Try a direct API call as fallback
      const response = await mysolutionAPI.client.get('/services/apexrest/msf/api/job/Get', {
        params: { id: jobId }
      });
      
      // If the API returns an array, find the matching job
      if (Array.isArray(response.data)) {
        job = response.data.find(j => j.Id === jobId);
        if (!job) {
          throw new Error('Job not found in API response array');
        }
      } else if (response.data && response.data.Id === jobId) {
        // If the API returns a single job object
        job = response.data;
      } else {
        throw new Error('Job not found in API response');
      }
      
      console.log('Successfully retrieved job using direct API call');
    }
    
    // Check if job was found
    if (!job) {
      throw new Error(`Job with ID ${jobId} not found`);
    }
    
    // Output basic job info
    console.log('\n📋 JOB DETAILS:');
    console.log(`  - ID: ${job.Id}`);
    console.log(`  - Name: ${job.Name}`);
    
    // Analyze the three critical publication criteria fields
    console.log('\n🔑 PUBLICATION CRITERIA FIELDS:');
    
    // 1. Status - Check both potential status fields
    const status = job.msf__Status__c || job.Status || 'Unknown';
    console.log(`  1. Status: ${status}`);
    console.log(`     Is Online: ${status === 'Online' ? '✅ YES' : '❌ NO'}`);
    
    // 2. Publish to Web checkbox
    const publishToWeb = job.msf__Show_On_Website__c || job.ShowOnWebsite || false;
    console.log(`  2. Publish to Web: ${publishToWeb ? '✅ YES' : '❌ NO'}`);
    
    // 3. End date field - Check for potential end date fields
    const endDateFields = [
      'msf__Op_Website_tm__c',     // Likely Dutch field name
      'msf__Published_Until__c',   // Possible English equivalent
      'msf__Website_End_Date__c',  // Another possible name
      'msf__ExpireDate__c',        // Another possibility
      'WebsiteEndDate'             // Simple name possibility
    ];
    
    let endDateField = null;
    let endDateValue = null;
    
    // Find the first existing end date field
    for (const field of endDateFields) {
      if (field in job && job[field]) {
        endDateField = field;
        endDateValue = job[field];
        break;
      }
    }
    
    if (endDateField) {
      const endDate = new Date(endDateValue);
      const now = new Date();
      const isExpired = endDate < now;
      
      console.log(`  3. End Date Field Found: ${endDateField}`);
      console.log(`     Value: ${endDateValue}`);
      console.log(`     Has Expired: ${isExpired ? '❌ YES (in the past)' : '✅ NO (still valid)'}`);
    } else {
      console.log('  3. End Date: ❓ No end date field found in job data');
      
      // Log all date-like fields to help identify potential end date field
      console.log('\n🔍 All date fields in job data:');
      Object.entries(job).forEach(([key, value]) => {
        if (
          key.includes('Date') || 
          key.includes('date') || 
          key.includes('tm') || 
          key.includes('Time') || 
          key.includes('Expire') ||
          (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}/))
        ) {
          console.log(`     - ${key}: ${value}`);
        }
      });
    }
    
    // Overall publication status based on all three criteria
    const meetsAllCriteria = 
      (status === 'Online') && 
      publishToWeb && 
      (!endDateValue || new Date(endDateValue) >= new Date());
    
    console.log('\n📊 OVERALL PUBLICATION STATUS:');
    console.log(`  Should be published on website: ${meetsAllCriteria ? '✅ YES' : '❌ NO'}`);
    
    // Log all fields for reference
    console.log('\n📄 ALL JOB FIELDS (for reference):');
    console.log(JSON.stringify(job, null, 2));
    
    return {
      id: job.Id,
      name: job.Name,
      status,
      publishToWeb,
      endDateField,
      endDateValue,
      meetsAllCriteria
    };
  } catch (error) {
    console.error(`❌ Error examining job ${jobId}:`, error);
    logger.error(`Error examining job ${jobId}:`, error);
    throw error;
  }
}

// Execute tests
async function runAllTests() {
  try {
    console.log('Running general job retrieval test...');
    await testRetrieveAllJobs();
    
    console.log('\nRunning specific job field test...');
    await testSpecificJobFields();
    
    console.log('\nAll tests completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Tests failed:', error);
    process.exit(1);
  }
}

runAllTests();