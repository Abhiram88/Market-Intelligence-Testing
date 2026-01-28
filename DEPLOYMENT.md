# Deployment Guide - Market Intelligence Testing

## Architecture Overview

This application consists of two main services:

1. **Breeze Proxy Service** (`breeze-proxy/breeze_proxy_app.py`)
   - Manages ICICI Breeze API authentication and session
   - Deployed as a separate Cloud Run service
   - Port: 8081 (default)

2. **Main Backend Service** (`main.py`)
   - Handles frontend requests
   - Maps symbols and forwards to proxy
   - Provides AI-powered analysis via Gemini
   - Port: 5000 (default)

Note: `app.py` is an alternative backend implementation. Use `main.py` as the primary backend.

## Prerequisites

1. **ICICI Direct Account**
   - Active trading account
   - Breeze API credentials (API Key and API Secret)
   - Get these from: https://api.icicidirect.com/apiuser/login

2. **Google Cloud Platform**
   - GCP Project with billing enabled
   - Cloud Run API enabled
   - Secret Manager API enabled (optional, for production)

3. **Supabase Account**
   - Project with `nse_master_list` table for symbol mapping
   - Service role key for backend access

4. **Gemini API Key**
   - For AI-powered market analysis
   - Get from: https://ai.google.dev/

## Environment Variables

### For Breeze Proxy Service:

```bash
# Required
BREEZE_API_KEY=your_icici_api_key
BREEZE_API_SECRET=your_icici_api_secret
BREEZE_PROXY_ADMIN_KEY=create_a_strong_random_key

# Optional
GCP_PROJECT_ID=your_gcp_project_id
PORT=8081
```

### For Main Backend Service:

```bash
# Required
BREEZE_PROXY_URL=https://maia-breeze-proxy-service-919207294606.us-central1.run.app
BREEZE_PROXY_ADMIN_KEY=same_as_proxy_admin_key
GEMINI_API_KEY=your_gemini_api_key
API_KEY=your_gemini_api_key

# Required for Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_key

# Optional
GCP_PROJECT_ID=your_gcp_project_id
VERTEX_LOCATION=us-central1
PORT=5000
```

## Local Development

### 1. Setup Python Environment

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
pip install -r breeze-proxy/requirements.txt
```

### 2. Set Environment Variables

```bash
# Create .env file in project root
cat > .env << EOF
BREEZE_API_KEY=your_key
BREEZE_API_SECRET=your_secret
BREEZE_PROXY_ADMIN_KEY=your_admin_key
BREEZE_PROXY_URL=http://localhost:8081
GEMINI_API_KEY=your_gemini_key
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_key
EOF

# Load environment variables
export $(cat .env | xargs)
```

### 3. Start Proxy Service

```bash
# Terminal 1: Start proxy
cd breeze-proxy
python breeze_proxy_app.py

# Should see:
# * Running on http://0.0.0.0:8081
```

### 4. Start Main Backend

```bash
# Terminal 2: Start backend
python main.py

# Should see:
# * Running on http://0.0.0.0:5000
```

### 5. Test the Setup

```bash
# Terminal 3: Run tests
python test_data_fetch.py
python test_api_client.py --backend http://localhost:5000 --proxy http://localhost:8081
```

## Cloud Deployment

### Step 1: Deploy Breeze Proxy Service

```bash
cd breeze-proxy

# Create secrets in Secret Manager (recommended for production)
echo -n "your_api_key" | gcloud secrets create BREEZE_API_KEY --data-file=-
echo -n "your_api_secret" | gcloud secrets create BREEZE_API_SECRET --data-file=-
echo -n "your_admin_key" | gcloud secrets create BREEZE_PROXY_ADMIN_KEY --data-file=-

# Deploy to Cloud Run
gcloud run deploy maia-breeze-proxy-service \
  --source . \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --set-env-vars "GCP_PROJECT_ID=your-project-id" \
  --set-secrets "BREEZE_API_KEY=BREEZE_API_KEY:latest,BREEZE_API_SECRET=BREEZE_API_SECRET:latest,BREEZE_PROXY_ADMIN_KEY=BREEZE_PROXY_ADMIN_KEY:latest"

# Note the service URL from output, e.g.:
# https://maia-breeze-proxy-service-919207294606.us-central1.run.app
```

### Step 2: Deploy Main Backend Service

```bash
# Return to project root
cd ..

# Create additional secrets
echo -n "your_gemini_key" | gcloud secrets create GEMINI_API_KEY --data-file=-
echo -n "your_supabase_url" | gcloud secrets create SUPABASE_URL --data-file=-
echo -n "your_supabase_key" | gcloud secrets create SUPABASE_SERVICE_ROLE_KEY --data-file=-

# Deploy to Cloud Run
gcloud run deploy market-attribution-backend \
  --source . \
  --region us-west1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --timeout 300 \
  --set-env-vars "BREEZE_PROXY_URL=https://maia-breeze-proxy-service-919207294606.us-central1.run.app,GCP_PROJECT_ID=your-project-id" \
  --set-secrets "GEMINI_API_KEY=GEMINI_API_KEY:latest,BREEZE_PROXY_ADMIN_KEY=BREEZE_PROXY_ADMIN_KEY:latest,SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest"

# Note the service URL from output, e.g.:
# https://market-attribution-backend-919207294606.us-west1.run.app
```

### Step 3: Update Frontend Configuration

Edit `services/apiService.ts`:

```typescript
const BACKEND_URL = "https://market-attribution-backend-919207294606.us-west1.run.app";
```

### Step 4: Set Daily Session Token

Every trading day, obtain session token from ICICI Direct:

1. Login to ICICI Direct website
2. After successful login, copy the session token from URL parameter
3. Set it via API:

```bash
curl -X POST https://market-attribution-backend-919207294606.us-west1.run.app/api/breeze/admin/api-session \
  -H "Content-Type: application/json" \
  -H "X-Proxy-Admin-Key: your_admin_key" \
  -d '{"api_session": "YOUR_SESSION_TOKEN_HERE"}'
```

### Step 5: Verify Deployment

```bash
# Test backend health
curl https://market-attribution-backend-919207294606.us-west1.run.app/api/health

# Test proxy health
curl https://maia-breeze-proxy-service-919207294606.us-central1.run.app/breeze/health

# Test data fetching (after setting session token)
curl https://market-attribution-backend-919207294606.us-west1.run.app/api/test/fetch-symbols
```

## Supabase Setup

### Create nse_master_list Table

```sql
CREATE TABLE nse_master_list (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(50) UNIQUE NOT NULL,
  short_name VARCHAR(50) NOT NULL,
  company_name VARCHAR(255),
  series VARCHAR(10),
  isin VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add indexes
CREATE INDEX idx_symbol ON nse_master_list(symbol);
CREATE INDEX idx_short_name ON nse_master_list(short_name);

-- Insert sample mappings
INSERT INTO nse_master_list (symbol, short_name, company_name) VALUES
('NIFTY', 'NIFTY', 'NIFTY 50 Index'),
('MEDICO', 'MEDREM', 'Medico Remedies Ltd'),
('TCS', 'TCS', 'Tata Consultancy Services'),
('INFY', 'INFTTEC', 'Infosys Limited');
```

## Monitoring and Logs

### View Cloud Run Logs

```bash
# Proxy service logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=maia-breeze-proxy-service" --limit 50 --format json

# Backend service logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=market-attribution-backend" --limit 50 --format json
```

### Common Log Filters

```bash
# Errors only
--filter='severity>=ERROR'

# Specific time range
--filter='timestamp>="2024-01-28T00:00:00Z" AND timestamp<="2024-01-28T23:59:59Z"'

# Search for specific text
--filter='textPayload:"Session invalid"'
```

## Troubleshooting

### Issue: 502 Bad Gateway
- **Cause**: Proxy service not responding
- **Check**: `curl <proxy_url>/breeze/health`
- **Fix**: Redeploy proxy service

### Issue: Session Invalid
- **Cause**: Daily session token expired or not set
- **Fix**: Set new session token via admin endpoint

### Issue: Symbol Not Found
- **Cause**: Symbol not in nse_master_list table
- **Fix**: Add mapping to Supabase table

### Issue: CORS Errors
- **Cause**: Frontend domain not allowed
- **Fix**: Update CORS settings in main.py

## Security Best Practices

1. **Use Secret Manager**: Store all credentials in GCP Secret Manager
2. **Rotate Admin Key**: Change BREEZE_PROXY_ADMIN_KEY regularly
3. **Limit Service Access**: Use IAM policies to restrict access
4. **Enable Audit Logging**: Monitor all API calls
5. **Use HTTPS**: Always use HTTPS for production

## Cost Optimization

1. **Set CPU Throttling**: Use `--cpu-throttling` for services
2. **Configure Min Instances**: Set to 0 for non-prod environments
3. **Optimize Memory**: Reduce if not fully utilized
4. **Use Request Timeout**: Set appropriate timeout values

## Maintenance

### Daily Tasks
- Set new Breeze session token at market open

### Weekly Tasks
- Review Cloud Run logs for errors
- Check API usage and costs
- Verify symbol mappings are up-to-date

### Monthly Tasks
- Update dependencies
- Review and optimize performance
- Audit security configurations

## Support and Resources

- ICICI Breeze API Docs: https://api.icicidirect.com/breezeconnect/
- Cloud Run Documentation: https://cloud.google.com/run/docs
- Supabase Documentation: https://supabase.com/docs
- Project README: README_DATA_FETCH.md

## Contact

For issues or questions:
1. Check logs in Cloud Run console
2. Review README_DATA_FETCH.md
3. Run test scripts to diagnose issues
4. Check ICICI Breeze API status
