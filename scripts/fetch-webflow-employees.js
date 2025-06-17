#!/usr/bin/env node

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import webflowAPI from '../src/api/webflow.js';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

/**
 * Fetch all employees from Webflow CMS and save them to a JSON file
 */
async function fetchWebflowEmployees() {
  try {
    console.log('\n===== FETCHING WEBFLOW EMPLOYEES =====\n');
    
    console.log('📡 Connecting to Webflow API...');
    console.log('🔍 Locating employees collection...');
    
    // Get employees collection info
    const employeesCollectionId = await webflowAPI.getEmployeesCollection();
    
    if (!employeesCollectionId) {
      console.error('❌ Could not find employees collection in Webflow');
      process.exit(1);
    }
    
    console.log(`✅ Found employees collection: ${employeesCollectionId}`);
    console.log('📥 Fetching all employees...');
    
    // Fetch all employees
    const employees = await webflowAPI.getAllEmployees();
    
    if (!employees || employees.length === 0) {
      console.warn('⚠️ No employees found in Webflow collection');
      return;
    }
    
    console.log(`✅ Successfully fetched ${employees.length} employees from Webflow`);
    
    // Save to debug-webflow-employees.json
    const employeesFilePath = path.join(rootDir, 'debug-webflow-employees.json');
    
    console.log('💾 Saving employees data to debug-webflow-employees.json...');
    fs.writeFileSync(employeesFilePath, JSON.stringify(employees, null, 2));
    
    console.log('✅ Employees data saved successfully');
    console.log(`📄 File size: ${fs.statSync(employeesFilePath).size} bytes`);
    console.log('📝 Complete employees list saved to debug-webflow-employees.json');
    
    // Show employee summary
    console.log(`\n📊 Employees Summary:`);
    console.log(`   Total employees: ${employees.length}`);
    
    console.log('\n👥 Employee List:');
    employees.forEach((employee, index) => {
      const name = employee.name || (employee.fieldData ? employee.fieldData.name : 'unnamed');
      const id = employee._id || employee.id || 'no-id';
      console.log(`   ${index + 1}. ${name} (${id})`);
    });
    
    console.log('\n🎯 Test employee lookup with an example...');
    if (employees.length > 0) {
      const testEmployee = employees[0];
      const testName = testEmployee.name || (testEmployee.fieldData ? testEmployee.fieldData.name : null);
      
      if (testName) {
        console.log(`🔍 Testing lookup for: "${testName}"`);
        const foundEmployee = await webflowAPI.findEmployeeByName(testName);
        
        if (foundEmployee) {
          console.log(`✅ Lookup successful: Found ${foundEmployee.name} (${foundEmployee.id})`);
        } else {
          console.log('❌ Lookup failed: Could not find employee');
        }
      }
    }
    
  } catch (error) {
    console.error('\n❌ Error fetching Webflow employees:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run the script
fetchWebflowEmployees(); 