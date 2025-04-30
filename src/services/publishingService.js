import webflowAPI from '../api/webflow.js';
import { logger } from '../utils/logger.js';
import config from '../utils/config.js';

/**
 * Service for handling Webflow content publishing operations
 */
class PublishingService {
  constructor() {
    // Track publication operations to prevent too frequent publishing
    this.lastPublishTime = 0;
    this.minPublishInterval = 10000; // 10 seconds minimum between publish operations
    this.pendingPublish = false;
    this.autoPublish = config.webflow.autoPublish;
  }

  /**
   * Check if automatic publishing is enabled
   * @returns {boolean} True if automatic publishing is enabled
   */
  isAutoPublishEnabled() {
    return this.autoPublish;
  }

  /**
   * Enable or disable automatic publishing
   * @param {boolean} enabled - Whether automatic publishing should be enabled
   */
  setAutoPublish(enabled) {
    this.autoPublish = !!enabled;
    logger.info(`Automatic publishing ${this.autoPublish ? 'enabled' : 'disabled'}`);
  }

  /**
   * Publish changes to the Webflow site if autoPublish is enabled
   * Respects the minimum time interval between publish operations
   * @param {string} reason - Reason for publishing (for logging)
   * @returns {Promise<object|null>} Publish result or null if not published
   */
  async publishIfEnabled(reason) {
    console.log(`\n==== 🔄 AUTO-PUBLISH CHECK (${reason}) ====`);
    console.log(`🔍 Auto-publish enabled: ${this.autoPublish ? '✅ YES' : '❌ NO'}`);
    
    if (!this.autoPublish) {
      console.log(`❌ Auto-publish is disabled, skipping publication (reason: ${reason})`);
      logger.debug('Auto-publish is disabled, skipping publication', { reason });
      return null;
    }

    console.log(`✅ Auto-publish is enabled, proceeding with publish (reason: ${reason})`);
    return this.publishChanges(reason);
  }

  /**
   * Force publish changes to the Webflow site regardless of autoPublish setting
   * @param {string} reason - Reason for publishing (for logging)
   * @returns {Promise<object>} Publish result
   */
  async forcePublish(reason) {
    return this.publishChanges(reason, true);
  }

  /**
   * Internal method to publish changes with throttling
   * @param {string} reason - Reason for publishing
   * @param {boolean} force - Whether to bypass autoPublish setting
   * @returns {Promise<object|null>} Publish result or null if not published
   * @private
   */
  async publishChanges(reason, force = false) {
    console.log(`\n==== 📡 PUBLISH CHANGES (${reason}) ====`);
    console.log(`🔍 Force publish: ${force ? '✅ YES' : '❌ NO'}, Auto-publish enabled: ${this.autoPublish ? '✅ YES' : '❌ NO'}`);
    
    // Skip if not forced and autoPublish is disabled
    if (!force && !this.autoPublish) {
      console.log('❌ Skipping publish - not forced and auto-publish is disabled');
      return null;
    }

    const now = Date.now();
    const timeSinceLastPublish = now - this.lastPublishTime;
    const timeRemaining = this.minPublishInterval - timeSinceLastPublish;
    console.log(`⏱️ Time since last publish: ${timeSinceLastPublish}ms (minimum interval: ${this.minPublishInterval}ms)`);
    
    if (timeRemaining > 0) {
      console.log(`⏳ Wait time before next publish: ${timeRemaining}ms`);
    } else {
      console.log('✅ Minimum waiting period has passed, can publish now');
    }

    // Check if we need to throttle publishing
    if (timeSinceLastPublish < this.minPublishInterval) {
      console.log(`⚠️ THROTTLING: Publishing too frequent! Must wait at least ${this.minPublishInterval}ms between publishes.`);
      console.log(`⏱️ Last publish was ${timeSinceLastPublish}ms ago, need to wait ${timeRemaining}ms more.`);
      
      logger.debug('Throttling publish request, too soon after last publish', {
        reason,
        timeSinceLastPublish,
        minInterval: this.minPublishInterval
      });

      // If we're already planning to publish soon, just return
      if (this.pendingPublish) {
        console.log('ℹ️ A publish is already scheduled for later, this request will be combined with it.');
        return null;
      }

      // Schedule a publish after the minimum interval
      this.pendingPublish = true;
      const waitTime = this.minPublishInterval - timeSinceLastPublish;
      
      console.log(`🕒 Scheduling publish in ${waitTime}ms (reason: ${reason})`);
      const scheduledTime = new Date(now + waitTime).toLocaleTimeString();
      console.log(`📅 Publish will happen at: ${scheduledTime}`);
      
      logger.debug(`Scheduling publish in ${waitTime}ms`, { reason });
      
      return new Promise((resolve, reject) => {
        setTimeout(async () => {
          try {
            console.log(`\n⏰ EXECUTING DELAYED PUBLISH NOW (${reason})`);
            this.pendingPublish = false;
            const result = await this._doPublish(reason);
            resolve(result);
          } catch (error) {
            console.error(`❌ ERROR in delayed publish: ${error.message}`);
            this.pendingPublish = false;
            reject(error);
          }
        }, waitTime);
      });
    }

    console.log(`✅ Publishing immediately (reason: ${reason})`);
    // We can publish immediately
    return this._doPublish(reason);
  }

  /**
   * Execute the actual publish operation
   * @param {string} reason - Reason for publishing
   * @returns {Promise<object>} Publish result
   * @private
   */
  async _doPublish(reason) {
    try {
      console.log(`\n==== 🚀 EXECUTING PUBLISH OPERATION (${reason}) ====`);
      logger.info(`Publishing Webflow site changes: ${reason}`);
      
      // Update the last publish time before making the request
      this.lastPublishTime = Date.now();
      
      console.log('📡 Sending publish request to Webflow API...');
      const result = await webflowAPI.publishSite();
      
      // Ensure publishedOn exists in the result
      const publishedOn = result?.publishedOn || new Date().toISOString();
      const publishTime = new Date(publishedOn).toLocaleTimeString();
      
      console.log(`✅ PUBLISH SUCCESSFUL! Published at: ${publishTime}`);
      console.log('ℹ️ All job changes are now live on the website.');
      logger.info('Successfully published Webflow site changes', {
        reason,
        publishedOn
      });
      
      // Emit publish completed event for real-time updates
      if (global.eventBus) {
        global.eventBus.emit('sync-completed');
      }
      
      // Return with a guaranteed publishedOn property
      return {
        ...result,
        publishedOn
      };
    } catch (error) {
      console.error(`\n==== ❌ PUBLISH OPERATION FAILED (${reason}) ====`);
      console.error(`❌ Error: ${error.message}`);
      console.error('ℹ️ Your content changes have been saved to Webflow but not published to the live site.');
      console.error('ℹ️ You can try publishing again manually through the dashboard or wait for the next automatic publish attempt.');
      
      logger.error('Failed to publish Webflow site changes', {
        reason,
        error: error.message,
        stack: error.stack
      });
      
      throw new Error(`Failed to publish Webflow site: ${error.message}`);
    }
  }
}

// Export singleton instance
const publishingService = new PublishingService();
export default publishingService; 