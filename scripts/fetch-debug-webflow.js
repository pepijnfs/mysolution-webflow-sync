import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import webflowAPI from '../src/api/webflow.js';
import { logger } from '../src/utils/logger.js';

// Helper for __dirname in ES modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Load environment variables
dotenv.config();

/**
 * Fetch a specific job by ID from Webflow and save it to debug-manual-webflow.json
 * @param {string} jobId - The Webflow job ID to fetch
 */
async function fetchDebugWebflowJob(jobId) {
  try {
    console.log(`\n===== FETCHING DEBUG WEBFLOW JOB: ${jobId} =====\n`);
    
    if (!jobId) {
      throw new Error('Job ID is required. Please provide a job ID as an argument.');
    }
    
    console.log(`🔍 Fetching job with ID: ${jobId}`);
    console.log('📡 Connecting to Webflow API...');
    
    // Fetch the specific job by ID
    const job = await webflowAPI.getJob(jobId);
    
    if (!job) {
      console.error(`❌ Job with ID ${jobId} not found in Webflow`);
      process.exit(1);
    }
    
    console.log('✅ Successfully fetched job from Webflow');
    
    // Save to debug-manual-webflow.json in the root directory
    const debugFilePath = path.join(rootDir, 'debug-manual-webflow.json');
    
    console.log('💾 Saving job data to debug-manual-webflow.json...');
    fs.writeFileSync(debugFilePath, JSON.stringify(job, null, 2));
    
    console.log('✅ Job data saved successfully');
    console.log(`📄 File size: ${fs.statSync(debugFilePath).size} bytes`);
    console.log('📝 Complete job structure saved to debug-manual-webflow.json for analysis');
    
  } catch (error) {
    console.error('\n❌ Error fetching debug webflow job:', error.message);
    logger.error('Error in fetch-debug-webflow script:', error);
    
    if (error.message.includes('not found') || error.message.includes('404')) {
      console.log(`\n💡 Tip: Make sure the job ID '${jobId}' exists in Webflow and is accessible.`);
    } else if (error.message.includes('authentication') || error.message.includes('401')) {
      console.log('\n💡 Tip: Check your Webflow API credentials in the .env file.');
    } else if (error.message.includes('network') || error.message.includes('timeout')) {
      console.log('\n💡 Tip: Check your network connection and Webflow API URL.');
    }
    
    process.exit(1);
  }
}

// Get job ID from command line arguments
const jobId = process.argv[2] || '6850125a0f184e95b5054323';

// Show usage if no arguments provided and using default
if (process.argv.length <= 2) {
  console.log('\n📋 Usage: node scripts/fetch-debug-webflow.js [JOB_ID]');
  console.log(`🔧 Using default job ID: ${jobId}`);
  console.log('\n💡 You can specify a different job ID as an argument\n');
}

// Run the script
fetchDebugWebflowJob(jobId).catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
}); 