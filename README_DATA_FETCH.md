# Market Intelligence Testing - Data Fetching Guide

## Overview
This application fetches real-time market data for NSE (India) stocks using the ICICI Direct Breeze API.

## Architecture

```
Frontend (React) → Backend (main.py) → Proxy Service (breeze_proxy_app.py) → ICICI Breeze API
```

### Components:

1. **breeze_proxy_app.py** - Proxy service that manages Breeze API authentication
   - Deployed at: `https://maia-breeze-proxy-service-919207294606.us-central1.run.app`
   - Handles session management and API calls to ICICI Direct
   
2. **main.py** - Main backend service
   - Handles requests from frontend
   - Maps NSE symbols to Breeze codes
   - Forwards requests to proxy service
   
3. **Frontend (React)** - User interface
   - Located in: `App.tsx`, `components/`, `services/`

## Setup Instructions

### 1. Environment Variables

Create a `.env` file (or set in Cloud Run):

```bash
# Breeze API Credentials (from ICICI Direct)
BREEZE_API_KEY=your_api_key_here
BREEZE_API_SECRET=your_api_secret_here
BREEZE_PROXY_ADMIN_KEY=your_admin_key_here

# Proxy Service URL
BREEZE_PROXY_URL=https://maia-breeze-proxy-service-919207294606.us-central1.run.app

# Gemini AI (for market analysis)
GEMINI_API_KEY=your_gemini_key_here
API_KEY=your_gemini_key_here

# Supabase (for symbol mapping and data storage)
SUPABASE_URL=https://xbnzvmgawikqzxutmoea.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_key_here

# GCP Project (for Secret Manager)
GCP_PROJECT_ID=gen-lang-client-0751458856
```

### 2. Deploy Proxy Service

The proxy service (breeze_proxy_app.py) must be deployed and running:

```bash
cd breeze-proxy
gcloud run deploy maia-breeze-proxy-service \
  --source . \
  --region us-central1 \
  --allow-unauthenticated
```

### 3. Deploy Main Backend

```bash
gcloud run deploy market-attribution-backend \
  --source . \
  --region us-west1 \
  --allow-unauthenticated \
  --set-env-vars BREEZE_PROXY_URL=https://maia-breeze-proxy-service-919207294606.us-central1.run.app
```

## How to Fetch Data

### Step 1: Set Daily Session Token

The Breeze API requires a daily session token obtained from ICICI Direct login:

1. Login to ICICI Direct website
2. After login, copy the session token from the URL parameter
3. Set it via API:

```bash
curl -X POST https://your-backend-url/api/breeze/admin/api-session \
  -H "Content-Type: application/json" \
  -H "X-Proxy-Admin-Key: YOUR_ADMIN_KEY" \
  -d '{"api_session": "YOUR_SESSION_TOKEN"}'
```

### Step 2: Fetch Market Data

#### Test Endpoint (NIFTY and MEDICO):
```bash
curl https://your-backend-url/api/test/fetch-symbols
```

#### Fetch Specific Symbol:
```bash
curl -X POST https://your-backend-url/api/market/quote \
  -H "Content-Type: application/json" \
  -d '{"symbol": "NIFTY"}'
```

Or for MEDICO:
```bash
curl -X POST https://your-backend-url/api/market/quote \
  -H "Content-Type: application/json" \
  -d '{"symbol": "MEDICO"}'
```

## Symbol Mapping

The system automatically maps NSE symbols to Breeze codes:

| NSE Symbol | Breeze Code | Type |
|------------|-------------|------|
| NIFTY | NIFTY | Index |
| MEDICO | MEDREM | Stock |

Mappings are stored in Supabase `nse_master_list` table.

## API Endpoints

### Health Checks
- `GET /api/health` - Backend health
- `GET /breeze/health` - Proxy health

### Data Fetching
- `POST /api/market/quote` - Get LTP for a symbol
- `POST /api/market/depth` - Get market depth
- `POST /api/market/historical` - Get historical data
- `GET /api/market/nifty-realtime` - Get Nifty real-time data

### Testing
- `GET /api/test/fetch-symbols` - Test NIFTY and MEDICO fetching

### Session Management
- `POST /api/breeze/admin/api-session` - Set daily session token

## Troubleshooting

### Issue: "Breeze session token not set"
**Solution**: Set the daily session token via `/api/breeze/admin/api-session`

### Issue: "No data returned from Breeze"
**Causes**:
1. Session token expired (need to refresh daily)
2. Symbol not found (check mapping)
3. Market is closed
4. Network issue with ICICI servers

### Issue: "Symbol mapping not found"
**Solution**: Add symbol to Supabase `nse_master_list` table

### Issue: Cannot connect to proxy
**Causes**:
1. Proxy service not deployed
2. Wrong BREEZE_PROXY_URL environment variable
3. Network restrictions

## Testing Locally

### 1. Install dependencies:
```bash
pip install -r requirements.txt
```

### 2. Run proxy service:
```bash
cd breeze-proxy
python breeze_proxy_app.py
```

### 3. Run main backend:
```bash
python main.py
```

### 4. Run test script:
```bash
python test_data_fetch.py
```

## Common Errors and Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| `Session invalid` | Token expired | Refresh session token |
| `stock_code required` | Missing symbol | Provide symbol in request |
| `No data for {symbol}` | Symbol not found | Check symbol mapping |
| `Proxy Communication Failed` | Proxy down | Check proxy service status |
| `GEMINI_API_KEY not found` | Missing env var | Set GEMINI_API_KEY |

## Dependencies

Python packages (requirements.txt):
- flask
- flask-cors
- requests
- google-genai
- supabase
- pytz
- breeze-connect

## Important Notes

1. **Session Management**: Session tokens must be refreshed daily
2. **Market Hours**: NSE trades 9:00 AM - 3:30 PM IST (Mon-Fri)
3. **Rate Limits**: ICICI Breeze API has rate limits
4. **Symbol Mapping**: Always use correct Breeze codes
5. **Error Handling**: Check response status codes

## Support

For issues with:
- Breeze API: Check ICICI Direct documentation
- Symbol mapping: Update Supabase table
- Deployment: Check Cloud Run logs

## License

Proprietary - Market Intelligence Testing
