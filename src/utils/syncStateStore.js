import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

// Helper for __dirname in ES modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYNC_STATE_FILE = path.join(__dirname, '../../data/sync-state.json');

// Detect if we're running in Vercel's serverless environment
const isServerless = process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME;

// In-memory state for serverless environments
let inMemorySyncState = null;

// Ensure the data directory exists (only in development/non-serverless environments)
if (!isServerless) {
  const dataDir = path.dirname(SYNC_STATE_FILE);
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  } catch (error) {
    console.warn(`Warning: Could not create data directory: ${error.message}`);
  }
}

/**
 * Default sync state structure
 */
const DEFAULT_SYNC_STATE = {
  lastSync: null, // ISO string of last successful sync
  syncCount: 0,   // Number of successful syncs
  lastError: null, // Last error encountered during sync
  jobModificationDates: {} // Object of job IDs mapped to their last modification dates
};

/**
 * Load sync state from disk or memory
 * @returns {Object} Current sync state
 */
function loadSyncState() {
  // If in serverless environment, use in-memory state
  if (isServerless) {
    if (inMemorySyncState === null) {
      console.log('Initializing in-memory sync state in serverless environment');
      inMemorySyncState = { ...DEFAULT_SYNC_STATE };
    }
    return { ...inMemorySyncState }; // Return a copy to avoid reference issues
  }

  // In non-serverless environment, load from file
  try {
    if (fs.existsSync(SYNC_STATE_FILE)) {
      console.log(`Loading sync state from file: ${SYNC_STATE_FILE}`);
      const data = fs.readFileSync(SYNC_STATE_FILE, 'utf8');
      console.log(`Read ${data.length} bytes from sync state file`);
      
      // Validate JSON before parsing
      let state;
      try {
        state = JSON.parse(data);
      } catch (jsonError) {
        console.error('Failed to parse sync state file - corrupted JSON:', jsonError);
        logger.error('Sync state file contains invalid JSON, using default state', jsonError);
        // If JSON is corrupted, backup the file and return default state
        const backupFile = `${SYNC_STATE_FILE}.corrupted.${Date.now()}`;
        fs.writeFileSync(backupFile, data, 'utf8');
        console.log(`Backed up corrupted state file to ${backupFile}`);
        return { ...DEFAULT_SYNC_STATE };
      }
      
      // Ensure state is an object
      if (!state || typeof state !== 'object') {
        console.error('Sync state file does not contain a valid state object');
        return { ...DEFAULT_SYNC_STATE };
      }
      
      // Ensure jobModificationDates exists (for backward compatibility)
      if (!state.jobModificationDates) {
        console.log('Adding missing jobModificationDates property to loaded state');
        state.jobModificationDates = {};
      } else {
        console.log(`Loaded state has ${Object.keys(state.jobModificationDates).length} job modification dates`);
      }
      
      return state;
    } else {
      console.log(`Sync state file does not exist: ${SYNC_STATE_FILE}, using default state`);
    }
  } catch (error) {
    logger.error('Error loading sync state file:', error);
    console.error('Error loading sync state file:', error);
  }
  
  // Return default state if file doesn't exist or is corrupted
  console.log('Returning default sync state');
  return { ...DEFAULT_SYNC_STATE };
}

/**
 * Save sync state to disk or memory
 * @param {Object} state - State to save
 * @returns {boolean} Success status
 */
function saveSyncState(state) {
  // Validate state before saving
  if (!state || typeof state !== 'object') {
    console.error('Invalid state object provided to saveSyncState');
    return false;
  }
  
  // Log what we're saving
  console.log(`Saving sync state with ${Object.keys(state.jobModificationDates || {}).length} job modification dates`);
  
  // Create a deep copy of the state to avoid reference issues
  const stateCopy = JSON.parse(JSON.stringify(state));
  
  // Ensure jobModificationDates exists
  if (!stateCopy.jobModificationDates) {
    stateCopy.jobModificationDates = {};
    console.log('Initialized missing jobModificationDates property');
  }
  
  // Check if state has expected properties
  const expectedProps = ['lastSync', 'syncCount', 'lastError', 'jobModificationDates'];
  expectedProps.forEach(prop => {
    if (!(prop in stateCopy)) {
      console.log(`WARNING: Missing expected property '${prop}' in sync state`);
    }
  });

  // If in serverless environment, store in memory and return
  if (isServerless) {
    inMemorySyncState = stateCopy;
    console.log(`Saved sync state in memory (serverless mode)`);
    return true;
  }
  
  // In non-serverless environment, save to file
  try {
    // Convert to JSON string with formatting for readability
    const jsonData = JSON.stringify(stateCopy, null, 2);
    
    // Validate JSON before writing to file
    try {
      JSON.parse(jsonData); // This will throw if the JSON is invalid
    } catch (jsonError) {
      console.error('Generated invalid JSON data:', jsonError);
      return false;
    }
    
    // Write to file
    fs.writeFileSync(SYNC_STATE_FILE, jsonData, 'utf8');
    
    // Verify file was written successfully
    if (fs.existsSync(SYNC_STATE_FILE)) {
      const writtenData = fs.readFileSync(SYNC_STATE_FILE, 'utf8');
      console.log(`Successfully wrote ${writtenData.length} bytes to sync state file`);
      
      // Verify the written data can be parsed as JSON
      try {
        const parsedData = JSON.parse(writtenData);
        console.log(`File verification: contains ${Object.keys(parsedData.jobModificationDates || {}).length} job modification dates`);
      } catch (verifyError) {
        console.error('Written file contains invalid JSON:', verifyError);
      }
    }
    
    return true;
  } catch (error) {
    logger.error('Error saving sync state file:', error);
    console.error('Error saving sync state file:', error);
    return false;
  }
}

/**
 * Get the last successful sync time
 * @returns {string|null} ISO timestamp of last successful sync, or null if never synced
 */
function getLastSyncTime() {
  const state = loadSyncState();
  return state.lastSync;
}

/**
 * Update the sync state after a successful sync
 * @returns {Object} Updated sync state
 */
function updateLastSyncTime() {
  const state = loadSyncState();
  const now = new Date();
  
  // Make sure we're using the current time in UTC format
  const nowISO = now.toISOString();
  
  // Log the previous and new sync times
  if (state.lastSync) {
    const prevSyncDate = new Date(state.lastSync);
    const diffMinutes = Math.floor((now - prevSyncDate) / (1000 * 60));
    console.log(`Updating sync timestamp from ${state.lastSync} to ${nowISO} (${diffMinutes} minutes difference)`);
  } else {
    console.log(`Setting initial sync timestamp to ${nowISO}`);
  }
  
  // Explicitly ensure we're not overwriting jobModificationDates
  // Make a defensive copy to avoid reference issues
  const jobModificationDates = { ...(state.jobModificationDates || {}) };
  console.log(`Preserving ${Object.keys(jobModificationDates).length} job modification dates during lastSync update`);
  
  // Create a new state object instead of modifying the existing one
  const updatedState = {
    ...state,
    lastSync: nowISO,
    syncCount: (state.syncCount || 0) + 1,
    lastError: null,
    jobModificationDates: jobModificationDates
  };
  
  // Log before saving to verify the state contains the expected data
  console.log(`Updated state contains ${Object.keys(updatedState.jobModificationDates).length} job modification dates`);
  
  saveSyncState(updatedState);
  return updatedState;
}

/**
 * Record an error in the sync state
 * @param {Error} error - Error object
 * @returns {Object} Updated sync state
 */
function recordSyncError(error) {
  const errorId = `error-${Date.now()}`;
  console.error(`[${errorId}] Recording sync error:`, error);
  
  // Log error with all available details
  logger.error('Sync error details', {
    errorId,
    message: error.message,
    name: error.name,
    stack: error.stack,
    code: error.code,
    details: error.details || 'No additional details'
  });
  
  try {
    const state = loadSyncState();
    state.lastError = {
      message: error.message,
      timestamp: new Date().toISOString(),
      stack: error.stack,
      errorId: errorId
    };
    
    saveSyncState(state);
    return state;
  } catch (stateError) {
    console.error('Error while recording sync error:', stateError);
    logger.error('Failed to record sync error in state', {
      errorId,
      originalError: error.message,
      stateError: stateError.message
    });
    return null;
  }
}

/**
 * Reset the sync state to default values
 * @returns {Object} Reset sync state
 */
function resetSyncState() {
  const defaultState = { ...DEFAULT_SYNC_STATE };
  // Explicitly ensure jobModificationDates is initialized as an empty object
  defaultState.jobModificationDates = {};
  console.log('Reset sync state with empty job modification dates object');
  
  saveSyncState(defaultState);
  return defaultState;
}

/**
 * Check if a job needs to be updated based on its modification date
 * @param {string} jobId - Mysolution job ID
 * @param {string} modificationDate - ISO date string of job modification
 * @returns {boolean} Whether the job needs to be updated
 */
function jobNeedsUpdate(jobId, modificationDate) {
  if (!jobId || !modificationDate) {
    // If either parameter is missing, assume update is needed
    console.log(`Job needs update check called with invalid parameters: jobId=${jobId}, modDate=${modificationDate}`);
    return true;
  }
  
  try {
    // Convert both dates to comparable formats (milliseconds since epoch)
    const newModDate = new Date(modificationDate).getTime();
    if (isNaN(newModDate)) {
      console.log(`Invalid modification date provided: ${modificationDate}`);
      return true;
    }
    
    // Load current state
    const state = loadSyncState();
    
    // Check if we have a record for this job
    if (state.jobModificationDates && state.jobModificationDates[jobId]) {
      const oldModDate = new Date(state.jobModificationDates[jobId]).getTime();
      
      if (isNaN(oldModDate)) {
        console.log(`Invalid stored modification date for job ${jobId}: ${state.jobModificationDates[jobId]}`);
        return true;
      }
      
      // Compare dates
      const needsUpdate = newModDate > oldModDate;
      
      // Log the decision with date information
      if (needsUpdate) {
        console.log(`Job ${jobId} needs update - old: ${new Date(oldModDate).toISOString()}, new: ${new Date(newModDate).toISOString()}`);
      } else {
        console.log(`Job ${jobId} does NOT need update - same modification date`);
      }
      
      return needsUpdate;
    } else {
      // No record found, so update is needed
      console.log(`Job ${jobId} needs update - no previous record found`);
      return true;
    }
  } catch (error) {
    // On any error, assume update is needed
    console.error(`Error checking if job ${jobId} needs update:`, error);
    return true;
  }
}

/**
 * Update the modification date for a job
 * @param {string} jobId - Mysolution job ID
 * @param {string} modificationDate - ISO date string of job modification
 * @returns {boolean} Success status
 */
function updateJobModificationDate(jobId, modificationDate) {
  if (!jobId || !modificationDate) {
    console.error(`Invalid parameters for updateJobModificationDate: jobId=${jobId}, modDate=${modificationDate}`);
    return false;
  }
  
  try {
    // Validate date
    const modDate = new Date(modificationDate);
    if (isNaN(modDate.getTime())) {
      console.error(`Invalid modification date: ${modificationDate}`);
      return false;
    }
    
    // Load state
    const state = loadSyncState();
    
    // Ensure jobModificationDates exists
    if (!state.jobModificationDates) {
      state.jobModificationDates = {};
    }
    
    // Record previous value for logging
    const prevDate = state.jobModificationDates[jobId];
    
    // Update modification date
    state.jobModificationDates[jobId] = modificationDate;
    
    // Log the update
    if (prevDate) {
      console.log(`Updated modification date for job ${jobId}: ${prevDate} -> ${modificationDate}`);
    } else {
      console.log(`Set initial modification date for job ${jobId}: ${modificationDate}`);
    }
    
    // Save state
    return saveSyncState(state);
  } catch (error) {
    console.error(`Error updating modification date for job ${jobId}:`, error);
    return false;
  }
}

/**
 * Get all stored job modification dates
 * @returns {Object} Map of job IDs to modification dates
 */
function getJobModificationDates() {
  const state = loadSyncState();
  return state.jobModificationDates || {};
}

/**
 * Store multiple job modification dates at once
 * @param {Object} jobDates - Map of job IDs to modification dates
 * @returns {boolean} Success status
 */
function storeMultipleJobDates(jobDates) {
  if (!jobDates || typeof jobDates !== 'object') {
    console.error('Invalid jobDates parameter provided to storeMultipleJobDates');
    return false;
  }
  
  try {
    // Load state
    const state = loadSyncState();
    
    // Ensure jobModificationDates exists
    if (!state.jobModificationDates) {
      state.jobModificationDates = {};
    }
    
    // Count how many new and updated entries we'll have
    let newCount = 0;
    let updatedCount = 0;
    
    // Update all provided job dates
    Object.entries(jobDates).forEach(([jobId, modDate]) => {
      if (state.jobModificationDates[jobId]) {
        updatedCount++;
      } else {
        newCount++;
      }
      state.jobModificationDates[jobId] = modDate;
    });
    
    console.log(`Stored ${Object.keys(jobDates).length} job modification dates (${newCount} new, ${updatedCount} updated)`);
    
    // Save state
    return saveSyncState(state);
  } catch (error) {
    console.error('Error storing multiple job dates:', error);
    return false;
  }
}

/**
 * Get the current sync state object
 * @returns {Object} Current sync state
 */
function getSyncState() {
  return loadSyncState();
}

// Export all functions
export default {
  getLastSyncTime,
  updateLastSyncTime,
  recordSyncError,
  resetSyncState,
  jobNeedsUpdate,
  updateJobModificationDate,
  getJobModificationDates,
  storeMultipleJobDates,
  loadSyncState,
  saveSyncState,
  getSyncState
}; 