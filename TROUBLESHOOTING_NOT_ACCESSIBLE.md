# Troubleshooting: Application Not Accessible

## Your Current Issue

You reported:
- ❌ `http://34.72.13.202:8082/` - "took too long to respond"
- ❌ `localhost:5000` - "connection refused"
- ❌ No proxy activity in terminal logs

## Root Cause: Frontend Not Running!

You started:
- ✅ Backend (app.py) on port 5000 - **Running**
- ✅ Breeze Proxy (breeze_proxy_app.py) on port 8081 - **Running**
- ❌ **Frontend NOT started** - **MISSING!**

### Why This Causes All Your Issues

1. **Port 8082 times out**: Nothing is listening on port 8082 because frontend isn't running
2. **No proxy logs**: Frontend isn't running → No API calls → No logs in backend/proxy
3. **localhost:5000 doesn't work**: You're accessing from your laptop, not from inside the VM

## Quick Fix: Start the Frontend!

### Step 1: Open a New Terminal Window

You need **THREE separate terminal windows/sessions**:
- Terminal 1: Backend (you have this running)
- Terminal 2: Breeze Proxy (you have this running)
- Terminal 3: Frontend (YOU NEED TO START THIS!)

### Step 2: Start the Frontend

In a NEW terminal window on your VM:

```bash
cd ~/Market-Intelligence-Testing/frontend

# Install dependencies if not already done
npm install

# Set the backend URL for external access
export VITE_API_URL=http://34.72.13.202:5000

# Start the frontend
npm start
```

You should see output like:
```
  VITE v5.4.21  ready in 460 ms

  ➜  Local:   http://localhost:8082/
  ➜  Network: http://10.128.0.4:8082/
  ➜  Network: http://34.72.13.202:8082/
```

### Step 3: Wait 10-30 seconds

The frontend needs time to compile and start.

### Step 4: Access the Application

Now access: **http://34.72.13.202:8082/**

You should see the Market Intelligence dashboard!

---

## Complete Verification Checklist

Run these commands on your VM to verify all services are running:

```bash
# Check if services are listening on their ports
netstat -tuln | grep -E ':(5000|8081|8082)'
```

**Expected output:**
```
tcp6  0  0  :::5000   :::*  LISTEN  # Backend
tcp6  0  0  :::8081   :::*  LISTEN  # Breeze Proxy
tcp6  0  0  :::8082   :::*  LISTEN  # Frontend
```

**If you don't see port 8082**, the frontend is not running!

---

## How to Start All Three Services

### Using the Smart Startup Script (Recommended)

```bash
cd ~/Market-Intelligence-Testing
./start-all.sh
```

This opens three terminals automatically!

### Manual Method (Three Terminals)

**Terminal 1: Backend**
```bash
cd ~/Market-Intelligence-Testing
python app.py
```

**Terminal 2: Breeze Proxy**
```bash
cd ~/Market-Intelligence-Testing/breeze-proxy
python breeze_proxy_app.py
```

**Terminal 3: Frontend**
```bash
cd ~/Market-Intelligence-Testing/frontend
export VITE_API_URL=http://34.72.13.202:5000
npm start
```

---

## Testing Each Service Individually

### Test 1: Backend (Port 5000)

From your laptop/browser:
```bash
curl http://34.72.13.202:5000/api/market/nifty-realtime
```

**Expected**: JSON response with market data (or error if no API key)

**If this fails**: Backend not accessible externally → Check firewall

### Test 2: Breeze Proxy (Port 8081)

From your laptop/browser:
```bash
curl http://34.72.13.202:8081/
```

**Expected**: `{"status":"ok","service":"breeze-proxy","version":"1.0.0"}`

**If this fails**: Breeze proxy not accessible externally → Check firewall

### Test 3: Frontend (Port 8082)

From your laptop/browser:
```bash
curl http://34.72.13.202:8082/
```

**Expected**: HTML response with `<!DOCTYPE html>`

**If this fails**: 
- Frontend not running → Start it (see above)
- Firewall blocking → Check GCP firewall rules

---

## Common Issues & Solutions

### Issue 1: "localhost:5000 refused to connect"

**Why**: You're trying to access `localhost` from your laptop. `localhost` means "this computer" - your laptop, not the VM.

**Solution**: Use external IP instead: `http://34.72.13.202:5000`

### Issue 2: "34.72.13.202:8082 took too long to respond"

**Possible causes:**
1. **Frontend not running** (most common) → Start frontend (see above)
2. **Firewall blocking port 8082** → Check GCP firewall
3. **Frontend starting up** → Wait 30 seconds and try again

**Check if frontend is running:**
```bash
netstat -tuln | grep 8082
```

If no output → Frontend not running!

### Issue 3: "No logs in terminal"

**Why**: Frontend isn't running, so it's not making API calls.

**Solution**: Start the frontend. Once it starts making calls, you'll see logs like:
```
INFO:werkzeug:10.128.0.4 - - [02/Feb/2026 17:00:00] "GET /api/market/nifty-realtime HTTP/1.1" 200 -
```

### Issue 4: "npm: command not found"

**Solution**: Install Node.js:
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y nodejs npm

# Or use conda
conda install -c conda-forge nodejs
```

### Issue 5: Frontend shows "Cannot connect to backend"

**Cause**: VITE_API_URL not set or set incorrectly

**Solution**: Stop frontend (Ctrl+C), then:
```bash
export VITE_API_URL=http://34.72.13.202:5000
npm start
```

---

## Quick Diagnostic Script

Save this as `check-services.sh` and run it:

```bash
#!/bin/bash
echo "================================"
echo "Service Status Check"
echo "================================"
echo ""

echo "1. Checking Backend (port 5000)..."
if netstat -tuln | grep -q ':5000'; then
    echo "   ✅ Backend is RUNNING"
else
    echo "   ❌ Backend is NOT running"
    echo "   → Start: python app.py"
fi
echo ""

echo "2. Checking Breeze Proxy (port 8081)..."
if netstat -tuln | grep -q ':8081'; then
    echo "   ✅ Breeze Proxy is RUNNING"
else
    echo "   ❌ Breeze Proxy is NOT running"
    echo "   → Start: cd breeze-proxy && python breeze_proxy_app.py"
fi
echo ""

echo "3. Checking Frontend (port 8082)..."
if netstat -tuln | grep -q ':8082'; then
    echo "   ✅ Frontend is RUNNING"
else
    echo "   ❌ Frontend is NOT running"
    echo "   → Start: cd frontend && npm start"
fi
echo ""

echo "================================"
echo "External Connectivity Test"
echo "================================"
EXTERNAL_IP=$(curl -s ifconfig.me)
echo "Your external IP: $EXTERNAL_IP"
echo ""
echo "Test URLs (use from your laptop/browser):"
echo "  Frontend:      http://$EXTERNAL_IP:8082/"
echo "  Backend:       http://$EXTERNAL_IP:5000/api/market/nifty-realtime"
echo "  Breeze Proxy:  http://$EXTERNAL_IP:8081/"
```

Run it:
```bash
chmod +x check-services.sh
./check-services.sh
```

---

## Summary: What You Need to Do

1. ✅ Backend running - **You have this**
2. ✅ Breeze Proxy running - **You have this**
3. ❌ **START THE FRONTEND** - **You're missing this!**

```bash
# In a NEW terminal:
cd ~/Market-Intelligence-Testing/frontend
export VITE_API_URL=http://34.72.13.202:5000
npm start
```

Then access: **http://34.72.13.202:8082/**

---

## Still Not Working?

Check:

1. **All three services running?**
   ```bash
   netstat -tuln | grep -E ':(5000|8081|8082)'
   ```
   Should see all three ports!

2. **Firewall rules configured?**
   ```bash
   gcloud compute firewall-rules list | grep -E '5000|8081|8082'
   ```
   Should see rules allowing these ports!

3. **Frontend configured for external IP?**
   ```bash
   echo $VITE_API_URL
   ```
   Should show: `http://34.72.13.202:5000`

If all checks pass and it still doesn't work, check browser console (F12) for detailed error messages.
