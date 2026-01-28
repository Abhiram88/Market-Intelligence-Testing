# Quick Start Guide - Market Intelligence Testing

## What This Application Does

This application fetches real-time Last Traded Price (LTP) for NSE stocks including:
- **NIFTY 50** - India's benchmark stock index
- **MEDICO** - Medico Remedies Ltd stock
- Any other NSE-listed stocks

## Prerequisites

✅ ICICI Direct trading account  
✅ Breeze API credentials (API Key + API Secret)  
✅ Google Cloud account (for deployment)  
✅ Supabase account (for data storage)

## Quick Setup (5 Minutes)

### 1. Get Your Breeze API Credentials

1. Login to: https://api.icicidirect.com/apiuser/login
2. Note down your:
   - API Key
   - API Secret

### 2. Deploy Services

```bash
# Clone the repository
git clone https://github.com/Abhiram88/Market-Intelligence-Testing.git
cd Market-Intelligence-Testing

# Deploy proxy service
cd breeze-proxy
gcloud run deploy maia-breeze-proxy-service \
  --source . \
  --region us-central1 \
  --set-env-vars "BREEZE_API_KEY=YOUR_KEY,BREEZE_API_SECRET=YOUR_SECRET,BREEZE_PROXY_ADMIN_KEY=MAKE_UP_A_STRONG_KEY"

# Deploy main backend (replace PROXY_URL with actual URL from above)
cd ..
gcloud run deploy market-attribution-backend \
  --source . \
  --region us-west1 \
  --set-env-vars "BREEZE_PROXY_URL=YOUR_PROXY_URL,BREEZE_PROXY_ADMIN_KEY=SAME_ADMIN_KEY,GEMINI_API_KEY=YOUR_GEMINI_KEY"
```

### 3. Set Daily Session Token

Every trading day, run:

```bash
# Get session token from ICICI Direct login URL
# Then set it:
python set_session.py --interactive
```

Or directly:

```bash
python set_session.py \
  --backend https://your-backend-url \
  --admin-key YOUR_ADMIN_KEY \
  --token YOUR_SESSION_TOKEN
```

### 4. Fetch Data!

```bash
# Test NIFTY and MEDICO
curl https://your-backend-url/api/test/fetch-symbols

# Fetch specific stock
curl -X POST https://your-backend-url/api/market/quote \
  -H "Content-Type: application/json" \
  -d '{"symbol": "NIFTY"}'
```

## Expected Response

```json
{
  "Success": {
    "last_traded_price": 23750.45,
    "change": 125.30,
    "percent_change": 0.53,
    "high": 23800.00,
    "low": 23650.00,
    "open": 23670.00,
    "volume": 45678900,
    "stock_code": "NIFTY"
  }
}
```

## Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Set environment variables
export BREEZE_API_KEY=your_key
export BREEZE_API_SECRET=your_secret
export BREEZE_PROXY_ADMIN_KEY=your_admin_key
export BREEZE_PROXY_URL=http://localhost:8081

# Start proxy (Terminal 1)
cd breeze-proxy && python breeze_proxy_app.py

# Start backend (Terminal 2)
python main.py

# Test (Terminal 3)
python test_api_client.py
```

## Troubleshooting

### "Session Invalid" Error
**Solution**: Set a fresh session token daily
```bash
python set_session.py --interactive
```

### "Cannot Connect to Proxy"
**Solution**: Check proxy service is running
```bash
curl https://your-proxy-url/breeze/health
```

### "Symbol Not Found"
**Solution**: Add symbol mapping in Supabase nse_master_list table

## Testing Without Deployment

Run the mock demonstration:
```bash
python mock_demo.py
```

This shows how data flows through the system without needing actual credentials.

## Key Files

- `main.py` - Main backend service
- `breeze-proxy/breeze_proxy_app.py` - Proxy service
- `set_session.py` - Session token helper
- `test_api_client.py` - Testing tool
- `mock_demo.py` - Demo without credentials

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Health check |
| `/api/test/fetch-symbols` | GET | Test NIFTY & MEDICO |
| `/api/market/quote` | POST | Get stock quote |
| `/api/breeze/admin/api-session` | POST | Set session token |

## Important Notes

⚠️ **Session tokens expire daily** - Must be refreshed each trading day  
⚠️ **Market hours**: 9:00 AM - 3:30 PM IST (Mon-Fri)  
⚠️ **Rate limits**: ICICI Breeze API has rate limits  
⚠️ **Symbol mapping**: Must be in Supabase table  

## Next Steps

1. ✅ Deploy both services
2. ✅ Set daily session token
3. ✅ Test with NIFTY and MEDICO
4. ✅ Add more symbols to Supabase
5. ✅ Integrate with your frontend

## Support

- 📖 Full docs: `README_DATA_FETCH.md`
- 🚀 Deployment: `DEPLOYMENT.md`
- 🧪 Testing: Run `python test_api_client.py --help`
- 💬 Issues: Check Cloud Run logs

## Architecture

```
Frontend (React)
    ↓
Backend (main.py)
    ↓
Proxy (breeze_proxy_app.py)
    ↓
ICICI Breeze API
```

## Sample Usage in Code

### Python
```python
import requests

response = requests.post(
    "https://your-backend/api/market/quote",
    json={"symbol": "NIFTY"}
)
data = response.json()
ltp = data["Success"]["last_traded_price"]
print(f"NIFTY LTP: ₹{ltp}")
```

### JavaScript
```javascript
const response = await fetch('https://your-backend/api/market/quote', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({symbol: 'NIFTY'})
});
const data = await response.json();
console.log(`NIFTY LTP: ₹${data.Success.last_traded_price}`);
```

### cURL
```bash
curl -X POST https://your-backend/api/market/quote \
  -H "Content-Type: application/json" \
  -d '{"symbol": "NIFTY"}' | jq '.Success.last_traded_price'
```

---

**Ready to fetch market data? Start with deploying the services!** 🚀
