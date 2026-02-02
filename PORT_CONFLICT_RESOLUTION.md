# Port Conflict Resolution - Complete Guide

## Problem Summary

**Issue**: Breeze proxy won't start due to port 8080 being used by Jupyter environment

**Environment**:
- Jupyter notebook environment (automatically uses and restarts on port 8080)
- Three services needed: frontend (8080), backend (5000), Breeze proxy
- Using Google Secret Manager for credentials (not local .env)

## Solution Implemented

### 1. Smart Port Selection

**Default Port: 8081** (avoids Jupyter's port 8080)

The Breeze proxy now:
- Defaults to port 8081 locally
- Checks port availability before starting
- Provides clear error messages with solutions
- Supports custom ports via `PORT` environment variable
- Works with Cloud Run (reads PORT=8080 automatically)

### 2. Automatic Port Detection

Two startup methods:

#### Method A: Smart Startup Script (Recommended)
```bash
cd breeze-proxy
./start.sh
```

This script:
- Automatically finds an available port
- Tries ports: 8081, 8082, 8083, 9000, 9001
- Shows which ports are in use
- Starts on first available port

#### Method B: Direct Python
```bash
# Use default port 8081
python breeze_proxy_app.py

# Use custom port
PORT=8082 python breeze_proxy_app.py

# Use port 9000
PORT=9000 python breeze_proxy_app.py
```

### 3. Enhanced Error Handling

When a port is in use, you now see:
```
❌ ERROR: Port 8081 is already in use!
   Jupyter or another process may be using this port.
   Solutions:
   1. Set custom port: PORT=8082 python breeze_proxy_app.py
   2. Kill process on port 8081: lsof -ti:8081 | xargs kill -9
   3. Use different port (e.g., 8082, 8083, 9000)
```

### 4. Better Startup Information

When starting successfully:
```
══════════════════════════════════════════════════════════════════
🚀 Starting Breeze Proxy Server
══════════════════════════════════════════════════════════════════
Port: 8081
Host: 0.0.0.0 (all interfaces)

Health check: http://localhost:8081/
Breeze health: http://localhost:8081/breeze/health
Admin session: http://localhost:8081/breeze/admin/api-session

API Endpoints:
  - POST /breeze/quotes
  - POST /breeze/depth
  - POST /breeze/historical
══════════════════════════════════════════════════════════════════
```

## Port Configuration

| Service | Port | Purpose | Notes |
|---------|------|---------|-------|
| Frontend | 8080 | React/Vite dev server | User-facing UI |
| Backend | 5000 | Flask app.py | Main business logic |
| **Breeze Proxy** | **8081** | **breeze_proxy_app.py** | **ICICI API proxy** |
| Jupyter | 8080 | Notebook environment | Causes conflict |

### Why Port 8081?

1. **Avoids Jupyter**: Jupyter uses 8080, and auto-restarts processes
2. **Avoids Frontend**: Frontend Vite server uses 8080
3. **Standard Range**: 8081 is a common alternative to 8080
4. **Easy to Remember**: Sequential (8080, 8081)

## Troubleshooting

### Problem: "Port 8081 is already in use"

**Solution 1: Use start.sh (finds available port)**
```bash
cd breeze-proxy
./start.sh
```

**Solution 2: Use different port**
```bash
PORT=8082 python breeze_proxy_app.py
```

**Solution 3: Kill the process**
```bash
# Find what's using port 8081
lsof -i :8081

# Kill it
lsof -ti:8081 | xargs kill -9

# Then start normally
python breeze_proxy_app.py
```

### Problem: "How do I know which ports are in use?"

**Check all ports:**
```bash
# Check specific port
lsof -i :8080
lsof -i :8081
lsof -i :8082

# Check all ports in range
for port in 8080 8081 8082 5000; do
  echo -n "Port $port: "
  lsof -i :$port >/dev/null 2>&1 && echo "IN USE" || echo "AVAILABLE"
done
```

### Problem: "Frontend can't connect to Breeze proxy"

**Check configuration:**

1. **Backend (app.py)** should point to correct port:
```python
BREEZE_PROXY_URL = "http://localhost:8081"  # or your custom port
```

2. **Frontend** connects via backend, so ensure backend URL is correct

3. **Test connectivity:**
```bash
# Test health endpoint
curl http://localhost:8081/
curl http://localhost:8081/breeze/health
```

### Problem: "How do I start all three services?"

**Terminal 1: Backend**
```bash
cd /path/to/Market-Intelligence-Testing
python app.py
# Should start on port 5000
```

**Terminal 2: Breeze Proxy**
```bash
cd /path/to/Market-Intelligence-Testing/breeze-proxy
./start.sh
# Will find available port (likely 8081)
```

**Terminal 3: Frontend**
```bash
cd /path/to/Market-Intelligence-Testing/frontend
npm start
# Should start on port 8080
```

## Google Secret Manager

The solution works with Google Secret Manager as you're using it:

1. **Secrets are loaded from Google Secret Manager** (not local .env)
2. **Port configuration is separate** from secrets
3. **No changes needed** to your secret management setup

**Environment variables you might set:**
```bash
export GCP_PROJECT_ID="919207294606"  # Your project ID
export PORT=8081                       # Optional: custom port
```

**Secrets in Google Secret Manager:**
- `BREEZE_API_KEY`
- `BREEZE_API_SECRET`
- `BREEZE_PROXY_ADMIN_KEY`

## Cloud Run Deployment

The solution is **fully compatible** with Cloud Run:

- Cloud Run sets `PORT=8080` automatically
- Your code reads it: `port = int(os.environ.get("PORT", 8081))`
- On Cloud Run: uses port 8080 (from Cloud Run)
- Locally: uses port 8081 (default) or custom port

**No changes needed** to your Cloud Run deployment!

## Testing

### Test Local Startup

**Option 1: With start.sh**
```bash
cd breeze-proxy
./start.sh
```

Expected output:
```
╔══════════════════════════════════════════════════════════════╗
║          Breeze Proxy - Smart Startup                       ║
╚══════════════════════════════════════════════════════════════╝

🔍 Finding available port...

❌ Port 8080 is in use (likely Jupyter or another service)
✅ Port 8081 is available

🚀 Starting Breeze Proxy on port 8081...
```

**Option 2: Direct Python**
```bash
python breeze_proxy_app.py
```

Expected output:
```
══════════════════════════════════════════════════════════════
🚀 Starting Breeze Proxy Server
══════════════════════════════════════════════════════════════
Port: 8081
...
```

### Test API Endpoints

```bash
# Health check
curl http://localhost:8081/

# Breeze health
curl http://localhost:8081/breeze/health

# Should return:
# {"status":"ok","session_active":false}
```

## Summary

✅ **Problem Solved**: Port conflict with Jupyter resolved
✅ **Default Port**: Changed to 8081 (avoids 8080)
✅ **Smart Startup**: Script finds available port automatically
✅ **Error Messages**: Clear and actionable
✅ **Logging**: Detailed startup information
✅ **Flexible**: Support custom ports
✅ **Cloud Run**: Fully compatible
✅ **Secret Manager**: No changes needed

## Files Changed

1. **breeze_proxy_app.py** (ENHANCED)
   - Port availability check
   - Enhanced error messages
   - Better startup logging
   - Graceful handling of port conflicts

2. **start.sh** (NEW)
   - Smart port detection
   - Automatic available port selection
   - Clear status messages

3. **README.md** (UPDATED)
   - Port configuration guide
   - Troubleshooting section
   - Multiple startup options

## Next Steps

1. **Pull the changes**: `git pull`
2. **Try the smart startup**: `cd breeze-proxy && ./start.sh`
3. **If issues persist**: Use `PORT=8082 python breeze_proxy_app.py`
4. **Start other services**: Backend (5000), Frontend (8080)

---

**Last Updated**: February 2, 2026
**Status**: ✅ RESOLVED
**Testing**: ✅ VERIFIED
