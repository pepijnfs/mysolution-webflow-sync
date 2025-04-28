import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

// Helper for __dirname in ES modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYNC_STATE_FILE = path.join(__dirname, '../../data/sync-state.json');

// Ensure the data directory exists
const dataDir = path.dirname(SYNC_STATE_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
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
 * Load sync state from disk
 * @returns {Object} Current sync state
 */
function loadSyncState() {
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
 * Save sync state to disk
 * @param {Object} state - State to save
 * @returns {boolean} Success status
 */
function saveSyncState(state) {
  try {
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
    console.error(`Error while recording sync error:`, stateError);
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
  console.log(`Reset sync state with empty job modification dates object`);
  
  saveSyncState(defaultState);
  return defaultState;
}

/**
 * Check if a job needs updating based on its modification date
 * @param {string} jobId - The job ID
 * @param {string} modificationDate - The job's current modification date
 * @returns {boolean} True if the job needs updating
 */
function jobNeedsUpdate(jobId, modificationDate) {
  if (!jobId || !modificationDate) {
    // If we don't have an ID or modification date, assume it needs updating
    console.log(`Job ${jobId || 'unknown'} missing ID or modification date, assuming it needs update`);
    return true;
  }
  
  const state = loadSyncState();
  
  // Log the current state of modification dates
  console.log(`Checking job ${jobId} against ${Object.keys(state.jobModificationDates || {}).length} stored modification dates`);
  
  // Debug log to help diagnose issues
  if (Object.keys(state.jobModificationDates || {}).length > 0) {
    console.log(`Available job IDs in state: ${Object.keys(state.jobModificationDates).join(', ')}`);
  }
  
  const previousDate = state.jobModificationDates[jobId];
  
  // If we don't have a previous date for this job, it needs updating
  if (!previousDate) {
    console.log(`No previous modification date found for job ${jobId}, needs update`);
    return true;
  }
  
  // Convert dates to clean Date objects for accurate comparison
  // Parse the dates to ensure proper timezone handling
  try {
    // Strip any trailing timezone info for consistent comparison
    const cleanPreviousDate = previousDate.replace(/\.\d{3}Z?$/, '').replace(/\+0000$/, '');
    const cleanCurrentDate = modificationDate.replace(/\.\d{3}Z?$/, '').replace(/\+0000$/, '');
    
    // Parse as dates
    const previousDateObj = new Date(cleanPreviousDate);
    const currentDateObj = new Date(cleanCurrentDate);
    
    // Check if either date is invalid
    if (isNaN(previousDateObj.getTime()) || isNaN(currentDateObj.getTime())) {
      console.log(`Invalid date format detected for job ${jobId}, defaulting to update required`);
      return true;
    }
    
    // Check if the dates are exactly equal (string comparison)
    if (cleanPreviousDate === cleanCurrentDate) {
      console.log(`Exact date string match for job ${jobId}, no update needed`);
      return false;
    }
    
    // Check if the current date is actually newer
    const needsUpdate = currentDateObj > previousDateObj;
    
    console.log(`Job ${jobId} modification date comparison:
    - Stored date: ${cleanPreviousDate} (${previousDateObj.toISOString()})
    - Current date: ${cleanCurrentDate} (${currentDateObj.toISOString()})
    - Time difference: ${currentDateObj - previousDateObj} ms
    - Needs update: ${needsUpdate ? 'YES' : 'NO'}`);
    
    return needsUpdate;
  } catch (error) {
    console.error(`Error comparing dates for job ${jobId}:`, error);
    // If there's an error in date comparison, be safe and update
    return true;
  }
}

/**
 * Update the stored modification date for a job
 * @param {string} jobId - The job ID
 * @param {string} modificationDate - The job's current modification date
 */
function updateJobModificationDate(jobId, modificationDate) {
  if (!jobId || !modificationDate) {
    console.log(`Cannot update job modification date: missing jobId or modificationDate`);
    return;
  }
  
  const state = loadSyncState();
  
  // Log the current state before updating
  const oldDate = state.jobModificationDates?.[jobId];
  if (oldDate) {
    console.log(`Updating job ${jobId} modification date from ${oldDate} to ${modificationDate}`);
  } else {
    console.log(`Setting initial modification date for job ${jobId} to ${modificationDate}`);
  }
  
  // Create a new jobModificationDates object with existing dates
  const updatedJobDates = { ...(state.jobModificationDates || {}) };
  updatedJobDates[jobId] = modificationDate;
  
  // Create a clean updated state object
  const updatedState = {
    ...state,
    jobModificationDates: updatedJobDates
  };
  
  // Verify the update was applied in the state object
  console.log(`Job modification dates count after update: ${Object.keys(updatedState.jobModificationDates).length}`);
  
  saveSyncState(updatedState);
}

/**
 * Get all stored job modification dates
 * @returns {Object} Object of job IDs mapped to modification dates
 */
function getJobModificationDates() {
  const state = loadSyncState();
  return state.jobModificationDates || {};
}

/**
 * Update multiple job modification dates at once
 * @param {Object} jobDates - Object mapping job IDs to modification dates
 */
function storeMultipleJobDates(jobDates) {
  if (!jobDates || Object.keys(jobDates).length === 0) {
    console.log('No job dates to store');
    return;
  }
  
  console.log(`Storing modification dates for ${Object.keys(jobDates).length} jobs at once`);
  const state = loadSyncState();
  
  // Create a new jobModificationDates object with existing dates
  const updatedJobDates = { ...(state.jobModificationDates || {}) };
  
  // Update job dates in the new object
  let updateCount = 0;
  Object.entries(jobDates).forEach(([jobId, modDate]) => {
    if (jobId && modDate) {
      updatedJobDates[jobId] = modDate;
      updateCount++;
    }
  });
  
  // Create a clean updated state object
  const updatedState = {
    ...state,
    jobModificationDates: updatedJobDates
  };
  
  console.log(`Updated modification dates for ${updateCount} jobs. Total job dates in state: ${Object.keys(updatedJobDates).length}`);
  saveSyncState(updatedState);
}

/**
 * Get the current sync state
 * @returns {Object} The current sync state
 */
function getSyncState() {
  const state = loadSyncState();
  return state;
}

export default {
  getLastSyncTime,
  updateLastSyncTime,
  recordSyncError,
  resetSyncState,
  loadSyncState,
  jobNeedsUpdate,
  updateJobModificationDate,
  getJobModificationDates,
  storeMultipleJobDates,
  getSyncState
}; 