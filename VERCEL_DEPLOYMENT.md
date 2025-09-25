# Vercel Deployment Guide

## Required Environment Variables

The following environment variables must be set in your Vercel project settings for the application to function properly:

### Core Application Settings
- `NODE_ENV`: Set to `production`
- `PORT`: Set to `3000` (Vercel will override this automatically)
- `ADMIN_API_KEY`: A secure key for admin API access

### Mysolution API
- `MYSOLUTION_API_URL`: The URL for the Mysolution API
- `MYSOLUTION_CLIENT_ID`: Client ID for Mysolution API authentication
- `MYSOLUTION_CLIENT_SECRET`: Client secret for Mysolution API authentication
- `MYSOLUTION_API_TIMEOUT`: Set to `30000` (30 seconds)
- `MYSOLUTION_API_RETRY_ATTEMPTS`: Set to `3`
- `MYSOLUTION_API_RETRY_DELAY`: Set to `1000` (1 second)

### Webflow API
- `WEBFLOW_API_TOKEN`: Your Webflow API token
- `WEBFLOW_SITE_ID`: Your Webflow site ID
- `WEBFLOW_JOBS_COLLECTION_ID`: ID of the Webflow collection for jobs
- `WEBFLOW_CANDIDATES_COLLECTION_ID`: ID of the Webflow collection for candidates (must be a valid ID, not a placeholder)
- `WEBFLOW_SECTORS_COLLECTION_ID`: ID of the Webflow collection for sectors
- `WEBFLOW_API_TIMEOUT`: Set to `30000` (30 seconds)
- `WEBFLOW_RATE_LIMIT`: Set to `20` (requests per minute)
- `WEBFLOW_AUTO_PUBLISH`: Set to `false` initially (can be enabled later)

### Sync Settings
- `SYNC_INTERVAL`: Set to `900000` (15 minutes in milliseconds)
- `SYNC_MAX_BATCH_SIZE`: Set to `100` 
- `SYNC_CONCURRENCY`: Set to `5`
- `SYNC_RETRY_FAILED_AFTER`: Set to `1800000` (30 minutes)
- `ENABLE_SCHEDULED_SYNC`: Set to `true` to enable scheduled syncs

### Logging Settings
- `LOG_LEVEL`: Set to `info` for production, `debug` for troubleshooting
- `LOG_CONSOLE`: Set to `true`
- `HTTP_REQUEST_LOGGING`: Set to `true`
- `HTTP_LOG_LEVEL`: Set to `info`
- `HTTP_LOG_FORMAT`: Set to `combined`
- `LOG_SKIP_ROUTES`: Set to `/health,/static,/api/admin/jobs/count,/api/admin/sync/status`
- `REQUEST_ID_HEADER`: Set to `x-request-id`
- `GENERATE_REQUEST_ID`: Set to `true`

## Important Notes

- Ensure all collection IDs are valid and not placeholder values
- Verify that `WEBFLOW_COLLECTION_ID` (if used) matches `WEBFLOW_JOBS_COLLECTION_ID`
- Make sure `NODE_ENV` is set to `production` for Vercel deployments
- Initially set `LOG_LEVEL` to `debug` to help troubleshoot deployment issues

## Setting Up Environment Variables in Vercel

1. Go to your Vercel dashboard
2. Select your project
3. Go to Settings > Environment Variables
4. Add each of the above variables
5. Make sure to click "Save" after adding all variables

## Deployment Notes

- If the application fails to start, check the build logs for missing environment variables
- The application will exit if any required environment variables are missing
- You can use the environment variable `DEBUG=*` to enable verbose logging
- Ensure that all API endpoints are working by testing the `/api/health` endpoint

## Troubleshooting

If you encounter deployment issues:

1. Check build logs for any error messages
2. Verify all environment variables are set correctly
3. Try setting `LOG_LEVEL=debug` temporarily to get more detailed logs
4. Check if your Mysolution API credentials are valid
5. Verify your Webflow API token has sufficient permissions 