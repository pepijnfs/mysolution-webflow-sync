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
 * Fetch all sectors from Webflow CMS and save them to a JSON file
 */
async function fetchWebflowSectors() {
  try {
    console.log('\n===== FETCHING WEBFLOW SECTORS =====\n');
    
    console.log('📡 Connecting to Webflow API...');
    console.log('🔍 Locating sectors collection...');
    
    // Get sectors collection info
    const sectorsCollectionId = await webflowAPI.getSectorsCollection();
    
    if (!sectorsCollectionId) {
      console.error('❌ Could not find sectors collection in Webflow');
      process.exit(1);
    }
    
    console.log(`✅ Found sectors collection: ${sectorsCollectionId}`);
    console.log('📥 Fetching all sectors...');
    
    // Fetch all sectors
    const sectors = await webflowAPI.getAllSectors();
    
    if (!sectors || sectors.length === 0) {
      console.warn('⚠️ No sectors found in Webflow collection');
      return;
    }
    
    console.log(`✅ Successfully fetched ${sectors.length} sectors from Webflow`);
    
    // Save to debug-webflow-sectors.json
    const sectorsFilePath = path.join(rootDir, 'debug-webflow-sectors.json');
    
    console.log('💾 Saving sectors data to debug-webflow-sectors.json...');
    fs.writeFileSync(sectorsFilePath, JSON.stringify(sectors, null, 2));
    
    console.log('✅ Sectors data saved successfully');
    console.log(`📄 File size: ${fs.statSync(sectorsFilePath).size} bytes`);
    console.log('📝 Complete sectors list saved to debug-webflow-sectors.json');
    
    // Show sector summary
    console.log(`\n📊 Sectors Summary:`);
    console.log(`   Total sectors: ${sectors.length}`);
    
    if (sectors.length > 0) {
      console.log('   Sample sectors:');
      sectors.slice(0, 5).forEach((sector, index) => {
        const name = sector.name || (sector.fieldData && sector.fieldData.name) || 'Unnamed';
        const id = sector._id || sector.id || 'No ID';
        console.log(`   ${index + 1}. ${name} (${id})`);
      });
      
      if (sectors.length > 5) {
        console.log(`   ... and ${sectors.length - 5} more sectors`);
      }
    }
    
  } catch (error) {
    console.error('\n❌ Error fetching Webflow sectors:', error.message);
    logger.error('Error in fetch-webflow-sectors script:', error);
    
    if (error.message.includes('authentication') || error.message.includes('401')) {
      console.log('\n💡 Tip: Check your Webflow API credentials in the .env file.');
    } else if (error.message.includes('collection')) {
      console.log('\n💡 Tip: Check that the sectors collection exists in your Webflow CMS.');
    } else if (error.message.includes('network') || error.message.includes('timeout')) {
      console.log('\n💡 Tip: Check your network connection and Webflow API availability.');
    }
    
    process.exit(1);
  }
}

// Show usage information
console.log('\n📋 Usage: node scripts/fetch-webflow-sectors.js');
console.log('🎯 This script fetches all sectors from your Webflow CMS');
console.log('💾 Output will be saved to debug-webflow-sectors.json\n');

// Run the script
fetchWebflowSectors().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
}); 