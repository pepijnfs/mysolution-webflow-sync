import { logger } from '../utils/logger.js';
import mysolutionAPI from '../api/mysolution.js';
import webflowAPI from '../api/webflow.js';
import { transformMysolutionToWebflow } from '../models/jobsTransformer.js';
import syncStateStore from '../utils/syncStateStore.js';
import publishingService from './publishingService.js';
import { shouldJobBePublished } from '../utils/jobUtils.js';
import config from '../utils/config.js';

/**
 * Synchronize all jobs from Mysolution to Webflow
 * @returns {Object} Sync result summary
 */
async function jobsSync() {
  const syncId = `full-sync-${Date.now()}`;
  try {
    logger.info('Starting full jobs synchronization process', { syncId });
    return await syncJobs(false, syncId);
  } catch (error) {
    logger.error('Error during full jobs synchronization:', { syncId, error: error.message, stack: error.stack });
    syncStateStore.recordSyncError(error);
    throw error;
  }
}

/**
 * Synchronize only changed jobs since last sync
 * @returns {Object} Sync result summary
 */
async function incrementalJobsSync(options = {}) {
  const syncId = `inc-sync-${Date.now()}`;
  try {
    logger.info('Starting incremental jobs synchronization process', { syncId });
    
    // Perform standard incremental sync
    const syncResults = await syncJobs(true, syncId, options);
    
    // After regular sync, optionally check for jobs that need to be unpublished
    // Guarded by ENABLE_UNPUBLISH_SCAN (defaults to true) to reduce memory when disabled
    const disableUnpublishScan = options.disableUnpublishScan === true;
    const enableUnpublishScan = !disableUnpublishScan && (process.env.ENABLE_UNPUBLISH_SCAN || 'true') === 'true';
    if (enableUnpublishScan) {
      console.log('\n=== 🔍 ADDITIONAL CHECK: Scanning for jobs that need to be unpublished ===');
      logger.info('Performing additional check for jobs that need to be unpublished');

      // 1. Get all jobs from Mysolution (regardless of modification date)
      console.log('📥 Fetching all jobs from Mysolution for publication check...');
      const allMysolutionJobs = await mysolutionAPI.getJobs();
      console.log(`📊 Retrieved ${allMysolutionJobs.length} total jobs from Mysolution`);

      // 2. Filter jobs that meet publication criteria
      const publishableJobIds = new Set(
        allMysolutionJobs
          .filter(job => shouldJobBePublished(job))
          .map(job => job.Id)
      );
      console.log(`📊 ${publishableJobIds.size} jobs meet publication criteria`);

      // 3. Get all jobs from Webflow that are currently published (not archived)
      console.log('📥 Retrieving current jobs from Webflow...');
      console.log('Using getAllJobs() to ensure all jobs are retrieved with pagination...');

      // Use getAllJobs instead of getJobs to ensure we get all jobs, not just the first 100
      const allWebflowJobs = await webflowAPI.getAllJobs();

      // Filter to get only non-archived jobs
      const webflowJobs = allWebflowJobs.filter(job => !job.isArchived);

      logger.info(`Fetched ${allWebflowJobs.length} total jobs from Webflow, ${webflowJobs.length} are not archived`);
      console.log(`📊 Found ${webflowJobs.length} published jobs in Webflow out of ${allWebflowJobs.length} total`);

      // 4. Find jobs in Webflow that should no longer be published
      const jobsToUnpublish = webflowJobs.filter(job => {
        const mysolutionId = job.fieldData && job.fieldData['mysolution-id'];
        return mysolutionId && !publishableJobIds.has(mysolutionId);
      });

      if (jobsToUnpublish.length > 0) {
        console.log(`\n=== 🗃️ FOUND ${jobsToUnpublish.length} JOBS TO UNPUBLISH ===`);
        logger.info(`Found ${jobsToUnpublish.length} jobs that need to be unpublished based on publication criteria`);

        // 5. Process jobs to unpublish
        const unpublishPromises = jobsToUnpublish.map(async (job) => {
          try {
            // Find the corresponding Mysolution job to determine the reason
            const mysolutionId = job.fieldData['mysolution-id'];
            const mysolutionJob = allMysolutionJobs.find(mj => mj.Id === mysolutionId);
            let archiveReason = 'Unknown';

            if (mysolutionJob) {
              if (mysolutionJob.msf__Status__c !== 'Online') {
                archiveReason = `Status changed to "${mysolutionJob.msf__Status__c}"`;
              } else if (!mysolutionJob.msf__Show_On_Website__c) {
                archiveReason = 'Show on Website disabled';
              } else if (mysolutionJob.msf__On_Website_To__c && new Date(mysolutionJob.msf__On_Website_To__c) < new Date()) {
                archiveReason = `End date (${mysolutionJob.msf__On_Website_To__c}) expired`;
              }
            }

            console.log(`🗃️ Archiving job "${job.name}" (ID: ${job.id}) from Webflow - Reason: ${archiveReason}`);

            // Simply mark the job as archived in Webflow
            await webflowAPI.archiveJob(job.id);

            console.log(`✅ Successfully archived job: "${job.name}"`);
            return { id: job.id, success: true };
          } catch (error) {
            console.error(`❌ Error archiving job "${job.name}" (ID: ${job.id}): ${error.message}`);
            logger.error(`Error archiving job ${job.id}:`, error);
            return { id: job.id, success: false, error: error.message };
          }
        });

        // Wait for all unpublish operations to complete
        const unpublishResults = await Promise.allSettled(unpublishPromises);

        // Count successes and failures
        const unpublishSuccessful = unpublishResults.filter(r => r.status === 'fulfilled' && r.value.success).length;
        const unpublishFailed = unpublishResults.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length;

        // Add results to sync summary
        syncResults.unpublishSuccessful = unpublishSuccessful;
        syncResults.unpublishFailed = unpublishFailed;

        logger.info(`Job unpublishing completed. ${unpublishSuccessful} jobs unpublished successfully, ${unpublishFailed} jobs failed to unpublish`);

        // Publish changes to Webflow if any jobs were successfully unpublished
        if (unpublishSuccessful > 0) {
          console.log('\n=== 📡 PUBLISHING CHANGES ===');
          console.log('ℹ️ Attempting to publish unpublishing changes to make them visible on the website...');
          try {
            await publishingService.publishIfEnabled(`Unpublished ${unpublishSuccessful} jobs due to publication criteria changes`);
          } catch (error) {
            console.error('❌ Error publishing site changes:', error.message);
            logger.error('Error publishing site changes after unpublishing jobs:', error);
          }
        }

        // Print final summary for unpublish operations
        console.log('\n====== 🏁 UNPUBLISH RESULTS ======');
        console.log(`📊 UNPUBLISHED JOBS: ${unpublishSuccessful} of ${jobsToUnpublish.length} processed successfully`);
        if (unpublishFailed > 0) {
          console.log(`❌ FAILED UNPUBLISHES: ${unpublishFailed} (check logs for details)`);
        }
      } else {
        console.log('\n=== ✓ NO JOBS NEED TO BE UNPUBLISHED ===');
        console.log('ℹ️ All jobs in Webflow meet current publication criteria');
      }
    } else {
      console.log('\n=== 🔕 UNPUBLISH SCAN DISABLED ===');
      logger.info('Unpublish scan disabled by ENABLE_UNPUBLISH_SCAN');
    }
    
    return syncResults;
  } catch (error) {
    logger.error('Error during incremental jobs synchronization:', { syncId, error: error.message, stack: error.stack });
    syncStateStore.recordSyncError(error);
    throw error;
  }
}

/**
 * Core sync implementation
 * @param {boolean} incrementalOnly - If true, only sync changed jobs
 * @param {string} syncId - Unique ID for this sync operation
 * @returns {Object} Sync result summary
 */
async function syncJobs(incrementalOnly = false, syncId = `sync-${Date.now()}`, options = {}) {
  console.log(`DEBUG: syncJobs called with syncId: ${syncId}`);
  
  let heartbeat;
  try {
    // Heartbeat log near typical serverless timeout
    const heartbeatMs = parseInt(process.env.SYNC_HEARTBEAT_MS || '45000', 10);
    heartbeat = setTimeout(() => {
      console.log(`⏳ HEARTBEAT: Sync ${syncId} still running after ${heartbeatMs}ms`);
      try { logger.warn('Heartbeat: sync still running', { syncId }); } catch {}
    }, heartbeatMs);

    console.log(`\n====== 🔄 STARTING JOB SYNC: ${syncId} ======`);
    console.log(`📋 Sync type: ${incrementalOnly ? 'INCREMENTAL (only changed jobs)' : 'FULL (all jobs)'}`);
    console.log(`DEBUG: syncId before API calls: ${syncId}`);
    
    // Get the last successful sync time
    let lastSyncTime = incrementalOnly ? syncStateStore.getLastSyncTime() : null;
    let usedMiniFallback = false;
    if (incrementalOnly && !lastSyncTime) {
      const fallbackHours = Number.isFinite(options.miniFallbackWindowHours) ? options.miniFallbackWindowHours : 2;
      if (fallbackHours > 0) {
        const now = new Date();
        const fallbackDate = new Date(now.getTime() - fallbackHours * 60 * 60 * 1000);
        lastSyncTime = fallbackDate.toISOString();
        usedMiniFallback = true;
        console.log(`ℹ️ INCREMENTAL SYNC: No previous lastSync found. Using mini fallback window: now-${fallbackHours}h -> ${lastSyncTime}`);
        try { logger.info('Using mini fallback window for incremental sync', { syncId, fallbackHours }); } catch {}
      }
    }
    
    if (incrementalOnly) {
      if (lastSyncTime) {
        console.log(`ℹ️ INCREMENTAL SYNC: Using last sync time: ${lastSyncTime}`);
        const lastSyncDate = new Date(lastSyncTime);
        const now = new Date();
        const diffMinutes = Math.floor((now - lastSyncDate) / (1000 * 60));
        console.log(`⏱️ Time since last sync: ${diffMinutes} minutes`);
      } else {
        console.log('ℹ️ INCREMENTAL SYNC: No previous sync time found and no fallback configured. Will perform full sync instead.');
      }
    } else {
      console.log('ℹ️ FULL SYNC: Will update all jobs regardless of modification time.');
    }
    
    // Fetch jobs from Mysolution (all or only changed)
    let mysolutionJobs;
    let skippedCount = 0;
    
    if (incrementalOnly && lastSyncTime) {
      logger.info(`Fetching jobs changed since last sync: ${lastSyncTime}`);
      
      // IMPROVED: Use the dedicated getChangedJobs API method instead of manual filtering
      console.log('📥 INCREMENTAL SYNC: Using getChangedJobs API for more reliable change detection...');
      
      try {
        // Try using the dedicated API method first
        mysolutionJobs = await mysolutionAPI.getChangedJobs(lastSyncTime);
        console.log(`📥 INCREMENTAL SYNC: getChangedJobs API returned ${mysolutionJobs.length} changed jobs`);
        
        // Validate the results - if we get 0 jobs, double-check with fallback method
        if (mysolutionJobs.length === 0) {
          console.log('⚠️ INCREMENTAL SYNC: getChangedJobs returned 0 jobs, double-checking with fallback method...');
          
          // Fallback: Get all jobs and filter manually as secondary verification
          const allJobs = await mysolutionAPI.getJobs();
          const lastSyncDate = new Date(lastSyncTime);
          
          const manuallyFilteredJobs = allJobs.filter(job => {
            if (!job.LastModifiedDate) return false;
            const jobModDate = new Date(job.LastModifiedDate);
            return jobModDate > lastSyncDate;
          });
          
          console.log(`📊 FALLBACK CHECK: Manual filtering found ${manuallyFilteredJobs.length} jobs modified since last sync`);
          
          // If manual filtering finds jobs but API didn't, use manual results
          if (manuallyFilteredJobs.length > 0) {
            console.log('⚠️ DISCREPANCY DETECTED: Using manually filtered results as API filtering may have failed');
            mysolutionJobs = manuallyFilteredJobs;
          } else {
            console.log('✅ VERIFIED: No jobs have been modified since last sync');
          }
        }
        
      } catch (error) {
        console.log(`❌ INCREMENTAL SYNC: getChangedJobs API failed (${error.message}), falling back to manual filtering`);
        logger.warn(`getChangedJobs API failed, using fallback: ${error.message}`);
        
        // Fallback to manual filtering
        const allJobs = await mysolutionAPI.getJobs();
        const lastSyncDate = new Date(lastSyncTime);
        
        mysolutionJobs = allJobs.filter(job => {
          if (!job.LastModifiedDate) {
            console.log(`❓ Job ${job.Id} has no LastModifiedDate - including for safety`);
            return true; // Include jobs without modification dates for safety
          }
          
          const jobModDate = new Date(job.LastModifiedDate);
          const isModified = jobModDate > lastSyncDate;
          
          if (isModified) {
            console.log(`✅ Job ${job.Id} (${job.Name || 'Unnamed'}) modified: ${job.LastModifiedDate}`);
          }
          
          return isModified;
        });
        
        console.log(`📥 INCREMENTAL SYNC: Fallback filtering found ${mysolutionJobs.length} changed jobs`);
      }
      
      // Log detailed information about what we found
      if (mysolutionJobs.length > 0) {
        console.log('\n=== 📋 CHANGED JOBS SUMMARY ===');
        mysolutionJobs.forEach((job, index) => {
          console.log(`${index + 1}. '${job.Name || 'No Name'}' (ID: ${job.Id})`);
          console.log(`   Last modified: ${job.LastModifiedDate || 'Unknown'}`);
        });
      }
      
      logger.info(`After change detection: ${mysolutionJobs.length} jobs need updating`);
      
      // If no jobs need updating after filtering, we can stop here
      if (mysolutionJobs.length === 0) {
        console.log('✅ SYNC COMPLETE: No jobs need to be updated! All jobs are already in sync.');
        logger.info('No jobs need updating after change detection. Updating sync timestamp and exiting.');
        
        // Still update the last sync time, even though no changes were made
        syncStateStore.updateLastSyncTime();
        
        // Return summary with zero counts
        return {
          successful: 0,
          failed: 0,
          removeSuccessful: 0,
          removeFailed: 0,
          skipped: 0,
          noChanges: true
        };
      }
    } else {
      logger.info('Fetching all jobs from Mysolution');
      mysolutionJobs = await mysolutionAPI.getJobs();
      logger.info(`Fetched ${mysolutionJobs.length} jobs from Mysolution`);
      console.log(`📥 FULL SYNC: Fetched ${mysolutionJobs.length} jobs from Mysolution database`);
    }
    
    // Filter jobs based on publication criteria (status, publish to web, end date)
    const allFetchedJobs = [...mysolutionJobs]; // Keep a copy of all fetched jobs
    const publishableJobs = mysolutionJobs.filter(job => shouldJobBePublished(job));
    
    if (publishableJobs.length < mysolutionJobs.length) {
      const unpublishableCount = mysolutionJobs.length - publishableJobs.length;
      console.log(`🔍 PUBLICATION FILTERING: ${unpublishableCount} jobs do not meet publication criteria`);
      console.log(`  • ${publishableJobs.length} jobs meet criteria (Status = Online, Show on Website = true, End Date valid)`);
      
      // Update mysolutionJobs to only include publishable jobs
      mysolutionJobs = publishableJobs;
      
      // Log reasons why jobs are not publishable
      console.log('\n=== 📋 DETAILS OF UNPUBLISHABLE JOBS ===');
      allFetchedJobs.forEach(job => {
        if (!shouldJobBePublished(job)) {
          console.log(`Job "${job.Name}" (${job.Id}) cannot be published because:`);
          if (job.msf__Status__c !== 'Online') {
            console.log(`  • Status is "${job.msf__Status__c}" instead of "Online"`);
          }
          if (!job.msf__Show_On_Website__c) {
            console.log('  • "Show on Website" is not enabled');
          }
          if (job.msf__On_Website_To__c && new Date(job.msf__On_Website_To__c) < new Date()) {
            console.log(`  • End date (${job.msf__On_Website_To__c}) is in the past`);
          }
        }
      });
    }
    
    logger.info(`After publication criteria filtering: ${mysolutionJobs.length} jobs will be published`);
    
    // Fetch existing jobs from Webflow
    logger.info('Retrieving current jobs from Webflow (for incremental mapping)');
    
    // Use getAllJobs instead of getJobs to ensure we get all jobs, not just the first 100
    const webflowJobs = await webflowAPI.getAllJobs();
    logger.info(`Fetched ${webflowJobs.length} jobs from Webflow using pagination`);
    logger.info(`Current Webflow job count: ${webflowJobs.length}`);
    
    // Create a map of existing jobs in Webflow for quick lookup
    const webflowJobsMap = new Map();
    webflowJobs.forEach(job => {
      const mysolutionJobId = job.fieldData && job.fieldData['mysolution-id'];
      if (mysolutionJobId) {
        console.log(`🔗 Matched Webflow job "${job.name}" with Mysolution ID: ${mysolutionJobId}`);
        webflowJobsMap.set(mysolutionJobId, job);
      } else {
        console.log(`⚠️ Webflow job "${job.name}" has no Mysolution ID`);
      }
    });
    logger.info(`Matched ${webflowJobsMap.size}/${webflowJobs.length} Webflow jobs by mysolution-id`);
    
    // Process each job from Mysolution with limited concurrency
    logger.info(`Starting processing of ${mysolutionJobs.length} jobs`);
    const maxConcurrency = Math.max(1, options.concurrency || config.sync.concurrency || 5);
    const results = [];

    const processJob = async (mysolutionJob) => {
      try {
        // Ensure consistent ID handling - Mysolution uses capital 'I' in Id
        const jobId = mysolutionJob.Id;
        
        logger.debug(`Processing job: ${mysolutionJob.Name || 'No Name'} (${jobId})`);
        
        // Log the modification date for debugging
        if (mysolutionJob.LastModifiedDate) {
          console.log(`ℹ️ Job last modified: ${new Date(mysolutionJob.LastModifiedDate).toLocaleString()}`);
        } else {
          console.log(`⚠️ WARNING: Job ${jobId} is missing modification date information`);
        }
        
        // Check for internal job and log explicitly
        const isInternalJob = mysolutionJob.msf__Show_On_Internal__c === true;
        if (isInternalJob) {
          console.log(`🔒 Job ${jobId} is marked as INTERNAL - will use "Interne Vacature" sector`);
        }
        
        logger.debug('Converting job data to Webflow format');
        
        // Transform job to Webflow format - now returns a Promise
        const webflowJobData = await transformMysolutionToWebflow(mysolutionJob);
        
        // For internal jobs, explicitly log and verify sector field
        if (isInternalJob) {
          const internalSectorId = '65f935a2e6b9d7f69afed2bb';
          if (webflowJobData['job-companies'] === internalSectorId) {
            console.log(`✅ Internal job ${jobId} has correct sector: ${internalSectorId}`);
          } else {
            console.log(`⚠️ Internal job ${jobId} has incorrect sector - fixing to ${internalSectorId}`);
            webflowJobData['job-companies'] = internalSectorId;
          }
        }
        
        // Use standardized create/update method for consistent field processing
        logger.debug(`Upserting job in Webflow: ${mysolutionJob.Name} (${jobId})`);
        // Avoid extra API lookups by passing existing Webflow job ID and skipping sector re-validation
        const existingJob = webflowJobsMap.get(jobId);
        const result = await webflowAPI.createOrUpdateJobByMysolutionId(
          jobId,
          webflowJobData,
          {
            existingJobId: existingJob ? existingJob.id : undefined,
            skipSectorValidation: true
          }
        );
        logger.info(`Job ${jobId} ${result.action}`);
        
        return { id: jobId, success: true, result, modified: mysolutionJob.LastModifiedDate };
      } catch (error) {
        console.error(`Error processing job ${mysolutionJob.Id}:`, error);
        logger.error(`Error processing job ${mysolutionJob.Id}:`, error);
        return { id: mysolutionJob.Id, success: false, error: error.message };
      }
    };

    for (let i = 0; i < mysolutionJobs.length; i += maxConcurrency) {
      const batch = mysolutionJobs.slice(i, i + maxConcurrency).map(j => processJob(j));
      const batchResults = await Promise.allSettled(batch);
      results.push(...batchResults);
    }
    
    // Update job modification dates ONLY for successfully processed jobs
    // This ensures we only store dates for jobs we've actually updated
    console.log('Storing modification dates for successfully processed jobs');
    const jobDates = {};
    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value.success && result.value.modified) {
        const jobId = result.value.id;
        const modDate = result.value.modified;
        jobDates[jobId] = modDate;
        console.log(`Storing job ${jobId} with LastModifiedDate: ${modDate}`);
      }
    });
    
    // Only update the store if we have processed jobs
    if (Object.keys(jobDates).length > 0) {
      syncStateStore.storeMultipleJobDates(jobDates);
    }
    
    // Count successes, failures, and skipped jobs
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length;
    
    console.log(`DEBUG: syncId before final log: ${syncId}`);
    logger.info(`Jobs sync completed. ${successful} jobs synchronized successfully, ${failed} jobs failed`, { 
      syncId,
      syncType: incrementalOnly ? 'incremental' : 'full',
      successful,
      failed,
      skipped: 0
    });
    
    // Update last sync time
    if (incrementalOnly) {
      syncStateStore.updateLastIncrementalSyncTime();
    } else {
      syncStateStore.updateLastFullSyncTime();
    }
    
    // Create sync results for emitting
    const syncResults = {
      type: incrementalOnly ? 'incremental' : 'full',
      timestamp: new Date().toISOString(),
      syncId: syncId,
      total: successful + failed + skippedCount,
      successful: successful,
      failed: failed,
      skipped: skippedCount
    };
    
    // Emit sync completed event for real-time updates
    if (global.eventBus) {
      global.eventBus.emit('sync-completed', { 
        syncType: incrementalOnly ? 'incremental' : 'full',
        lastSync: new Date().toISOString(),
        syncId: syncId,
        syncResults: syncResults
      });
    }
    
    // Only check for removals during full sync
    let archiveSuccessful = 0;
    let archiveFailed = 0;
    
    if (!incrementalOnly) {
      // Identify jobs to archive:
      // 1. Jobs in Webflow that no longer exist in Mysolution at all
      // 2. Jobs that exist in Mysolution but don't meet publication criteria
      
      // First, identify jobs that no longer exist in Mysolution at all
      const mysolutionJobIds = new Set(allFetchedJobs.map(job => job.Id));
      const jobsToRemoveCompletely = webflowJobs.filter(job => {
        const mysolutionJobId = job.fieldData && job.fieldData['mysolution-id'];
        return mysolutionJobId && !mysolutionJobIds.has(mysolutionJobId);
      });
      
      // Then, identify jobs that exist but don't meet criteria (filter publishable IDs vs all IDs)
      const publishableJobIds = new Set(mysolutionJobs.map(job => job.Id));
      const jobsToArchive = webflowJobs.filter(job => {
        const mysolutionJobId = job.fieldData && job.fieldData['mysolution-id'];
        // Job exists in Mysolution but not in publishable jobs
        return mysolutionJobId && 
               mysolutionJobIds.has(mysolutionJobId) && 
               !publishableJobIds.has(mysolutionJobId) && 
               // Check if it's not already archived
               !job.isArchived;
      });
      
      if (jobsToRemoveCompletely.length > 0 || jobsToArchive.length > 0) {
        logger.info(`Found ${jobsToRemoveCompletely.length} jobs to remove and ${jobsToArchive.length} jobs to archive in Webflow`);
        console.log('\n=== 🗃️ ARCHIVING/REMOVING JOBS ===');
        console.log(`ℹ️ Found ${jobsToRemoveCompletely.length} jobs that no longer exist in Mysolution`);
        console.log(`ℹ️ Found ${jobsToArchive.length} jobs that exist but don't meet publication criteria`);
        
        // Process jobs to archive (they exist in Mysolution but don't meet criteria)
        if (jobsToArchive.length > 0) {
          console.log('\n=== 🗃️ ARCHIVING JOBS ===');
          
          // Update jobs to archived status
          const archivePromises = jobsToArchive.map(async (job) => {
            try {
              // Find the corresponding Mysolution job to determine the reason
              const mysolutionJob = allFetchedJobs.find(mj => mj.Id === job.fieldData['mysolution-id']);
              let archiveReason = 'Unknown';
              
              if (mysolutionJob) {
                if (mysolutionJob.msf__Status__c !== 'Online') {
                  archiveReason = `Status changed to "${mysolutionJob.msf__Status__c}"`;
                } else if (!mysolutionJob.msf__Show_On_Website__c) {
                  archiveReason = 'Show on Website disabled';
                } else if (mysolutionJob.msf__On_Website_To__c && new Date(mysolutionJob.msf__On_Website_To__c) < new Date()) {
                  archiveReason = `End date (${mysolutionJob.msf__On_Website_To__c}) expired`;
                }
              }
              
              console.log(`🗃️ Archiving job "${job.name}" (ID: ${job.id}) in Webflow - Reason: ${archiveReason}`);
              
              // Simply mark the job as archived in Webflow
              await webflowAPI.archiveJob(job.id);
              
              console.log(`✅ Successfully archived job: "${job.name}"`);
              return { id: job.id, success: true };
            } catch (error) {
              console.error(`❌ Error archiving job "${job.name}" (ID: ${job.id}): ${error.message}`);
              logger.error(`Error archiving job ${job.id}:`, error);
              return { id: job.id, success: false, error: error.message };
            }
          });
          
          // Wait for all archive operations to complete
          const archiveResults = await Promise.allSettled(archivePromises);
          
          // Count successes and failures
          archiveSuccessful = archiveResults.filter(r => r.status === 'fulfilled' && r.value.success).length;
          archiveFailed = archiveResults.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length;
          
          logger.info(`Job archiving completed. ${archiveSuccessful} jobs archived successfully, ${archiveFailed} jobs failed to archive`);
        }
        
        // Process jobs that no longer exist in Mysolution - archive them instead of removing
        let removedJobsArchiveSuccessful = 0;
        let removedJobsArchiveFailed = 0;
        
        if (jobsToRemoveCompletely.length > 0) {
          console.log('\n=== 🗃️ ARCHIVING JOBS NO LONGER IN MYSOLUTION ===');
          console.log(`ℹ️ Found ${jobsToRemoveCompletely.length} jobs that no longer exist in Mysolution`);
          
          // Archive jobs that no longer exist in Mysolution instead of deleting them
          const archiveRemovedPromises = jobsToRemoveCompletely.map(async (job) => {
            try {
              console.log(`🗃️ Archiving job "${job.name}" (ID: ${job.id}) that no longer exists in Mysolution`);
              
              // Simply mark the job as archived in Webflow
              await webflowAPI.archiveJob(job.id);
              
              console.log(`✅ Successfully archived job that no longer exists: "${job.name}"`);
              return { id: job.id, success: true };
            } catch (error) {
              console.error(`❌ Error archiving job "${job.name}" (ID: ${job.id}): ${error.message}`);
              logger.error(`Error archiving job ${job.id}:`, error);
              return { id: job.id, success: false, error: error.message };
            }
          });
          
          // Wait for all archive operations to complete
          const archiveRemovedResults = await Promise.allSettled(archiveRemovedPromises);
          
          // Count successes and failures
          removedJobsArchiveSuccessful = archiveRemovedResults.filter(r => r.status === 'fulfilled' && r.value.success).length;
          removedJobsArchiveFailed = archiveRemovedResults.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length;
          
          // Add to the total archive counts
          archiveSuccessful += removedJobsArchiveSuccessful;
          archiveFailed += removedJobsArchiveFailed;
          
          logger.info(`Job archiving for removed jobs completed. ${removedJobsArchiveSuccessful} jobs archived successfully, ${removedJobsArchiveFailed} jobs failed to archive`);
        }
      } else {
        console.log('\n=== ✓ NO JOBS TO ARCHIVE OR REMOVE ===');
        console.log('ℹ️ All jobs in Webflow are still valid - no jobs need to be archived or removed');
      }
    }
    
    // Publish changes to Webflow if any jobs were successfully processed
    if (successful > 0 || archiveSuccessful > 0) {
      console.log('\n=== 📡 PUBLISHING CHANGES ===');
      console.log('ℹ️ Attempting to publish all changes to make them visible on the website...');
      try {
        await publishingService.publishIfEnabled(`Job sync completed (${successful} jobs processed, ${archiveSuccessful} archived)`);
      } catch (error) {
        console.error('❌ Error publishing site changes:', error.message);
        console.error('ℹ️ Your content changes have been saved to Webflow but may not be visible on the live site yet.');
        console.error('ℹ️ You can try publishing again manually through the dashboard.');
        logger.error('Error publishing site changes after job sync:', error);
        // Don't throw the error - the sync was successful, publishing is secondary
      }
    } else {
      console.log('\n=== ℹ️ NO PUBLISHING NEEDED ===');
      console.log('ℹ️ No changes were made to any jobs, skipping publish step');
    }
    
    // Print final summary
    console.log(`\n====== 🏁 FINAL SYNC RESULTS: ${syncId} ======`);
    console.log(`📊 UPDATED JOBS: ${successful} of ${mysolutionJobs.length} processed successfully`);
    if (failed > 0) {
      console.log(`❌ FAILED JOBS: ${failed} (check logs for details)`);
    }
    console.log(`⏩ SKIPPED JOBS: ${skippedCount} (no changes detected)`);
    
    if (!incrementalOnly) {
      console.log(`🗃️ ARCHIVED JOBS: ${archiveSuccessful} (no longer publishable or deleted from Mysolution)`);
      if (archiveFailed > 0) {
        console.log(`❌ FAILED ARCHIVES: ${archiveFailed} (check logs for details)`);
      }
    }
    
    const totalProcessed = successful + archiveSuccessful;
    if (totalProcessed > 0) {
      console.log(`\n🎉 SYNC SUCCESSFUL! Total ${totalProcessed} changes applied to the website.`);
    } else {
      console.log('\n✅ SYNC COMPLETE! No changes were needed - everything is already up to date.');
    }
    console.log('====================================================\n');
    
    // Clear heartbeat timer
    try { clearTimeout(heartbeat); } catch {}

    // Return summary
    return {
      successful,
      failed,
      archiveSuccessful,
      archiveFailed,
      skipped: skippedCount
    };
  } catch (error) {
    console.error('Error during jobs sync:', error);
    logger.error('Error during jobs sync:', error);
    // Best-effort: clear heartbeat timer
    try { clearTimeout(heartbeat); } catch {}
    throw error;
  }
}

export { jobsSync, incrementalJobsSync }; 