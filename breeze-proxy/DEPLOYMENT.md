# Quick Deployment Guide - Breeze Proxy to Cloud Run

## Pre-Deployment Checklist

### 1. Google Cloud Setup
- [ ] Install Google Cloud SDK: https://cloud.google.com/sdk/docs/install
- [ ] Authenticate: `gcloud auth login`
- [ ] Set project: `gcloud config set project gen-lang-client-0751458856`

### 2. Secrets Configuration
Create these secrets in Google Secret Manager:

```bash
# Create secrets (run once)
echo -n "your_breeze_api_key" | gcloud secrets create BREEZE_API_KEY --data-file=-
echo -n "your_breeze_api_secret" | gcloud secrets create BREEZE_API_SECRET --data-file=-
echo -n "your_admin_key" | gcloud secrets create BREEZE_PROXY_ADMIN_KEY --data-file=-
```

### 3. Grant Permissions
```bash
# Get the Cloud Run service account
gcloud run services describe maia-breeze-proxy-service --region=us-central1 --format="value(spec.template.spec.serviceAccountName)"

# Grant secret access (replace SERVICE_ACCOUNT_EMAIL)
gcloud secrets add-iam-policy-binding BREEZE_API_KEY \
  --member="serviceAccount:SERVICE_ACCOUNT_EMAIL" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding BREEZE_API_SECRET \
  --member="serviceAccount:SERVICE_ACCOUNT_EMAIL" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding BREEZE_PROXY_ADMIN_KEY \
  --member="serviceAccount:SERVICE_ACCOUNT_EMAIL" \
  --role="roles/secretmanager.secretAccessor"
```

## Deployment Methods

### Method 1: Automated (Recommended)
```bash
cd breeze-proxy
./deploy.sh
```

### Method 2: Manual Deployment
```bash
cd breeze-proxy

# Build the image
gcloud builds submit --tag gcr.io/gen-lang-client-0751458856/maia-breeze-proxy-service

# Deploy to Cloud Run
gcloud run deploy maia-breeze-proxy-service \
  --image gcr.io/gen-lang-client-0751458856/maia-breeze-proxy-service \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --max-instances 10 \
  --set-env-vars "GCP_PROJECT_ID=gen-lang-client-0751458856"
```

### Method 3: Update Existing Service
```bash
cd breeze-proxy

# Just rebuild and deploy
gcloud builds submit --tag gcr.io/gen-lang-client-0751458856/maia-breeze-proxy-service

# The service will auto-update or manually trigger:
gcloud run services update maia-breeze-proxy-service \
  --image gcr.io/gen-lang-client-0751458856/maia-breeze-proxy-service \
  --region us-central1
```

## Post-Deployment Verification

### 1. Get Service URL
```bash
gcloud run services describe maia-breeze-proxy-service \
  --region us-central1 \
  --format 'value(status.url)'
```

Expected: `https://maia-breeze-proxy-service-919207294606.us-central1.run.app`

### 2. Test Health Endpoint
```bash
curl https://maia-breeze-proxy-service-919207294606.us-central1.run.app/
```

Expected response:
```json
{
  "status": "ok",
  "service": "breeze-proxy",
  "version": "1.0.0"
}
```

### 3. Test Breeze Health Endpoint
```bash
curl https://maia-breeze-proxy-service-919207294606.us-central1.run.app/breeze/health
```

Expected response:
```json
{
  "status": "ok",
  "session_active": false
}
```

### 4. Check Logs
```bash
gcloud logs read --service=maia-breeze-proxy-service --limit=50
```

Look for:
- ✓ "Starting Breeze Proxy on port 8080"
- ✓ "Health check available at..."
- ✗ No error messages

## Update Frontend Configuration

Update the frontend to use the deployed URL:

**File**: `app.py` (main backend)
```python
BREEZE_PROXY_URL = os.environ.get(
    "BREEZE_PROXY_SERVICE_URL", 
    "https://maia-breeze-proxy-service-919207294606.us-central1.run.app"
).rstrip("/")
```

**File**: `frontend/services/breezeService.ts`
```typescript
const DEFAULT_PROXY_URL = "https://maia-breeze-proxy-service-919207294606.us-central1.run.app";
```

## Troubleshooting

### Issue: "Container failed to start"
**Solution**: Check logs for startup errors
```bash
gcloud logs read --service=maia-breeze-proxy-service --limit=100
```

### Issue: "Health check failed"
**Causes**:
1. App not listening on PORT environment variable → FIXED ✓
2. App taking too long to start (>240s)
3. Health endpoint not responding

**Verify**:
```bash
curl https://maia-breeze-proxy-service-919207294606.us-central1.run.app/
```

### Issue: "Secret not found"
**Solution**: Verify secrets exist and permissions are set
```bash
# List secrets
gcloud secrets list --project=gen-lang-client-0751458856

# Check permissions
gcloud secrets get-iam-policy BREEZE_API_KEY
```

### Issue: "Port already in use" (Local)
**Solution**: Use different port or kill conflicting process
```bash
# Use different port
PORT=8082 python breeze_proxy_app.py

# Or kill the process
lsof -i :8081
kill -9 <PID>
```

### Issue: "CORS error from frontend"
**Solution**: CORS is now enabled ✓
- Check that frontend is using correct URL
- Verify OPTIONS requests are allowed

## Rollback Procedure

If deployment fails, rollback to previous version:

```bash
# List revisions
gcloud run revisions list --service=maia-breeze-proxy-service --region=us-central1

# Rollback to specific revision
gcloud run services update-traffic maia-breeze-proxy-service \
  --to-revisions=REVISION_NAME=100 \
  --region=us-central1
```

## Monitoring

### View Metrics
```bash
# Visit Cloud Run console
open https://console.cloud.google.com/run/detail/us-central1/maia-breeze-proxy-service
```

### Set Up Alerts
```bash
# Example: Alert on high error rate
gcloud alpha monitoring policies create \
  --notification-channels=CHANNEL_ID \
  --display-name="Breeze Proxy Errors" \
  --condition-threshold-value=10 \
  --condition-threshold-duration=60s
```

## Performance Tuning

### Increase Resources
```bash
gcloud run services update maia-breeze-proxy-service \
  --memory 1Gi \
  --cpu 2 \
  --region us-central1
```

### Adjust Concurrency
```bash
gcloud run services update maia-breeze-proxy-service \
  --concurrency 80 \
  --region us-central1
```

### Set Min Instances (Reduce Cold Starts)
```bash
gcloud run services update maia-breeze-proxy-service \
  --min-instances 1 \
  --region us-central1
```

## Cost Optimization

- **Development**: Use min-instances=0 (default)
- **Production**: Use min-instances=1 to avoid cold starts
- **High Traffic**: Increase max-instances

Current configuration:
- Memory: 512Mi (sufficient for proxy)
- CPU: 1 (adequate)
- Min instances: 0 (pay only when used)
- Max instances: 10 (handle bursts)

## Support

For issues:
1. Check logs: `gcloud logs read --service=maia-breeze-proxy-service`
2. Test health: `curl SERVICE_URL/`
3. Review documentation: `breeze-proxy/README.md`
4. Check Cloud Run status: https://console.cloud.google.com/run

## Success Criteria

Deployment is successful when:
- ✓ Service URL is accessible
- ✓ Health endpoint returns 200 OK
- ✓ No error logs
- ✓ Frontend can connect to proxy
- ✓ Secrets are loading correctly
- ✓ Market data endpoints respond

## Next Steps After Deployment

1. **Update Frontend**: Point to new Cloud Run URL
2. **Test Integration**: Verify frontend can fetch market data
3. **Set Session**: Use admin endpoint to set daily session token
4. **Monitor**: Watch logs for any issues
5. **Optimize**: Adjust resources based on usage patterns
