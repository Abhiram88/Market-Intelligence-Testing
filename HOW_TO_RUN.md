# How to Run the Application

## Overview

This application consists of **THREE** services that must run simultaneously:

```
┌─────────────┐        ┌─────────────┐        ┌──────────────────┐
│  Frontend   │        │   Backend   │        │  Breeze Proxy    │
│  (Port 8080)│───────▶│ (Port 5000) │───────▶│  (Port 8081)     │
│             │  HTTP  │   app.py    │  HTTP  │ breeze_proxy_app │
│  React UI   │        │  Main API   │        │  ICICI API       │
└─────────────┘        └─────────────┘        └──────────────────┘
```

## Quick Start

### Option 1: Using the Startup Script (Recommended)

```bash
# Make the script executable (first time only)
chmod +x start-all.sh

# Start all services
./start-all.sh
```

This will open three terminal windows and start each service.

### Option 2: Manual Startup (Three Terminals)

**Terminal 1: Start Backend (Main API)**
```bash
# From repository root
python app.py

# Should see:
# * Running on http://0.0.0.0:5000
```

**Terminal 2: Start Breeze Proxy**
```bash
cd breeze-proxy
./start.sh   # Smart script that finds available port

# OR manually:
python breeze_proxy_app.py

# Should see:
# 🚀 Starting Breeze Proxy Server on port 8081
```

**Terminal 3: Start Frontend**
```bash
cd frontend
npm start    # or: npm run dev

# Should see:
# ➜  Local:   http://localhost:8080/
```

## What Each Service Does

### 1. Frontend (Port 8080)
**Purpose**: User interface for the application

**Technology**: React + TypeScript + Vite

**What it does**:
- Displays market data and charts
- Shows AI analysis results
- Provides monitoring dashboard
- Handles user interactions

**Connects to**: Backend API at `http://localhost:5000`

**How to start**:
```bash
cd frontend
npm install  # First time only
npm start
```

**Access**: http://localhost:8080

---

### 2. Backend / Main API (Port 5000)
**File**: `app.py` (in root directory)

**Purpose**: Main API server and middleware

**Technology**: Flask + Python

**What it does**:
- **Forwards requests** to Breeze Proxy
- **Integrates with Google Gemini AI** for market analysis
- **Manages Supabase database** connections
- **Provides unified API** for frontend
- **Handles business logic** and data processing

**API Endpoints**:
- `/api/market/*` - Market data (forwards to Breeze Proxy)
- `/api/gemini/*` - AI analysis (uses Gemini)
- `/api/breeze/*` - Breeze session management
- `/api/reg30/*` - Regulatory analysis

**Environment Variables**:
```bash
export API_KEY="your-gemini-api-key"
export BREEZE_PROXY_SERVICE_URL="http://localhost:8081"  # or Cloud Run URL
export SUPABASE_URL="your-supabase-url"
export SUPABASE_SERVICE_ROLE_KEY="your-supabase-key"
```

**How to start**:
```bash
# From repository root
python app.py
```

**Access**: http://localhost:5000

---

### 3. Breeze Proxy (Port 8081)
**File**: `breeze-proxy/breeze_proxy_app.py`

**Purpose**: Direct interface to ICICI Breeze API

**Technology**: Flask + Python + breeze_connect library

**What it does**:
- **Manages ICICI Breeze API sessions**
- **Fetches live market data** from ICICI
- **Stores secrets** in Google Secret Manager
- **Provides clean REST API** for Breeze operations

**API Endpoints**:
- `/health` - Health check
- `/breeze/admin/api-session` - Set session token
- `/breeze/quotes` - Get stock quotes
- `/breeze/depth` - Get market depth
- `/breeze/historical` - Get historical data

**How to start**:
```bash
cd breeze-proxy
./start.sh    # Finds available port automatically
```

**Access**: http://localhost:8081

---

## Architecture Flow

### Request Flow Example: Getting a Stock Quote

1. **User** clicks on stock in frontend
2. **Frontend** sends request: `POST http://localhost:8080/api/market/quote`
3. **Vite proxy** forwards to: `http://localhost:5000/api/market/quote`
4. **Backend (app.py)** receives request
5. **Backend** forwards to: `http://localhost:8081/breeze/quotes`
6. **Breeze Proxy** fetches from ICICI Breeze API
7. **Breeze Proxy** returns data to Backend
8. **Backend** processes and returns to Frontend
9. **Frontend** displays data to user

### Why Three Services?

**Separation of Concerns**:
1. **Frontend**: User interface only, no business logic
2. **Backend**: Business logic, AI integration, database
3. **Breeze Proxy**: ICICI API interface, session management

**Benefits**:
- Each service can be deployed independently
- Breeze Proxy can be on Cloud Run (shared by multiple apps)
- Frontend can be static site
- Backend can scale independently
- Easier to maintain and debug

---

## Troubleshooting

### Problem: Backend can't connect to Breeze Proxy

**Solution**: Make sure Breeze Proxy is running first
```bash
# Check if Breeze Proxy is running
curl http://localhost:8081/health

# Should return: {"status":"ok","session_active":false}
```

### Problem: Frontend shows "Network Error"

**Solution**: Make sure Backend is running
```bash
# Check if Backend is running
curl http://localhost:5000/api/market/nifty-realtime

# Should return market data or error message
```

### Problem: Port already in use

**Solutions**:
```bash
# Check what's using ports
lsof -i :8080  # Frontend
lsof -i :5000  # Backend
lsof -i :8081  # Breeze Proxy

# Kill process on port
lsof -ti:8080 | xargs kill -9

# Use different ports
PORT=8082 python breeze_proxy_app.py
```

### Problem: Module not found errors

**Solutions**:
```bash
# Install Python dependencies
pip install flask flask-cors requests google-genai supabase pytz breeze-connect

# Install frontend dependencies
cd frontend
npm install
```

---

## Development Workflow

### Full Development Setup

```bash
# 1. Clone repository
git clone <repository-url>
cd Market-Intelligence-Testing

# 2. Install Python dependencies
pip install flask flask-cors requests google-genai supabase pytz breeze-connect

# 3. Install frontend dependencies
cd frontend
npm install
cd ..

# 4. Set environment variables
export API_KEY="your-gemini-api-key"
export BREEZE_PROXY_SERVICE_URL="http://localhost:8081"
export SUPABASE_URL="your-supabase-url"
export SUPABASE_SERVICE_ROLE_KEY="your-supabase-key"
export GCP_PROJECT_ID="your-gcp-project-id"

# 5. Start services (three terminals)
# Terminal 1: Backend
python app.py

# Terminal 2: Breeze Proxy
cd breeze-proxy && ./start.sh

# Terminal 3: Frontend
cd frontend && npm start
```

### Making Changes

**Frontend Changes**:
- Edit files in `frontend/src/` or `frontend/components/`
- Vite hot-reload will update automatically
- No restart needed

**Backend Changes**:
- Edit `app.py`
- Restart: `Ctrl+C` then `python app.py`

**Breeze Proxy Changes**:
- Edit `breeze-proxy/breeze_proxy_app.py`
- Restart: `Ctrl+C` then `./start.sh`

---

## Production Deployment

### Cloud Run Deployment

**Breeze Proxy**:
```bash
cd breeze-proxy
./deploy.sh
# Deployed to: https://maia-breeze-proxy-service-919207294606.us-central1.run.app
```

**Backend**:
```bash
# Deploy app.py to Cloud Run or App Engine
# Update BREEZE_PROXY_SERVICE_URL to Cloud Run URL
```

**Frontend**:
```bash
cd frontend
npm run build
# Deploy dist/ folder to Cloud Storage, Netlify, or Vercel
# Update VITE_API_URL to point to deployed backend
```

---

## Environment Variables Summary

### Backend (app.py)
```bash
API_KEY                      # Google Gemini API key
BREEZE_PROXY_SERVICE_URL     # URL of Breeze Proxy (default: Cloud Run URL)
SUPABASE_URL                 # Supabase project URL
SUPABASE_SERVICE_ROLE_KEY    # Supabase service role key
```

### Breeze Proxy
```bash
PORT                         # Port to run on (default: 8081)
GCP_PROJECT_ID              # Google Cloud project ID for Secret Manager
BREEZE_API_KEY              # Stored in Secret Manager
BREEZE_API_SECRET           # Stored in Secret Manager
BREEZE_PROXY_ADMIN_KEY      # Stored in Secret Manager
```

### Frontend
```bash
VITE_API_URL                # Backend URL (default: http://localhost:5000)
VITE_SUPABASE_URL           # Supabase URL for direct access
VITE_SUPABASE_ANON_KEY      # Supabase anonymous key
```

---

## Quick Reference

| Service | Port | File | Purpose |
|---------|------|------|---------|
| Frontend | 8080 | `frontend/` | React UI |
| Backend | 5000 | `app.py` | Main API + AI |
| Breeze Proxy | 8081 | `breeze-proxy/breeze_proxy_app.py` | ICICI API |

**Health Checks**:
- Frontend: http://localhost:8080
- Backend: http://localhost:5000/api/market/nifty-realtime
- Breeze Proxy: http://localhost:8081/health

**Start Commands**:
```bash
python app.py                    # Backend
cd breeze-proxy && ./start.sh    # Breeze Proxy
cd frontend && npm start          # Frontend
```

---

## Next Steps

1. ✅ Start all three services
2. ✅ Open http://localhost:8080 in browser
3. ✅ Configure Breeze session (if needed)
4. ✅ Start using the application!

For more details, see:
- `PORT_CONFLICT_RESOLUTION.md` - Port troubleshooting
- `breeze-proxy/README.md` - Breeze Proxy details
- `ARCHITECTURE.md` - System architecture (if exists)
