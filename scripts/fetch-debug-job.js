import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mysolutionAPI from '../src/api/mysolution.js';
import { logger } from '../src/utils/logger.js';

// Helper for __dirname in ES modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Load environment variables
dotenv.config();

/**
 * Fetch a specific job by ID from Mysolution and save it to debug-manual-job.json
 * @param {string} jobId - The Mysolution job ID to fetch
 */
async function fetchDebugJob(jobId) {
  try {
    console.log(`\n===== FETCHING DEBUG JOB: ${jobId} =====\n`);
    
    if (!jobId) {
      throw new Error('Job ID is required. Please provide a job ID as an argument.');
    }
    
    console.log(`🔍 Fetching job with ID: ${jobId}`);
    console.log('📡 Connecting to Mysolution API...');
    
    // Fetch the specific job by ID
    const job = await mysolutionAPI.getJobById(jobId);
    
    if (!job) {
      console.error(`❌ Job with ID ${jobId} not found in Mysolution`);
      process.exit(1);
    }
    
    console.log('✅ Successfully fetched job from Mysolution');
    
    // Save to debug-manual-job.json in the root directory
    const debugFilePath = path.join(rootDir, 'debug-manual-job.json');
    
    console.log('💾 Saving job data to debug-manual-job.json...');
    fs.writeFileSync(debugFilePath, JSON.stringify(job, null, 2));
    
    console.log('✅ Job data saved successfully');
    console.log(`📄 File size: ${fs.statSync(debugFilePath).size} bytes`);
    console.log('📝 Complete job structure saved to debug-manual-job.json for analysis');
    
  } catch (error) {
    console.error('\n❌ Error fetching debug job:', error.message);
    logger.error('Error in fetch-debug-job script:', error);
    
    if (error.message.includes('not found')) {
      console.log(`\n💡 Tip: Make sure the job ID '${jobId}' exists in Mysolution and is accessible.`);
    } else if (error.message.includes('authentication') || error.message.includes('401')) {
      console.log('\n💡 Tip: Check your Mysolution API credentials in the .env file.');
    } else if (error.message.includes('network') || error.message.includes('timeout')) {
      console.log('\n💡 Tip: Check your network connection and Mysolution API URL.');
    }
    
    process.exit(1);
  }
}

// Get job ID from command line arguments
const jobId = process.argv[2] || 'a0wd1000000bn9rAAA';

// Show usage if no arguments provided and using default
if (process.argv.length <= 2) {
  console.log('\n📋 Usage: node scripts/fetch-debug-job.js [JOB_ID]');
  console.log(`🔧 Using default job ID: ${jobId}`);
  console.log('\n💡 You can specify a different job ID as an argument\n');
}

// Run the script
fetchDebugJob(jobId).catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
}); 