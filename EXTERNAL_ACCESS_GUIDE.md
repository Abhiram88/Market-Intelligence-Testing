# External IP Access Guide

## Problem

You're trying to access the application from `http://34.72.13.202:8082/` but getting:
```
This site can't be reached
34.72.13.202 took too long to respond
```

## Current Status

✅ **Services are running**:
- Backend: Port 5000 on 10.128.0.4
- Breeze Proxy: Port 8081 on 10.128.0.4
- Frontend: Port 8082 on 10.128.0.4

❌ **Problem**: Not accessible from external IP 34.72.13.202

## Why This Happens

When accessing via external IP, you need:

1. **Firewall rules** to allow traffic on ports 8082, 5000, 8081
2. **Correct frontend configuration** to point to external backend IP
3. **CORS configuration** in backend to allow external requests

## Solution

### Step 1: Configure GCP Firewall Rules

You need to allow incoming traffic on all three ports.

**Check existing firewall rules:**
```bash
gcloud compute firewall-rules list --format="table(name,targetTags,allowed)"
```

**Create firewall rules** (if not exist):

```bash
# Allow Frontend (port 8082)
gcloud compute firewall-rules create allow-frontend \
  --allow tcp:8082 \
  --source-ranges 0.0.0.0/0 \
  --description "Allow frontend access"

# Allow Backend (port 5000)
gcloud compute firewall-rules create allow-backend \
  --allow tcp:5000 \
  --source-ranges 0.0.0.0/0 \
  --description "Allow backend API access"

# Allow Breeze Proxy (port 8081)
gcloud compute firewall-rules create allow-breeze-proxy \
  --allow tcp:8081 \
  --source-ranges 0.0.0.0/0 \
  --description "Allow Breeze proxy access"
```

**Or allow multiple ports in one rule:**
```bash
gcloud compute firewall-rules create allow-market-intelligence \
  --allow tcp:5000,tcp:8081,tcp:8082 \
  --source-ranges 0.0.0.0/0 \
  --description "Allow Market Intelligence application"
```

**Verify firewall rules:**
```bash
gcloud compute firewall-rules describe allow-market-intelligence
```

### Step 2: Test Individual Services

**Test Backend:**
```bash
curl http://34.72.13.202:5000/api/market/nifty-realtime
```

**Test Breeze Proxy:**
```bash
curl http://34.72.13.202:8081/health
```

**Test Frontend:**
```bash
curl -I http://34.72.13.202:8082/
```

If these don't work, firewall rules are not properly configured.

### Step 3: Configure Frontend for External Access

The frontend needs to know the external IP of the backend.

**Option A: Use Environment Variable**

Create `frontend/.env.local`:
```bash
VITE_API_URL=http://34.72.13.202:5000
```

Then restart frontend:
```bash
cd frontend
npm start
```

**Option B: Update vite.config.ts**

Edit `frontend/vite.config.ts`:
```typescript
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 8082,  // Note: using 8082 since 8080 is busy
    proxy: {
      '/api': {
        target: 'http://10.128.0.4:5000',  // Use internal IP for proxy
        changeOrigin: true,
      }
    }
  }
})
```

### Step 4: Restart Services

After making changes:

```bash
# Stop all services (Ctrl+C in each terminal)

# Restart Backend
python app.py

# Restart Breeze Proxy
cd breeze-proxy && python breeze_proxy_app.py

# Restart Frontend
cd frontend && npm start
```

### Step 5: Access Application

Now try:
```
http://34.72.13.202:8082/
```

---

## Alternative: Use Port 8080 (Recommended)

Currently, frontend is on 8082 because 8080 was busy. Let's fix this:

**Find what's using port 8080:**
```bash
lsof -i :8080
```

**Kill the process:**
```bash
# Get the PID from lsof command above
lsof -ti:8080 | xargs kill -9
```

**Then restart frontend on 8080:**
```bash
cd frontend
npm start
# Should now run on 8080
```

**Update firewall for 8080:**
```bash
gcloud compute firewall-rules create allow-frontend-8080 \
  --allow tcp:8080 \
  --source-ranges 0.0.0.0/0 \
  --description "Allow frontend on port 8080"
```

**Access:**
```
http://34.72.13.202:8080/
```

---

## Debugging Steps

### 1. Check Services are Listening

```bash
# From the VM
netstat -tuln | grep -E ':(5000|8081|8082)'
```

Should show:
```
tcp6  0  0  :::5000   :::*  LISTEN
tcp6  0  0  :::8081   :::*  LISTEN  
tcp6  0  0  :::8082   :::*  LISTEN
```

### 2. Test Locally First

From the VM itself:
```bash
curl http://localhost:5000/api/market/nifty-realtime
curl http://localhost:8081/health
curl http://localhost:8082/
```

If these work but external IP doesn't → Firewall issue

### 3. Check Firewall Rules

```bash
# List all firewall rules
gcloud compute firewall-rules list

# Check specific ports
gcloud compute firewall-rules list --filter="allowed[]:8082"
gcloud compute firewall-rules list --filter="allowed[]:5000"
```

### 4. Check External IP

```bash
# Get your instance's external IP
gcloud compute instances describe instance-20260129-111240 \
  --zone=us-central1-a \
  --format="get(networkInterfaces[0].accessConfigs[0].natIP)"
```

Make sure this matches 34.72.13.202

### 5. Test from Another Machine

From your local machine (not the VM):
```bash
curl -v http://34.72.13.202:8082/
```

Look for:
- Connection timeout → Firewall blocking
- Connection refused → Service not running
- 200 OK → Working!

---

## Common Issues

### Issue 1: Firewall Rules Not Applied

**Solution**: Wait a few minutes or restart instance
```bash
sudo reboot
```

### Issue 2: Wrong External IP

**Solution**: Check the actual external IP
```bash
gcloud compute instances describe YOUR_INSTANCE_NAME \
  --zone=YOUR_ZONE \
  --format="get(networkInterfaces[0].accessConfigs[0].natIP)"
```

### Issue 3: VPN or Corporate Firewall

**Solution**: Your local network may block these ports. Try:
- Different network (mobile hotspot)
- VPN
- Use Cloud Shell to test

### Issue 4: Frontend Can't Reach Backend

**Solution**: Set VITE_API_URL environment variable
```bash
export VITE_API_URL=http://34.72.13.202:5000
cd frontend
npm start
```

---

## Production Setup (Recommended)

For production, don't expose ports directly. Instead:

### Option 1: Use Nginx Reverse Proxy

Install Nginx:
```bash
sudo apt-get update
sudo apt-get install nginx
```

Configure `/etc/nginx/sites-available/market-intelligence`:
```nginx
server {
    listen 80;
    server_name 34.72.13.202;

    # Frontend
    location / {
        proxy_pass http://localhost:8082;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Enable and restart:
```bash
sudo ln -s /etc/nginx/sites-available/market-intelligence /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

Then allow port 80:
```bash
gcloud compute firewall-rules create allow-http \
  --allow tcp:80 \
  --source-ranges 0.0.0.0/0 \
  --description "Allow HTTP"
```

Access: `http://34.72.13.202/`

### Option 2: Deploy to Cloud Run

This is what the Breeze Proxy already does. Deploy all services to Cloud Run for production.

See `breeze-proxy/deploy.sh` for example.

---

## Quick Fix Summary

**1. Add firewall rules:**
```bash
gcloud compute firewall-rules create allow-all-app-ports \
  --allow tcp:5000,tcp:8081,tcp:8082 \
  --source-ranges 0.0.0.0/0
```

**2. Verify services:**
```bash
netstat -tuln | grep -E ':(5000|8081|8082)'
```

**3. Test externally:**
```bash
curl http://34.72.13.202:8082/
```

**4. If frontend loads but no data:**
```bash
export VITE_API_URL=http://34.72.13.202:5000
cd frontend
npm start
```

---

## Current Setup Command

Based on your logs, run:

```bash
# 1. Create firewall rule
gcloud compute firewall-rules create allow-market-intelligence \
  --allow tcp:5000,tcp:8081,tcp:8082 \
  --source-ranges 0.0.0.0/0 \
  --description "Market Intelligence App"

# 2. Restart frontend with correct API URL
export VITE_API_URL=http://34.72.13.202:5000
cd ~/Market-Intelligence-Testing/frontend
npm start

# 3. Access
# Open browser: http://34.72.13.202:8082/
```

---

## Security Note

⚠️ **Warning**: Allowing `0.0.0.0/0` (all IPs) is not secure for production.

For production, restrict to specific IPs:
```bash
gcloud compute firewall-rules create allow-market-intelligence \
  --allow tcp:5000,tcp:8081,tcp:8082 \
  --source-ranges YOUR_IP/32 \
  --description "Market Intelligence App - Restricted"
```

Replace `YOUR_IP` with your actual IP address.

---

## Still Not Working?

Check these:

1. **Instance-level firewall** (some GCP setups have this):
```bash
sudo iptables -L -n
```

2. **Check if services are bound to 0.0.0.0**:
```bash
netstat -tuln | grep -E ':(5000|8081|8082)'
```
Should show `0.0.0.0` not `127.0.0.1`

3. **Check logs** for errors:
```bash
# Backend logs
tail -f /path/to/backend.log

# Check journalctl
sudo journalctl -u YOUR_SERVICE -f
```

4. **Contact me with**:
- Output of: `gcloud compute firewall-rules list`
- Output of: `netstat -tuln | grep -E ':(5000|8081|8082)'`
- Output of: `curl -v http://34.72.13.202:8082/`
