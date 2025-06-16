# Vercel Cron Jobs Setup for Scheduled Syncs

## Problem
The mini-syncs weren't happening because **Node.js cron jobs don't work on serverless platforms like Vercel**. Vercel functions are stateless and only run when triggered by HTTP requests.

## Solution
We've implemented **Vercel Cron Jobs** which is the proper way to handle scheduled tasks on Vercel.

## What's Changed

### 1. Added Vercel Cron Configuration (`vercel.json`)
```json
"crons": [
  {
    "path": "/api/cron/incremental-sync",
    "schedule": "*/5 * * * *"
  },
  {
    "path": "/api/cron/full-sync", 
    "schedule": "0 7 * * *"
  }
]
```

### 2. Created Cron Endpoints (`src/routes/admin.js`)
- `POST /api/cron/incremental-sync` - Runs every 5 minutes
- `POST /api/cron/full-sync` - Runs daily at 7 AM UTC

### 3. Added Security
- Added `CRON_SECRET` environment variable for authentication
- Endpoints verify `Authorization: Bearer ${CRON_SECRET}` header

### 4. Updated Main App (`src/index.js`)
- Detects serverless environment
- Disables Node.js cron jobs when running on Vercel
- Uses Vercel cron jobs instead

## Deployment Steps

### 1. Set Environment Variables in Vercel
Go to your Vercel project dashboard and add:
```
CRON_SECRET=mysolution-cron-secret-2024
```

### 2. Deploy to Vercel
```bash
git add .
git commit -m "Add Vercel cron jobs for scheduled syncs"
git push origin main
```

### 3. Verify Cron Jobs in Vercel Dashboard
1. Go to your project in Vercel dashboard
2. Navigate to "Functions" tab
3. You should see the cron jobs listed with their schedules

### 4. Test Before Going Live
Test the cron logic locally:
```bash
curl -X POST \
  -H "x-api-key: 4azk?mkxEFBAX&x&TSeJH!q@y?9TJ@YE!ipgp9ze" \
  -H "Content-Type: application/json" \
  -d '{"type": "incremental"}' \
  http://localhost:3000/api/admin/test-cron-sync
```

## How It Works

### On Vercel (Production)
1. **Vercel's cron system** calls `/api/cron/incremental-sync` every 5 minutes
2. **Vercel's cron system** calls `/api/cron/full-sync` daily at 7 AM UTC
3. These endpoints authenticate using the `CRON_SECRET`
4. The sync functions run normally, just triggered by HTTP instead of Node.js cron

### Locally (Development)
1. Node.js cron jobs still work for local development
2. The app detects it's not on Vercel and uses traditional cron
3. Both systems achieve the same result

## Monitoring

### Check Vercel Function Logs
1. Go to Vercel dashboard → Functions tab
2. Click on your cron functions to see execution logs
3. Check for any errors or successful sync completions

### Dashboard Still Works
- Your existing dashboard continues to work
- Manual sync buttons still function
- Real-time logs still show cron executions

## Benefits of Vercel Cron Jobs

✅ **Reliable**: Vercel guarantees execution  
✅ **Scalable**: No server management required  
✅ **Monitored**: Built-in logging and error tracking  
✅ **Secure**: Proper authentication mechanisms  
✅ **Cost-effective**: Only pay for execution time  

## Troubleshooting

### If Cron Jobs Don't Appear
1. Make sure `vercel.json` is in your project root
2. Redeploy the project after adding cron configuration
3. Check the Vercel dashboard for any deployment errors

### If Syncs Still Don't Run
1. Check Vercel function logs for authentication errors
2. Verify `CRON_SECRET` environment variable is set correctly
3. Use the test endpoint to verify sync logic works

### Timezone Considerations
- Vercel cron jobs run in UTC
- The "7 AM" full sync is 7 AM UTC
- Adjust schedule if you need different timezone

## Next Steps

1. **Deploy immediately** - The current setup won't work on Vercel without these changes
2. **Monitor for 24 hours** - Verify incremental syncs run every 5 minutes
3. **Check logs** - Ensure no errors in Vercel function logs
4. **Test manually** - Use dashboard buttons to confirm everything still works 