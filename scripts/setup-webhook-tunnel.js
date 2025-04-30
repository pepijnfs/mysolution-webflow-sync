#!/usr/bin/env node

/**
 * Webhook Tunnel Setup Script
 * 
 * This script creates an ngrok tunnel to expose your local server to the internet,
 * allowing Webflow forms to send submissions to your API endpoint.
 * It also helps to update the formHandler.js script with the correct ngrok URL.
 */

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

// Constants
const DEFAULT_PORT = 3000;
const API_ENDPOINT_PATH = '/api/candidates/apply';
const FORM_HANDLER_PATH = path.join('public', 'formHandler.js');

// Helper for __dirname in ES modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Check if ngrok is installed, install if not
 */
async function checkNgrok() {
  try {
    console.log('Checking if ngrok is installed...');
    execSync('ngrok --version', { stdio: 'ignore' });
    console.log('✅ ngrok is installed');
    return true;
  } catch (error) {
    console.log('⚠️ ngrok is not installed. Installing now...');
    
    try {
      // Check npm version
      execSync('npm --version', { stdio: 'ignore' });
      console.log('Installing ngrok via npm...');
      execSync('npm install -g ngrok', { stdio: 'inherit' });
      console.log('✅ ngrok installed successfully');
      return true;
    } catch (npmError) {
      console.error('❌ Failed to install ngrok. Please install manually:');
      console.error('   npm install -g ngrok');
      console.error('   or visit https://ngrok.com/download');
      return false;
    }
  }
}

/**
 * Check if the application is running on the specified port
 */
async function checkAppRunning(port) {
  try {
    // Simple check if something is listening on the port
    const netstat = process.platform === 'win32' 
      ? `netstat -ano | findstr :${port}`
      : `lsof -i :${port}`;
    
    execSync(netstat, { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Update the formHandler.js file with the correct ngrok URL
 */
function updateFormHandler(tunnelUrl) {
  const formHandlerPath = path.join(projectRoot, FORM_HANDLER_PATH);
  
  if (!fs.existsSync(formHandlerPath)) {
    console.log(`⚠️ Could not find formHandler.js at ${formHandlerPath}`);
    console.log('You will need to manually update the API endpoint URL in your formHandler.js file.');
    return false;
  }
  
  try {
    console.log('Updating formHandler.js with ngrok URL...');
    
    // Read the current content
    let content = fs.readFileSync(formHandlerPath, 'utf8');
    
    // Create a script tag that sets the global variable
    const updatedApiUrl = `${tunnelUrl}${API_ENDPOINT_PATH}`;
    const scriptToInject = `
// This script was added by setup-webhook-tunnel.js
// It sets the API endpoint for local development
window._mysolutionApiEndpoint = "${updatedApiUrl}";
`;

    // Check if the script is already injected
    if (content.includes('window._mysolutionApiEndpoint')) {
      // Update the existing script
      const endpointRegex = /(window\._mysolutionApiEndpoint\s*=\s*["']).*?(["'])/;
      const newContent = content.replace(endpointRegex, `$1${updatedApiUrl}$2`);
      fs.writeFileSync(formHandlerPath, newContent, 'utf8');
    } else {
      // Insert the script at the top of the file
      const newContent = scriptToInject + content;
      fs.writeFileSync(formHandlerPath, newContent, 'utf8');
    }
    
    console.log('✅ formHandler.js updated successfully with the ngrok URL');
    return true;
  } catch (error) {
    console.error('❌ Error updating formHandler.js:', error.message);
    console.log(`Please manually set the API endpoint URL to: ${tunnelUrl}${API_ENDPOINT_PATH}`);
    return false;
  }
}

/**
 * Start ngrok tunnel
 */
async function startNgrokTunnel(port) {
  console.log(`\nStarting ngrok tunnel to localhost:${port}...`);
  console.log('If this is your first time using ngrok, you may need to authenticate.');
  console.log('Visit https://dashboard.ngrok.com/get-started/your-authtoken to get your authtoken.');
  console.log('Then run: ngrok config add-authtoken YOUR_TOKEN\n');
  
  const ngrok = spawn('ngrok', ['http', port.toString(), '--log=stdout']);
  
  let tunnelUrl = null;
  let timeoutId = setTimeout(() => {
    console.log('\n⚠️ ngrok seems to be taking a long time to start.');
    console.log('This might be because:');
    console.log('1. You need to authenticate ngrok (see instructions above)');
    console.log('2. There\'s already an ngrok process running');
    console.log('3. Your firewall is blocking the connection');
    console.log('\nTry running "ngrok http 3000" directly in your terminal to troubleshoot.');
    console.log('Press Ctrl+C to exit this script and try again after resolving the issue.');
  }, 10000);
  
  ngrok.stdout.on('data', (data) => {
    const output = data.toString();
    
    // Extract the public URL from ngrok output
    const match = output.match(/(?:Forwarding|url=)(.*?https:\/\/[^\s]+)/);
    if (match && !tunnelUrl) {
      tunnelUrl = match[1].trim();
      clearTimeout(timeoutId);
      
      // Update the formHandler.js file with the ngrok URL
      updateFormHandler(tunnelUrl);
      
      // Display the webhook info
      displayWebhookInfo(tunnelUrl, port);
    }
    
    // Check for auth errors
    if (output.includes('authtoken') || output.includes('sign up')) {
      console.log('\n⚠️ ngrok authentication required!');
      console.log('Please run: ngrok config add-authtoken YOUR_TOKEN');
      console.log('Get your token at: https://dashboard.ngrok.com/get-started/your-authtoken');
    }
    
    // Print the output for debugging
    console.log(output);
  });
  
  ngrok.stderr.on('data', (data) => {
    console.error(`Error: ${data}`);
  });
  
  ngrok.on('close', (code) => {
    console.log(`ngrok process exited with code ${code}`);
  });
  
  // Keep the process running until user terminates
  process.on('SIGINT', () => {
    ngrok.kill();
    rl.close();
    console.log('\nTunnel closed. Your API endpoint is no longer accessible.');
    process.exit(0);
  });
}

/**
 * Display webhook information
 */
function displayWebhookInfo(tunnelUrl, port) {
  const apiEndpointUrl = `${tunnelUrl}${API_ENDPOINT_PATH}`;
  
  console.log('\n');
  console.log('🎉 Your ngrok tunnel is ready!');
  console.log('============================');
  console.log('\n');
  console.log('Form Handler Configuration:');
  console.log('----------------------------');
  console.log(`1. Your API endpoint: ${apiEndpointUrl}`);
  console.log(`2. The formHandler.js has been updated to use this URL.`);
  console.log('\n');
  console.log('Next Steps:');
  console.log('------------------------------------');
  console.log('1. Upload the updated formHandler.js to Webflow');
  console.log('2. Make sure your form has a hidden field with the Mysolution job ID:');
  console.log('   <input type="hidden" name="mysolution-id" value="YOUR_JOB_ID">');
  console.log('3. Ensure your form has the attribute: data-name="Vacature Form"');
  console.log('\n');
  console.log('To test the form submission:');
  console.log('1. Complete the form on your Webflow site');
  console.log('2. The form submission will be sent to your local server at:');
  console.log(`   http://localhost:${port}${API_ENDPOINT_PATH}`);
  console.log('\n');
  console.log('Press Ctrl+C to stop the tunnel when you\'re done testing.');
  console.log('\n');
}

/**
 * Check ngrok authentication status
 */
async function checkNgrokAuth() {
  console.log('Checking ngrok authentication status...');
  
  try {
    // Try to check if ngrok is authenticated by seeing if we can get the config
    execSync('ngrok config check', { stdio: 'pipe' });
    return true;
  } catch (error) {
    const errorOutput = error.stdout?.toString() || error.stderr?.toString() || '';
    
    if (errorOutput.includes('authtoken') || errorOutput.includes('not authenticated')) {
      console.log('\n⚠️ ngrok authentication required!');
      console.log('You need to authenticate with ngrok before using this script.');
      
      rl.question('\nWould you like to set up your authtoken now? (y/n): ', async (answer) => {
        if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
          rl.question('\nEnter your ngrok authtoken (from https://dashboard.ngrok.com/get-started/your-authtoken): ', async (token) => {
            if (!token || token.trim() === '') {
              console.log('No token provided. Please get your token and try again.');
              rl.close();
              process.exit(1);
            }
            
            try {
              console.log(`Setting up ngrok with your authtoken...`);
              execSync(`ngrok config add-authtoken ${token.trim()}`, { stdio: 'inherit' });
              console.log('✅ ngrok authenticated successfully!');
              
              // Continue with port selection
              promptForPort();
            } catch (configError) {
              console.error('❌ Failed to configure ngrok with your authtoken.');
              console.error(configError.message);
              rl.close();
              process.exit(1);
            }
          });
        } else {
          console.log('Please authenticate ngrok and try again.');
          console.log('Run: ngrok config add-authtoken YOUR_TOKEN');
          console.log('Get your token at: https://dashboard.ngrok.com/get-started/your-authtoken');
          rl.close();
          process.exit(1);
        }
      });
      
      return false;
    }
    
    // If there's another issue, just continue
    return true;
  }
}

/**
 * Prompt for port selection
 */
async function promptForPort() {
  rl.question(`Which port is your application running on? (default: ${DEFAULT_PORT}): `, async (answer) => {
    const port = answer ? parseInt(answer, 10) : DEFAULT_PORT;
    
    if (isNaN(port)) {
      console.error('❌ Invalid port number');
      rl.close();
      process.exit(1);
    }
    
    // Check if app is running on that port
    const isRunning = await checkAppRunning(port);
    if (!isRunning) {
      console.log(`⚠️ Warning: Nothing appears to be running on port ${port}`);
      rl.question('Do you want to continue anyway? (y/n): ', async (answer) => {
        if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
          console.log('Exiting. Please start your application first and try again.');
          rl.close();
          process.exit(0);
        } else {
          await startNgrokTunnel(port);
        }
      });
    } else {
      await startNgrokTunnel(port);
    }
  });
}

/**
 * Main function
 */
async function main() {
  console.log('=== Mysolution Job Sync - API Endpoint Tunnel Setup ===\n');
  
  // Check if ngrok is installed
  const ngrokInstalled = await checkNgrok();
  if (!ngrokInstalled) {
    rl.close();
    process.exit(1);
  }
  
  // Check authentication
  const isAuthenticated = await checkNgrokAuth();
  if (isAuthenticated) {
    // Continue with port selection
    promptForPort();
  }
  // If not authenticated, the checkNgrokAuth function handles the flow
}

// Start the script
main(); 