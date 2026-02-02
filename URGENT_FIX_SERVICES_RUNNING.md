# URGENT FIX: Services Running But Not Accessible

## Your Situation

✅ All services are running:
```
tcp        0      0 0.0.0.0:5000            0.0.0.0:*               LISTEN     
tcp        0      0 0.0.0.0:8081            0.0.0.0:*               LISTEN     
tcp6       0      0 :::8082                 :::*                    LISTEN
```

❌ But you still can't access http://34.72.13.202:8082/

## Root Cause

The frontend is running but **NOT CONFIGURED to use the external IP** for backend API calls.

When you access from your laptop, the frontend JavaScript tries to call `localhost:5000` (which is your laptop, not the server).

## IMMEDIATE FIX

### Step 1: Stop the Frontend

In the terminal where frontend is running, press **Ctrl+C**

### Step 2: Set the Backend URL

```bash
cd ~/Market-Intelligence-Testing/frontend
export VITE_API_URL=http://34.72.13.202:5000
```

### Step 3: Restart Frontend

```bash
npm start
```

Wait for:
```
  VITE v5.4.21  ready in 514 ms

  ➜  Local:   http://localhost:8082/
  ➜  Network: http://10.128.0.4:8082/
```

### Step 4: Test

Open in your browser: **http://34.72.13.202:8082/**

It should now work! 🎉

---

## Why This Fixes It

**Before:**
```
Browser loads frontend from 34.72.13.202:8082 ✅
Frontend JavaScript tries to call localhost:5000 ❌ (your laptop!)
No data loads ❌
```

**After:**
```
Browser loads frontend from 34.72.13.202:8082 ✅
Frontend JavaScript calls 34.72.13.202:5000 ✅ (the server!)
Data loads ✅
```

---

## Make It Permanent

Create a `.env.local` file so you don't have to set it every time:

```bash
cd ~/Market-Intelligence-Testing/frontend
cat > .env.local << 'EOF'
VITE_API_URL=http://34.72.13.202:5000
EOF
```

Now the setting persists across restarts!

---

## Verify It's Working

### Test 1: Check Environment Variable is Set

In the terminal where you're starting frontend:
```bash
echo $VITE_API_URL
```

Should show: `http://34.72.13.202:5000`

If it shows nothing, you need to set it again!

### Test 2: Check Frontend is Using Correct URL

1. Open http://34.72.13.202:8082/ in browser
2. Press **F12** to open DevTools
3. Go to **Network** tab
4. Reload page
5. Look at API calls

✅ **Good** - Calls go to `http://34.72.13.202:5000/api/...`
❌ **Bad** - Calls go to `http://localhost:5000/api/...`

If you see localhost, the VITE_API_URL wasn't set correctly!

### Test 3: Check Backend is Responding

From your laptop/browser:
```bash
curl http://34.72.13.202:5000/api/market/nifty-realtime
```

Should return JSON (not "connection refused")

---

## Still Not Working?

### Issue 1: "Still showing localhost in browser"

**Cause:** VITE_API_URL not set before starting frontend

**Fix:**
```bash
# Stop frontend (Ctrl+C)
cd ~/Market-Intelligence-Testing/frontend
export VITE_API_URL=http://34.72.13.202:5000
echo $VITE_API_URL  # Verify it's set!
npm start
```

### Issue 2: "VITE_API_URL is set but still not working"

**Cause:** Need to restart frontend after setting variable

**Fix:**
```bash
# Stop frontend (Ctrl+C)
# Start it again
npm start
```

The variable must be set **BEFORE** running `npm start`!

### Issue 3: "Frontend loads but shows 'Cannot connect to backend'"

**Check browser console (F12):**

If you see:
```
GET http://34.72.13.202:5000/api/market/nifty-realtime net::ERR_CONNECTION_REFUSED
```

Then:
1. Check backend is running: `netstat -tuln | grep 5000`
2. Check firewall allows port 5000
3. Try from VM: `curl http://localhost:5000/api/market/nifty-realtime`

### Issue 4: "CORS errors in browser console"

If you see:
```
Access to fetch at 'http://34.72.13.202:5000/api/...' has been blocked by CORS policy
```

**Fix:** Restart backend with CORS enabled (it should already be, but just in case):
```bash
# Check app.py has this line:
grep "CORS" ~/Market-Intelligence-Testing/app.py
# Should show: CORS(app, supports_credentials=True)
```

If missing, backend needs to be updated.

---

## Complete Restart Procedure

If you're still having issues, do a clean restart:

### Terminal 1: Backend
```bash
cd ~/Market-Intelligence-Testing
python app.py
```

Wait for:
```
 * Running on http://10.128.0.4:5000
```

### Terminal 2: Breeze Proxy
```bash
cd ~/Market-Intelligence-Testing/breeze-proxy
python breeze_proxy_app.py
```

Wait for:
```
 * Running on http://10.128.0.4:8081
```

### Terminal 3: Frontend
```bash
cd ~/Market-Intelligence-Testing/frontend

# IMPORTANT: Set this first!
export VITE_API_URL=http://34.72.13.202:5000

# Verify it's set
echo $VITE_API_URL

# Now start
npm start
```

Wait for:
```
  ➜  Network: http://10.128.0.4:8082/
```

### Test
Open: http://34.72.13.202:8082/

---

## Quick Verification Script

Run this to check everything:

```bash
#!/bin/bash
echo "=== Checking Services ==="
netstat -tuln | grep -E ':(5000|8081|8082)'
echo ""

echo "=== Checking VITE_API_URL ==="
cd ~/Market-Intelligence-Testing/frontend
if [ -f .env.local ]; then
    echo "Found .env.local:"
    cat .env.local
else
    echo "No .env.local file"
    echo "Environment variable: $VITE_API_URL"
fi
echo ""

echo "=== Testing Backend ==="
curl -I http://localhost:5000/api/market/nifty-realtime 2>&1 | head -3
echo ""

echo "=== Testing Frontend ==="
curl -I http://localhost:8082/ 2>&1 | head -3
echo ""

echo "=== Next Step ==="
echo "1. If VITE_API_URL not set, run:"
echo "   export VITE_API_URL=http://34.72.13.202:5000"
echo "2. Restart frontend: npm start"
echo "3. Access: http://34.72.13.202:8082/"
```

Save as `verify-config.sh` and run it.

---

## What to Check in Browser

1. **Open http://34.72.13.202:8082/**

2. **Press F12** (DevTools)

3. **Check Console tab** for errors:
   - ✅ No red errors = Good
   - ❌ "ERR_CONNECTION_REFUSED" = Backend not accessible
   - ❌ "CORS policy" = Backend CORS issue
   - ❌ "Failed to fetch" = Network issue

4. **Check Network tab**:
   - Click on any API request
   - Look at "Request URL"
   - Should be: `http://34.72.13.202:5000/api/...`
   - Should NOT be: `http://localhost:5000/api/...`

---

## Final Checklist

Before accessing the app, verify:

- [ ] All 3 services running: `netstat -tuln | grep -E ':(5000|8081|8082)'`
- [ ] VITE_API_URL is set: `echo $VITE_API_URL`
- [ ] Frontend restarted AFTER setting VITE_API_URL
- [ ] GCP firewall allows ports 5000, 8081, 8082
- [ ] Backend responds: `curl http://34.72.13.202:5000/api/market/nifty-realtime`
- [ ] Frontend responds: `curl http://34.72.13.202:8082/`

If all checked, access: **http://34.72.13.202:8082/**

---

## Summary

**The Problem:** Frontend not configured to use external IP for backend calls

**The Fix:**
```bash
cd ~/Market-Intelligence-Testing/frontend
export VITE_API_URL=http://34.72.13.202:5000
npm start
```

**Must do this EVERY time you start frontend**, OR create `.env.local` file to make it permanent.

This is the #1 most common issue when services are running but app doesn't work!
