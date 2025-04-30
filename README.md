# Mysolution Job Sync

A controlled bidirectional synchronization service between Mysolution ATS and Webflow.

## Overview

This project establishes a controlled bidirectional synchronization between Mysolution's Applicant Tracking System (ATS) and Webflow websites. The integration allows for:

1. Jobs created in Mysolution to be displayed on a Webflow website (one-way sync: Mysolution → Webflow)
2. Candidate applications submitted on Webflow to be sent to Mysolution (one-way sync: Webflow → Mysolution)
3. Updates to jobs in Mysolution to be synchronized to Webflow (one-way sync: Mysolution → Webflow)

Important: Jobs edited on Webflow will NOT sync back to Mysolution. Mysolution remains the single source of truth for job data.

## Current Status

### Completed
- ✅ Webflow API integration and testing
- ✅ Vacatures collection structure verification
- ✅ Job creation with Mysolution ID sync field
- ✅ Basic test framework implementation
- ✅ Environment configuration setup
- ✅ Mysolution API authentication
- ✅ Mysolution job retrieval endpoints
- ✅ Job data transformation utilities
- ✅ Job-Sector relational mapping (Mysolution → Webflow)
- ✅ Admin endpoints for accessing Webflow collections
- ✅ Sector name matching with fuzzy logic
- ✅ Job synchronization service (Mysolution → Webflow)
- ✅ Scheduled sync with daily full sync (7 AM) and incremental updates (every 15 minutes)
- ✅ Job archiving using Webflow's native archiving functionality
- ✅ Error handling and retry mechanisms
- ✅ Logging and monitoring setup
- ✅ Candidate form handling (Webflow → Mysolution)

### In Progress
- 🟡 Integration of both APIs

### Pending
- ⭕ Webhook implementation for real-time job updates from Mysolution
- ⭕ Production deployment configuration

## Architecture

The integration uses a Node.js backend service with the following components:

1. **API Connectors**
   - Mysolution API client (Completed)
     - Authentication ✅
     - Job retrieval ✅
     - Pagination support ✅
     - Single job fetching ✅
   - Webflow API client (Completed)
     - Collection management ✅
     - Job creation/update ✅
     - Content publishing ✅
     - Sector collection handling ✅
     - Relational data management ✅

2. **Data Models**
   - Mysolution Job Schema:
     ```javascript
     {
       id: 'Id',
       name: 'Name',
       title: 'msf__Title__c',
       jobNumber: 'msf__Job_Number__c',
       status: 'msf__Status__c',
       account: {
         id: 'msf__Account__c',
         name: 'msf__Account_Name__c'
       },
       educationLevel: 'msf__Education_Level__c',
       experienceLevel: 'msf__Experience_Level__c',
       hoursPerWeek: 'msf__Hours_Per_Week__c',
       salary: {
         from: 'msf__Salary_from__c',
         to: 'msf__Salary_to__c'
       },
       professionalField: 'msf__Professional_Field__c',
       showOnWebsite: 'msf__Show_On_Website__c',
       sector: 'BS_Sector__c' // Industry/sector field
     }
     ```
   
   - Webflow Job Schema:
     ```javascript
     {
       'name': 'Vacature Naam',
       'slug': 'Vacature Link',
       'mysolution-id': 'Mysolution ID',
       'job-excerpt-v1': 'Vacature Highlight',
       'job-long-description-page': 'Vacature Introductie',
       'job-requirements': 'Vacature Hoofdtekst',
       'job-responsibilities': 'Vacature Responsibilities',
       'job-description': 'Vacature Requirements',
       'vacature-type': ['Interim', 'Vast'],
       'vacature-locatie': 'Province options',
       'vacature-salaris': 'Salary ranges',
       'job-is-featured': 'Featured flag',
       'job-companies': 'Sector reference ID' // Relational field to sectors collection
     }
     ```
   - Candidate schema mapping (Pending)

3. **Relational Data Handling**
   - Sector mapping system (Completed)
     - Fuzzy name matching for sectors ✅
     - Multiple matching strategies ✅
     - Normalized text comparison ✅
     - Proper reference formatting for Webflow ✅

## Next Steps

1. **Job Sync Implementation (Priority: High)**
   - ✅ Create job field mapping utility
   - ✅ Implement one-way job transformation service (Mysolution → Webflow)
   - ✅ Add job-sector relationship handling
   - Add job update detection from Mysolution
   - Create sync status tracking
   - Add conflict resolution (prevent Webflow edits from syncing back)

2. **Candidate Flow (Priority: High)**
   - Design candidate data model
   - Implement form submission handler (Webflow → Mysolution)
   - Create candidate transformation service
   - Add application status tracking

3. **Error Handling (Priority: Medium)**
   - Add retry mechanisms
   - Implement error logging
   - Create alert system
   - Add transaction rollback

4. **Testing (Priority: High)**
   - ✅ Add job sync testing utilities
   - Create candidate flow tests
   - Add end-to-end sync tests
   - Implement stress tests

5. **Monitoring (Priority: Medium)**
   - ✅ Add detailed logging
   - Implement health checks
   - Create status dashboard
   - Add performance metrics

## Setup Instructions

1. Clone this repository
2. Install dependencies: `npm install`
3. Configure environment variables in `.env` (make sure to set `WEBFLOW_SECTORS_COLLECTION_ID`)
4. Run tests:
   ```bash
   # Test Webflow integration
   npm run test:webflow
   
   # Test Mysolution integration
   npm run test:mysolution
   
   # Test job change detection
   npm run test:job-change
   
   # Run all tests
   npm test
   ```
5. Run the service: `npm start`

## Testing

### Testing Framework: Mocha

This project uses **Mocha** as the testing framework along with **Chai** for assertions and **Sinon** for mocks and stubs. Do not use Jest for testing as it has compatibility issues with the ES module setup of this project.

### Test Structure

Tests are organized by functionality:
- `src/test/*.test.js` - Contains test files
- `src/test/setup.js` - Sets up test environment variables
- `src/test/run-job-change-detection-tests.js` - Custom test runner for job change detection tests

### Writing Tests

When writing tests for this project, follow these guidelines:

1. Use ES module syntax in test files:
   ```javascript
   import { expect } from 'chai';
   import sinon from 'sinon';
   ```

2. Use Sinon for creating stubs and mocks:
   ```javascript
   const myStub = sinon.stub(objectToStub, 'methodToStub').returns(value);
   ```

3. Make sure to restore stubs in the `afterEach` hook:
   ```javascript
   afterEach(() => {
     sinon.restore();
   });
   ```

4. To test ES modules that export default values, import them as:
   ```javascript
   import myModule from '../path/to/module.js';
   ```

### Running Tests

Run tests using the appropriate npm scripts:

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:webflow
npm run test:mysolution
npm run test:job-change
npm run test:logger
```

### ESM Compatibility

The project is configured as an ES module project (`"type": "module"` in package.json). Keep the following in mind:

1. Always include the `.js` extension in import statements
2. Use `import` instead of `require`
3. Use `fileURLToPath` and `dirname` for path operations:
   ```javascript
   import { fileURLToPath } from 'url';
   import { dirname } from 'path';
   
   const __filename = fileURLToPath(import.meta.url);
   const __dirname = dirname(__filename);
   ```

4. For testing with Mocha, always use the `--require esm` flag:
   ```bash
   mocha --require esm path/to/tests
   ```

## API Documentation

### Admin API
The Admin API provides endpoints for controlling and monitoring the system. These endpoints require authentication with an API key provided in the `x-api-key` header.

- **GET /api/admin/publishing/status** - Get current publishing configuration status
- **POST /api/admin/publishing/enable** - Enable automatic publishing
- **POST /api/admin/publishing/disable** - Disable automatic publishing
- **POST /api/admin/publishing/publish** - Force publish all site changes
- **GET /api/admin/webflow/site** - Get Webflow site information
- **GET /api/admin/webflow/collections** - Get all Webflow collections (useful for finding sector collection ID)
- **POST /api/admin/reset-sync** - Reset sync state and trigger a full sync

Example using cURL:
```bash
# Force publish changes
curl -X POST http://localhost:3000/api/admin/publishing/publish \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-admin-api-key" \
  -d '{"reason": "Manual publish from admin"}'

# Check publishing status
curl http://localhost:3000/api/admin/publishing/status \
  -H "x-api-key: your-admin-api-key"

# Get all Webflow collections (to find the sectors collection)
curl http://localhost:3000/api/admin/webflow/collections \
  -H "x-api-key: your-admin-api-key"
```

### Mysolution API
The Mysolution API allows interaction with their ATS system, providing endpoints for managing jobs and candidates.

Tested Endpoints:
- GET /services/oauth2/token (Authentication)
- GET /services/data/v53.0/query (Job retrieval)
- GET /services/data/v53.0/sobjects/msf__Job__c/:id (Single job)

### Mysolution Job Fetching: API Behavior and Implementation Notes

**API Endpoint Used:**  
`GET /services/apexrest/msf/api/job/Get`

**Behavior:**
- This endpoint returns only jobs that are considered "published" or "online" in Mysolution (Salesforce).
- The result set matches the "Alle Publicaties" view in the Mysolution portal, filtered for "Online" status.
- Other jobs (e.g., drafts, internal, or with other statuses) are not returned by this endpoint, regardless of any extra query parameters.
- The endpoint does not currently support filtering by status, team, or other custom fields via query parameters.

**Implementation in This Project:**
- The backend fetches jobs using this endpoint with no additional parameters.
- The code attempts to pass parameters like `showAllStatuses`, `includeInactive`, etc., but these are ignored by the backend.
- The result is always a list of jobs that are "published" (i.e., visible in the "Alle Publicaties" view with "Online" status).
- The code includes fallback logic for incremental sync (using modification dates), but this does not affect the set of jobs returned.

**Portal vs. API:**
- The Mysolution portal offers multiple views (e.g., "Alle Jobs", "Open vacatures", "Mijn team vacatures"), but the API only exposes jobs from the "Alle Publicaties" (Online) view.
- If you see more jobs in the portal than are returned by the API, those jobs are not "published" and are not available for sync.

**Recommendations:**
- If you need to sync jobs with other statuses or from other views, request the Mysolution team to expose a new endpoint or add filtering capabilities.
- For now, the sync will only include jobs that are published/online.

### Webflow API
The Webflow API allows for creating and managing content in Webflow CMS collections.

#### Sectors Integration

The application now supports mapping Mysolution job sectors to Webflow sector references:

1. **Sector lookup**: Using the sector name from Mysolution, the app finds the corresponding sector in the Webflow "Vacature Sectoren" collection
2. **Fuzzy matching**: If exact matches aren't found, the system uses fuzzy matching with multiple strategies:
   - Exact match
   - Normalized match (removing special characters)
   - Partial match (containing the name)
   - Word match (matching individual words)
3. **Proper references**: The job data is updated with the correct Webflow item ID format for the sector reference

Example of a properly formatted sector reference in a job:
```javascript
{
  // Other job fields...
  'job-companies': 'sector-collection-item-id' // ID of the sector from Webflow
}
```

#### Publishing Functionality
The integration includes a robust content publishing system for Webflow:

- **Automatic Publishing**: Configure auto-publishing to automatically publish changes to the live site after job creation or updates.
- **Manual Publishing**: When automatic publishing is disabled, changes are saved but not published until manually triggered.
- **Rate Limiting**: The publishing service implements throttling to prevent excessive publishing requests.
- **Batch Publishing**: When multiple jobs are created or updated in a batch, only one publish operation is executed at the end.
- **Error Handling**: Publishing failures are properly logged and don't block job creation/update operations.

Usage example:
```javascript
// Import the publishing service
import publishingService from './services/publishingService.js';

// Force publish changes regardless of auto-publish setting
await publishingService.forcePublish('Manual publish after important update');

// Check if auto-publish is enabled
const isEnabled = publishingService.isAutoPublishEnabled();

// Enable or disable auto-publishing programmatically
publishingService.setAutoPublish(true);
```

#### Webflow API Client Features
The Webflow API client includes the following features:

1. **Authentication**
   - API token-based authentication
   - Automatic token validation
   - Detailed error reporting for authentication issues

2. **Rate Limiting**
   - Automatic request queuing to respect Webflow's rate limits (60 requests per minute by default)
   - Adaptive rate limit handling based on response headers
   - Automatic delay and retry for rate-limited requests
   - Configurable rate limit settings

3. **Error Handling**
   - Comprehensive error classification (network, authentication, server)
   - Detailed error logging with context
   - Consistent error message formatting

4. **Resource Management**
   - Methods for working with sites, collections, and items
   - Specialized job-specific and candidate-specific methods
   - Support for pagination, filtering, and sorting

5. **Collection Management**
   - Collection structure validation
   - Verification of required fields for the Vacatures collection
   - Finding and filtering collection items by field values
   - Methods to find, create, update, and delete items by Mysolution ID
   - Advanced pagination handling with automatic retrieval of all items
   
6. **Relational Data**
   - Support for handling item references between collections
   - Methods to find sectors by name with fuzzy matching
   - Proper formatting of relational fields

## Configuration

### Environment Setup

The project uses a comprehensive configuration system with environment variables loaded through the `dotenv` package and validated by a config module.

To set up your environment:

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Or use the provided setup script:
   ```bash
   ./scripts/setup-env.sh --env development
   ```

3. Edit the `.env` file with your actual API credentials and settings

### Environment Variables

The following environment variables are available:

```
# Mysolution API Configuration
MYSOLUTION_API_URL=https://test.salesforce.com
MYSOLUTION_CLIENT_ID=your_mysolution_client_id
MYSOLUTION_CLIENT_SECRET=your_mysolution_client_secret
MYSOLUTION_API_TIMEOUT=30000
MYSOLUTION_API_RETRY_ATTEMPTS=3
MYSOLUTION_API_RETRY_DELAY=1000

# Webflow API Configuration
WEBFLOW_API_TOKEN=your_WEBFLOW_API_TOKEN
WEBFLOW_SITE_ID=your_webflow_site_id
WEBFLOW_JOBS_COLLECTION_ID=your_webflow_jobs_collection_id
WEBFLOW_CANDIDATES_COLLECTION_ID=your_webflow_candidates_collection_id
WEBFLOW_SECTORS_COLLECTION_ID=your_webflow_sectors_collection_id
WEBFLOW_API_TIMEOUT=30000
WEBFLOW_RATE_LIMIT=60
WEBFLOW_AUTO_PUBLISH=false

# Sync Settings
SYNC_INTERVAL=3600000  # 1 hour in milliseconds
SYNC_MAX_BATCH_SIZE=100
SYNC_CONCURRENCY=5
SYNC_RETRY_FAILED_AFTER=1800000  # 30 minutes

# Application Settings
PORT=3000
NODE_ENV=development
ADMIN_API_KEY=your_admin_api_key

# Logging Configuration
LOG_LEVEL=info  # debug, info, warn, error
LOG_FILE=logs/app.log
LOG_MAX_SIZE=10m
LOG_MAX_FILES=7
LOG_CONSOLE=true
LOG_DATE_PATTERN=YYYY-MM-DD
LOG_ZIPPED_ARCHIVE=true

# HTTP Request Logging
HTTP_REQUEST_LOGGING=true
HTTP_LOG_LEVEL=info
HTTP_LOG_FORMAT=combined
LOG_SKIP_ROUTES=/health,/static
REQUEST_ID_HEADER=x-request-id
GENERATE_REQUEST_ID=true
```

### Environment Types

The application supports three environment types:

1. **Development** - Local development with debug logging and console output
   ```bash
   ./scripts/setup-env.sh --env development
   ```

2. **Production** - Production settings with info-level logging and no console output
   ```bash
   ./scripts/setup-env.sh --env production
   ```

3. **Test** - Testing environment with faster sync intervals for testing
   ```bash
   ./scripts/setup-env.sh --env test
   ```

## Development

### Prerequisites
- Node.js v18+
- npm or yarn
- Access to Mysolution API
- Access to Webflow API

### Local Development
1. Clone the repository
2. Copy `.env.example` to `.env` and configure variables
3. Run `npm install`
4. Run tests to verify setup:
   ```bash
   npm run test:webflow
   npm run test:mysolution
   ```
5. Run `npm run dev` for development mode

### Logging System

The application uses a comprehensive logging system based on Winston with the following features:

#### Log Levels

The system supports the following log levels (from highest to lowest priority):
- `error` - Error events that might still allow the application to continue running
- `warn` - Warning events that indicate potential issues
- `info` - Informational messages highlighting application progress (default in production)
- `http` - HTTP request logs
- `verbose` - More detailed informational messages
- `debug` - Detailed debug information (default in development)
- `silly` - Extremely detailed tracing information

#### Configuration

Logging is configured through environment variables:

```
# Logging Configuration
LOG_LEVEL=info  # debug, info, warn, error
LOG_FILE=logs/app.log
LOG_MAX_SIZE=10m
LOG_MAX_FILES=7
LOG_CONSOLE=true
LOG_DATE_PATTERN=YYYY-MM-DD
LOG_ZIPPED_ARCHIVE=true

# HTTP Request Logging
HTTP_REQUEST_LOGGING=true
HTTP_LOG_LEVEL=info
HTTP_LOG_FORMAT=combined
LOG_SKIP_ROUTES=/health,/static
REQUEST_ID_HEADER=x-request-id
GENERATE_REQUEST_ID=true
```

#### Features

1. **Request ID Tracking** - Each HTTP request receives a unique ID that is included in all logs related to that request
2. **Log Rotation** - Log files are rotated daily and can be archived as zip files
3. **Different Formats** - Console logs are colorized and formatted for readability, while file logs use JSON format for parsing
4. **HTTP Request Logging** - Automatic logging of HTTP requests with response times
5. **Error Tracking** - Automatic capturing of error stack traces
6. **Child Loggers** - Support for creating child loggers with additional context
7. **Correlation IDs** - Support for tracking related operations (like sync processes) across logs

#### Testing the Logger

Run the logger tests to verify it's working correctly:

```bash
npm run test:logger
```

This will run the test suite that validates the logger's functionality including:
- Verifying all log levels (debug, info, warn, error)
- Testing structured metadata logging
- Testing request ID generation and tracking
- Validating middleware functionality
- Confirming log file creation

### Testing
```bash
# Run Webflow API tests
npm run test:webflow

# Run Mysolution API tests
npm run test:mysolution

# Run all tests
npm test
```

## License

[MIT](LICENSE)

## Incremental Job Synchronization

The application efficiently synchronizes jobs between Mysolution and Webflow using an incremental sync approach to handle large job volumes:

### How Incremental Sync Works

1. **Tracking Last Sync Time:**
   - The system maintains a state file (`data/sync-state.json`) that records when the last successful sync occurred
   - This timestamp is used as the reference point for detecting changes

2. **Change Detection Strategies:**
   - **API Filtering:** The system first attempts to use Mysolution API parameters to filter jobs by modification date
   - **Client-side Filtering:** If API filtering is unsuccessful, the system fetches all jobs and filters them using job modification dates

3. **Job Field Analysis:**
   - The system intelligently analyzes job objects to identify the most reliable modification date field
   - Multiple date fields are examined (LastModifiedDate, SystemModstamp, etc.) to ensure accurate change tracking

4. **Sync Optimization:**
   - Only jobs modified since the last sync are processed, reducing API calls and processing time
   - During incremental sync, job removal is skipped to improve performance
   - Full sync operations handle job deletions and can be triggered manually when needed

### Scheduled Sync Functionality

The system includes a comprehensive scheduling system:

1. **Dual Sync Strategy:**
   - **Daily Full Sync:** A complete reconciliation runs daily at 7 AM to ensure all data is properly synchronized
   - **Incremental Updates:** Lightweight incremental syncs run every 15 minutes throughout the day

2. **Smart Scheduling:**
   - The system automatically avoids duplicate syncs when scheduled times overlap
   - Scheduling can be enabled/disabled through the admin dashboard

3. **Monitoring:**
   - The dashboard displays next scheduled sync times for both full and incremental syncs
   - Detailed logs track all scheduled activities

### Admin API for Sync Management

The following API endpoints are available for managing job synchronization:

- **GET /api/admin/sync/state** - View current sync state including last sync time
- **POST /api/admin/sync/reset** - Reset sync state to force a full sync on next run
- **POST /api/admin/sync/test-incremental** - Test incremental sync with a specific timestamp
- **POST /api/admin/sync/run-incremental** - Manually trigger an incremental sync
- **GET /api/admin/sync/schedule/status** - Check the scheduling configuration
- **POST /api/admin/sync/schedule/enable** - Enable scheduled syncing
- **POST /api/admin/sync/schedule/disable** - Disable scheduled syncing

Example using cURL:
```bash
# Check current sync state
curl http://localhost:3000/api/admin/sync/state \
  -H "x-api-key: your-admin-api-key"

# Run incremental sync manually
curl -X POST http://localhost:3000/api/admin/sync/run-incremental \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-admin-api-key"

# Test with specific timestamp (24 hours ago)
curl -X POST http://localhost:3000/api/admin/sync/test-incremental \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-admin-api-key" \
  -d '{"timestamp": "2023-04-23T08:00:00.000Z"}'
```

### Troubleshooting Sync Issues

If jobs aren't syncing properly:

1. Check the application logs for warnings about missing modification date fields
2. Use the `/api/admin/sync/test-incremental` endpoint to test with various timestamps
3. Reset the sync state with `/api/admin/sync/reset` and run a full sync if needed
4. Examine the debug output to identify which job fields contain modification dates 

## Candidate Flow Implementation

The project now supports handling candidate applications from Webflow to Mysolution with the following features:

### Webflow Form Integration

- **Webhook Endpoint**: `/api/webhooks/webflow/form` for receiving form submissions
- **Direct API**: `/api/candidates/apply/:jobId` for applications submitted programmatically
- **File Uploads**: Support for CV/resume uploads with Multer
- **Hidden Job ID**: Automatically links applications to the correct job

### Candidate Data Transformation

- **Field Mapping**: Transforms Webflow form fields to Mysolution's required format
- **File Handling**: Converts uploaded files to base64 for Mysolution
- **Validation**: Ensures all required fields are present

### Mysolution API Integration

- **Apply Endpoint**: Uses Mysolution's `/services/apexrest/msf/api/job/Apply` endpoint
- **Job Reference**: Links applications to the correct job in Mysolution
- **Error Handling**: Robust error handling and logging

### Configuration

To set up Webflow forms for candidate applications:

1. Create a form with the required fields (see `docs/webflow-job-application-setup.md`)
2. Add a hidden field for the Mysolution Job ID
3. Configure the form to submit to our webhook endpoint
4. Set up JavaScript to populate the hidden field with the job ID from the page

Example Webflow form setup:
```html
<form data-job-id="{{jobID}}" action="/api/webhooks/webflow/form" method="post" enctype="multipart/form-data">
  <input type="text" name="first-name" placeholder="First Name" required>
  <input type="text" name="last-name" placeholder="Last Name" required>
  <input type="email" name="email" placeholder="Email" required>
  <input type="tel" name="phone" placeholder="Phone">
  <input type="file" name="cv" accept=".pdf,.doc,.docx,.txt">
  <input type="hidden" name="mysolution-id" value="">
  <button type="submit">Apply Now</button>
</form>
```

For detailed setup instructions, refer to the `docs/webflow-job-application-setup.md` file. 

# MySolution Job Application API Test

This repository contains a test script to verify the MySolution job application API with different domain values.

## Setup

1. Install dependencies:
```
npm install axios fs
```

2. Prepare test CV file:
   - Place a test PDF file named `testcv.pdf` in the root directory, or
   - Update the `cvFilePath` variable in the script to point to your test file

## Configuration

The script uses the following configuration values from the Postman collection:
- Base URL: `https://base-select.my.salesforce.com`
- Client ID and Secret: Values from the Postman collection
- Job ID: `a0w7Q000000qSuYQAU` (replace with an actual job ID if needed)

## Running the Tests

Execute the script with:
```
node job_application_test.js
```

## Test Domains

The script tests the following domain values:
- Empty string (default behavior)
- `salesforce.com`
- `base-select.my.salesforce.com`
- `mysolution`

## Expected Results

For each domain test, the script will output:
- The domain being tested
- The result of the API call (successful application submission or error)

## API Information

According to the Swagger documentation, the job application endpoint accepts:

- Required parameters:
  - `id`: The job ID to apply to (query parameter)
  - `domain`: Portal Domain Name (query parameter)

- Optional parameters:
  - UTM fields: `utm_campaign`, `utm_content`, `utm_medium`, `utm_source`, `utm_term`
  - `status`: Custom Job Application status (defaults to "Application")
  - `isExternalSource`: Boolean flag (affects Job Application Date)

- Fields format:
  - Each field is submitted as an object with a `value` property
  - File fields (like CV) include `fileName` and base64-encoded `value`

## Form Handler Integration

The application includes a client-side form handler (`public/formHandler.js`) that can be embedded in Webflow sites to handle job application submissions. The form handler:

1. Intercepts form submissions from Webflow forms
2. Collects form data including file uploads (CV)
3. Sends the data to the API endpoint
4. Provides feedback to the user

### Setup for Production

In production environments, the form handler uses a relative URL to the API endpoint (`/api/candidates/apply`). To use this in your Webflow site:

1. Upload the `formHandler.js` file to Webflow's Custom Code section
2. Ensure your form has the attribute `data-name="Vacature Form"`
3. Add a hidden field with the Mysolution job ID:
   ```html
   <input type="hidden" name="mysolution-id" value="YOUR_JOB_ID">
   ```

### Local Development

For local development and testing, use the webhook tunnel script:

```bash
npm run webhook
```

This script:
1. Creates an ngrok tunnel to your local server
2. Automatically updates the form handler with the correct ngrok URL
3. Allows testing form submissions locally