import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger.js';

const execAsync = promisify(exec);

// Cache deployment info at startup
let deploymentInfo = null;
let deploymentInfoPromise = null;

/**
 * Get deployment information from git or fallback methods
 * This is called once at startup and cached
 */
async function initializeDeploymentInfo() {
  if (deploymentInfoPromise) {
    return deploymentInfoPromise;
  }

  deploymentInfoPromise = (async () => {
    try {
      console.log('Initializing deployment info...');
      
      // Try to get git commit info
      try {
        const { stdout } = await execAsync('git log -1 --format="%H|%ci|%ct"');
        const [commitHash, commitTime, unixTimestamp] = stdout.trim().split('|');
        
        const deploymentTime = new Date(parseInt(unixTimestamp) * 1000);
        
        deploymentInfo = {
          deploymentTime: deploymentTime.toISOString(),
          commitHash: commitHash.substring(0, 8),
          commitHashFull: commitHash,
          source: 'git_commit',
          unixTimestamp: parseInt(unixTimestamp),
          initialized: new Date().toISOString()
        };
        
        console.log(`Deployment info from git: commit ${deploymentInfo.commitHash} at ${deploymentInfo.deploymentTime}`);
        logger.info('Deployment info initialized from git commit', deploymentInfo);
        
      } catch (gitError) {
        console.warn('Could not get git commit info:', gitError.message);
        
        // Fallback 1: Try to read from package.json version or build time
        try {
          const packageJson = await import('../../package.json');
          const fallbackTime = new Date(Date.now() - process.uptime() * 1000);
          
          deploymentInfo = {
            deploymentTime: fallbackTime.toISOString(),
            version: packageJson.default.version,
            source: 'package_json_fallback',
            unixTimestamp: Math.floor(fallbackTime.getTime() / 1000),
            initialized: new Date().toISOString()
          };
          
          console.log(`Deployment info from package.json fallback: ${deploymentInfo.deploymentTime}`);
          
        } catch (packageError) {
          console.warn('Could not read package.json:', packageError.message);
          
          // Fallback 2: Use process start time
          const processStartTime = new Date(Date.now() - process.uptime() * 1000);
          
          deploymentInfo = {
            deploymentTime: processStartTime.toISOString(),
            source: 'process_uptime',
            unixTimestamp: Math.floor(processStartTime.getTime() / 1000),
            initialized: new Date().toISOString()
          };
          
          console.log(`Deployment info from process uptime fallback: ${deploymentInfo.deploymentTime}`);
        }
      }
      
      return deploymentInfo;
      
    } catch (error) {
      console.error('Error initializing deployment info:', error);
      logger.error('Failed to initialize deployment info', error);
      
      // Last resort fallback
      const emergencyTime = new Date(Date.now() - 60000); // 1 minute ago
      deploymentInfo = {
        deploymentTime: emergencyTime.toISOString(),
        source: 'emergency_fallback',
        unixTimestamp: Math.floor(emergencyTime.getTime() / 1000),
        initialized: new Date().toISOString(),
        error: error.message
      };
      
      return deploymentInfo;
    }
  })();

  return deploymentInfoPromise;
}

/**
 * Get cached deployment information
 * If not initialized, will initialize first
 */
async function getDeploymentInfo() {
  if (!deploymentInfo) {
    await initializeDeploymentInfo();
  }
  
  return {
    ...deploymentInfo,
    currentTime: new Date().toISOString(),
    uptimeSeconds: Math.floor((Date.now() / 1000) - deploymentInfo.unixTimestamp)
  };
}

/**
 * Get deployment info synchronously (returns null if not yet initialized)
 */
function getDeploymentInfoSync() {
  return deploymentInfo ? {
    ...deploymentInfo,
    currentTime: new Date().toISOString(),
    uptimeSeconds: deploymentInfo.unixTimestamp ? Math.floor((Date.now() / 1000) - deploymentInfo.unixTimestamp) : null
  } : null;
}

/**
 * Force refresh deployment info (useful for development)
 */
async function refreshDeploymentInfo() {
  deploymentInfo = null;
  deploymentInfoPromise = null;
  return await initializeDeploymentInfo();
}

export {
  initializeDeploymentInfo,
  getDeploymentInfo,
  getDeploymentInfoSync,
  refreshDeploymentInfo
}; 