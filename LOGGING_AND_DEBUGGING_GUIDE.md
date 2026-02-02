# Logging and Debugging Guide

## Quick Answer to Your Questions

### Q1: Are you using the Cloud Run proxy?

**YES! The backend is using the Cloud Run proxy by default.**

From `app.py` line 19:
```python
BREEZE_PROXY_URL = os.environ.get(
    "BREEZE_PROXY_SERVICE_URL", 
    "https://maia-breeze-proxy-service-919207294606.us-central1.run.app"
)
```

**What this means:**
- If you set `BREEZE_PROXY_SERVICE_URL` environment variable → uses that
- Otherwise → uses Cloud Run proxy (the default)
- Your setup is using: **https://maia-breeze-proxy-service-919207294606.us-central1.run.app** ✅

### Q2: What logs do you need to troubleshoot?

See sections below for detailed logging instructions.

---

## Understanding Your Architecture

### Current Setup

```
Browser (Your Laptop)
    ↓
Frontend (34.72.13.202:8082) - Running ✅
    ↓ API calls to http://34.72.13.202:5000
Backend (34.72.13.202:5000) - Running ✅
    ↓ Breeze calls to Cloud Run
Cloud Run Proxy (https://maia-breeze-proxy-service-919207294606.us-central1.run.app) ✅
    ↓
ICICI Breeze API
```

### Local Breeze Proxy (Port 8081)

**Status**: Running but **NOT USED** by backend

The local proxy on port 8081 is running but the backend doesn't use it by default. It's only useful for:
- Direct testing
- Debugging Breeze API calls
- Development

To make backend use the local proxy instead of Cloud Run:
```bash
export BREEZE_PROXY_SERVICE_URL=http://localhost:8081
python app.py
```

---

## Logs to Check

### 1. Frontend Logs (Vite/Browser)

**Where**: Terminal where you ran `npm start`

**What to look for:**
```
✅ Good:
  ➜  Local:   http://localhost:8082/
  ➜  Network: http://10.128.0.4:8082/
  
❌ Bad:
  Error: Failed to fetch
  CORS error
  Network error
```

**Browser Console (F12):**
Open browser DevTools (F12) → Console tab

```javascript
// Good - API calls working
GET http://34.72.13.202:5000/api/market/nifty-realtime 200 OK

// Bad - Can't reach backend
GET http://34.72.13.202:5000/api/market/nifty-realtime net::ERR_CONNECTION_REFUSED

// Bad - Backend not returning data
GET http://34.72.13.202:5000/api/market/nifty-realtime 500 Internal Server Error
```

**How to check:**
1. Open http://34.72.13.202:8082/ in browser
2. Press F12 to open DevTools
3. Go to "Console" tab
4. Look for red errors
5. Go to "Network" tab to see API calls

### 2. Backend Logs (app.py)

**Where**: Terminal where you ran `python app.py`

**What to look for:**

**Startup logs:**
```
✅ Good:
 * Running on http://127.0.0.1:5000
 * Running on http://10.128.0.4:5000

❌ Bad:
OSError: [Errno 98] Address already in use
```

**Request logs (when frontend makes API calls):**
```
✅ Good - API calls being received:
INFO:werkzeug:10.128.0.4 - - [02/Feb/2026 17:30:00] "GET /api/market/nifty-realtime HTTP/1.1" 200 -
INFO:werkzeug:10.128.0.4 - - [02/Feb/2026 17:30:05] "POST /api/breeze/quotes HTTP/1.1" 200 -

❌ Bad - No logs = Frontend not making calls or can't reach backend
```

**Error logs:**
```
❌ Connection errors to Cloud Run proxy:
requests.exceptions.ConnectionError: Failed to establish connection to https://maia-breeze-proxy-service...

❌ API key errors:
KeyError: 'API_KEY'
Error: No API key configured

❌ Breeze API errors:
Error calling Breeze proxy: 401 Unauthorized
```

**How to see more details:**
```bash
# Enable debug logging in app.py
# Add at the top of app.py:
import logging
logging.basicConfig(level=logging.DEBUG)
```

### 3. Breeze Proxy Logs (Local - Port 8081)

**Where**: Terminal where you ran `python breeze_proxy_app.py`

**Current logs show:**
```
✅ Service started successfully:
INFO:__main__:🚀 Starting Breeze Proxy Server
INFO:__main__:Port: 8081
INFO:__main__:Host: 0.0.0.0 (all interfaces)
 * Running on http://127.0.0.1:8081
 * Running on http://10.128.0.4:8081
```

**What you said**: "No response there"

**Why**: Because the backend is using **Cloud Run proxy**, not the local one!

**To see local proxy activity:**
Option 1: Make backend use local proxy:
```bash
export BREEZE_PROXY_SERVICE_URL=http://localhost:8081
python app.py
```

Option 2: Test local proxy directly:
```bash
curl http://localhost:8081/
curl http://localhost:8081/breeze/health
```

### 4. Cloud Run Proxy Logs

**Where**: Google Cloud Console or gcloud CLI

**How to check:**
```bash
# View recent logs
gcloud logs read \
  --limit 50 \
  --service maia-breeze-proxy-service \
  --project your-project-id

# Stream live logs
gcloud logs tail \
  --service maia-breeze-proxy-service \
  --project your-project-id
```

**What to look for:**
```
✅ Good - Receiving requests:
Request received: POST /breeze/quotes
Response sent: 200 OK

❌ Bad - Authentication errors:
401 Unauthorized: No valid session
Error: Invalid API key

❌ Bad - Breeze API errors:
Connection error to ICICI Breeze API
Timeout calling Breeze API
```

---

## Diagnostic Commands

### Check if services are running
```bash
./check-services.sh
```

### Test each service individually

**Frontend:**
```bash
curl -I http://34.72.13.202:8082/
# Should return: HTTP/1.1 200 OK
```

**Backend:**
```bash
curl http://34.72.13.202:5000/api/market/nifty-realtime
# Should return JSON or error message (not connection refused)
```

**Local Breeze Proxy:**
```bash
curl http://localhost:8081/
# Should return: {"status":"ok","service":"breeze-proxy","version":"1.0.0"}
```

**Cloud Run Breeze Proxy:**
```bash
curl https://maia-breeze-proxy-service-919207294606.us-central1.run.app/
# Should return: {"status":"ok","service":"breeze-proxy","version":"1.0.0"}
```

### Check backend is using Cloud Run proxy
```bash
# In backend terminal, look for:
grep -A 2 "BREEZE_PROXY_URL" ~/Market-Intelligence-Testing/app.py

# Or check at runtime:
cd ~/Market-Intelligence-Testing
python -c "import os; print(os.environ.get('BREEZE_PROXY_SERVICE_URL', 'https://maia-breeze-proxy-service-919207294606.us-central1.run.app'))"
```

---

## Request Flow Tracing

When you access the application, here's what happens:

### Step 1: Load Frontend
```
Browser → http://34.72.13.202:8082/
```

**Check frontend logs:**
```
✅ Should see in Vite terminal:
(No specific log for page load, but service should be running)
```

### Step 2: Frontend Makes API Call
```
Browser JavaScript → http://34.72.13.202:5000/api/market/nifty-realtime
```

**Check backend logs:**
```
✅ Should see in app.py terminal:
INFO:werkzeug:10.128.0.4 - - [02/Feb/2026 17:30:00] "GET /api/market/nifty-realtime HTTP/1.1" 200 -
```

### Step 3: Backend Calls Cloud Run Proxy
```
Backend → https://maia-breeze-proxy-service-919207294606.us-central1.run.app/breeze/quotes
```

**Check backend logs for outgoing requests:**
```
✅ Good:
(May not show by default, enable debug logging to see)

❌ Bad:
requests.exceptions.ConnectionError: Failed to establish connection
```

**Check Cloud Run logs:**
```bash
gcloud logs read --service maia-breeze-proxy-service --limit 10
```

### Step 4: Cloud Run Calls ICICI Breeze
```
Cloud Run → ICICI Breeze API
```

**Check Cloud Run logs:**
```
✅ Good:
Request to Breeze API successful: 200 OK

❌ Bad:
Breeze API error: 401 Unauthorized
Session token expired
```

---

## Common Issues and Log Patterns

### Issue 1: Frontend loads but no data

**Symptoms:**
- Frontend UI shows up
- Loading spinners forever
- "OFFLINE" or "No data" messages

**Logs to check:**
1. Browser console (F12) - Look for red errors
2. Backend terminal - Should see API requests

**Common causes:**
```
❌ Backend not reachable from browser
   Browser console: net::ERR_CONNECTION_REFUSED

❌ CORS errors
   Browser console: CORS policy blocked

❌ Backend responding but with errors
   Backend logs: 500 Internal Server Error
   
❌ VITE_API_URL not set correctly
   Browser network tab: Calling localhost instead of 34.72.13.202
```

### Issue 2: Backend can't reach Cloud Run proxy

**Symptoms:**
- Backend logs show connection errors
- Timeouts

**Logs to check:**
```
❌ Backend terminal:
requests.exceptions.ConnectionError: HTTPSConnectionPool
requests.exceptions.Timeout: Read timed out
```

**Causes:**
- Internet connectivity from VM
- Cloud Run service down
- Authentication required

### Issue 3: Cloud Run proxy can't authenticate with Breeze

**Symptoms:**
- Backend gets 401 errors from proxy
- No market data returned

**Cloud Run logs:**
```
❌ 401 Unauthorized: No valid session token
Error: Breeze session expired
```

**Fix:**
Set Breeze session token via API:
```bash
curl -X POST https://maia-breeze-proxy-service-919207294606.us-central1.run.app/breeze/admin/api-session \
  -H "Content-Type: application/json" \
  -d '{"session_token":"YOUR_TOKEN","admin_key":"YOUR_KEY"}'
```

---

## Enable Verbose Logging

### Backend (app.py)

Add at the top of `app.py`:
```python
import logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
```

### Frontend (Browser)

Browser already shows all errors in console (F12).

For more details, check Network tab in DevTools:
1. Press F12
2. Go to "Network" tab
3. Reload page
4. Click on any request to see details

### Local Breeze Proxy

Already has good logging. To see more:
```python
# In breeze_proxy_app.py, change:
app.run(host="0.0.0.0", port=port, debug=True)  # Enable debug mode
```

---

## Quick Debugging Checklist

When something's not working:

1. **Check all services running:**
   ```bash
   ./check-services.sh
   ```

2. **Check browser console:**
   - Open http://34.72.13.202:8082/
   - Press F12
   - Look for red errors

3. **Check backend logs:**
   - Look at terminal running `python app.py`
   - Should see request logs when frontend makes calls
   - Look for error messages

4. **Test backend directly:**
   ```bash
   curl http://34.72.13.202:5000/api/market/nifty-realtime
   ```

5. **Test Cloud Run proxy:**
   ```bash
   curl https://maia-breeze-proxy-service-919207294606.us-central1.run.app/
   ```

6. **Check Cloud Run logs:**
   ```bash
   gcloud logs read --service maia-breeze-proxy-service --limit 20
   ```

---

## What Logs to Share for Troubleshooting

If you need help, share:

1. **Browser console errors:**
   - Open F12 → Console tab
   - Copy any red errors
   - Share screenshot of Network tab showing failed requests

2. **Backend terminal output:**
   - Last 20-30 lines from terminal running `python app.py`
   - Include any error messages

3. **Frontend terminal output:**
   - Output from `npm start`
   - Any errors or warnings

4. **Service status:**
   - Output of `./check-services.sh`

5. **Test results:**
   ```bash
   curl http://34.72.13.202:8082/
   curl http://34.72.13.202:5000/api/market/nifty-realtime
   curl https://maia-breeze-proxy-service-919207294606.us-central1.run.app/
   ```

---

## Summary

**Your Current Setup:**
- ✅ Frontend running on 8082
- ✅ Backend running on 5000
- ✅ Local proxy running on 8081 (but not used)
- ✅ Backend using Cloud Run proxy by default

**To see logs:**
- Frontend: Browser console (F12)
- Backend: Terminal running `python app.py`
- Cloud Run: `gcloud logs read --service maia-breeze-proxy-service`

**Most important logs when debugging:**
1. Browser console (F12) - Shows frontend errors and API call results
2. Backend terminal - Shows incoming requests and outgoing proxy calls
3. Cloud Run logs - Shows Breeze API authentication and call results

**Next steps:**
1. Access http://34.72.13.202:8082/ in browser
2. Open F12 console
3. Look for any errors
4. Share logs if issues persist
