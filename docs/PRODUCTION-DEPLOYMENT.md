# Production Deployment Guide

This guide will help you successfully deploy the Mysolution Job Sync application to production.

## Pre-Deployment Checklist

Before deploying to production, ensure:

1. All API keys and credentials are properly configured
2. Database connections are properly set up (if applicable)
3. Dashboard security is enabled
4. Logging is properly configured
5. API rate limits are respected

## Environment Configuration

The application requires several environment variables to run properly. Create a `.env` file in your production environment with the following variables:

```
# Application Settings
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
ADMIN_API_KEY=your_secure_admin_api_key

# Webflow API Settings
WEBFLOW_API_TOKEN=your_actual_webflow_token
WEBFLOW_SITE_ID=your_actual_site_id
WEBFLOW_COLLECTION_ID=your_actual_collection_id

# Mysolution API Settings
MYSOLUTION_API_TOKEN=your_actual_mysolution_token
MYSOLUTION_API_URL=your_actual_mysolution_api_url

# Sync Settings
SYNC_INTERVAL=900000           # 15 minutes in milliseconds
ENABLE_SCHEDULED_SYNC=true
AUTO_PUBLISH=true

# Logging Settings
LOG_LEVEL=info
HTTP_REQUEST_LOGGING=false
REQUEST_ID_HEADER=x-request-id
LOG_RETENTION_DAYS=30
```

## Deployment Steps

### 1. Vercel Deployment

For deploying to Vercel:

1. Ensure your repository is connected to Vercel
2. Configure environment variables in the Vercel dashboard
3. Set the build command to `npm ci` (for a clean install)
4. Set the start command to `node src/index.js`
5. Deploy from the main branch

### 2. Traditional VPS Deployment

If deploying to a traditional VPS:

1. Clone the repository to your server
2. Install dependencies: `npm ci`
3. Set up environment variables in a `.env` file
4. Use PM2 to manage the Node.js process:
   ```
   npm install -g pm2
   pm2 start src/index.js --name "job-sync"
   pm2 save
   pm2 startup
   ```

## Post-Deployment Verification

After deployment, verify that:

1. The application is running by checking the health endpoint: `/health`
2. The dashboard is accessible at the root URL
3. API endpoints are functioning correctly
4. Scheduled jobs are running as expected
5. Logs are being generated properly

## Troubleshooting Common Issues

### Missing API Endpoints

If you encounter 404 errors for API endpoints, check:

1. The server is properly routing requests
2. All route files are correctly imported and initialized
3. Environment variables are correctly set up

### Authentication Issues

If authentication fails:

1. Verify the ADMIN_API_KEY environment variable is correctly set
2. Check that the API key is being properly sent in requests
3. Verify the authentication middleware is working correctly

### Dashboard Loading Issues

If the dashboard fails to load properly:

1. Check browser console for JavaScript errors
2. Verify that all API endpoints the dashboard relies on are functioning
3. Check for CORS issues if the dashboard is hosted separately

## Security Considerations

1. Never expose the admin API key in client-side code
2. Use HTTPS for all API requests
3. Ensure the dashboard is properly secured
4. Regularly rotate API keys and credentials
5. Monitor logs for unauthorized access attempts 