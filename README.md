# Market Intelligence Testing

A real-time market intelligence dashboard for Indian equities using ICICI Direct API and Gemini AI.

## Architecture

- **Frontend**: React + TypeScript + Vite (Port 8080)
- **Backend API**: Flask (Port 5000)
- **Breeze Proxy**: Flask (Port 8081 - separate service)
- **Database**: Supabase
- **AI**: Google Gemini 2.5

## Issue Fixed: ERR_CONNECTION_TIMED_OUT

### Problem
The frontend server was trying to bind to a specific IP (10.128.0.4) which was causing connection timeouts. Additionally, the `apiService.ts` file that connects the frontend to the backend was missing.

### Solution
1. **Created `frontend/services/apiService.ts`**: This file provides all the functions needed to connect the frontend to the backend APIs (quotes, depth, historical data, AI analysis).

2. **Updated `frontend/vite.config.ts`**: Configured Vite to:
   - Bind to `0.0.0.0` (all network interfaces) instead of a specific IP
   - Listen on port 8080
   - Proxy `/api` requests to the backend at `http://localhost:5000`

3. **Added environment configuration**: Created `.env.example` to allow customization of the backend API URL.

## Quick Start

### Prerequisites
- Node.js 18+ (for frontend)
- Python 3.8+ (for backend)
- ICICI Direct Breeze API credentials
- Google Gemini API key

### 1. Install Frontend Dependencies

```bash
cd frontend
npm install
```

### 2. Install Backend Dependencies

```bash
# Install Python dependencies
pip3 install flask flask-cors requests google-genai supabase pytz
```

### 3. Configure Environment Variables

#### Frontend (Optional)
```bash
cd frontend
cp .env.example .env.local
# Edit .env.local if you want to customize the backend URL
```

#### Backend
Create environment variables or export them:
```bash
export API_KEY="your-gemini-api-key"
export BREEZE_PROXY_SERVICE_URL="http://localhost:8081"
# Optional: Override defaults
export SUPABASE_URL="your-supabase-url"
export SUPABASE_SERVICE_ROLE_KEY="your-supabase-key"
```

### 4. Start the Servers

#### Option A: Start individually (Recommended for development)

**Terminal 1 - Backend API:**
```bash
cd /path/to/Market-Intelligence-Testing
python3 app.py
# Server starts on http://0.0.0.0:5000
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
# Server starts on http://0.0.0.0:8080
```

**Terminal 3 - Breeze Proxy (Optional - if using live data):**
```bash
cd breeze-proxy
python3 breeze_proxy_app.py
# Server starts on http://0.0.0.0:8081
```

#### Option B: Simple startup script

Create a file `start-dev.sh`:
```bash
#!/bin/bash
# Start backend
cd "$(dirname "$0")"
python3 app.py &
BACKEND_PID=$!

# Start frontend
cd frontend
npm run dev &
FRONTEND_PID=$!

echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"
echo "Frontend: http://localhost:8080"
echo "Backend: http://localhost:5000"
echo "Press Ctrl+C to stop all servers"

# Wait for Ctrl+C
trap "kill $BACKEND_PID $FRONTEND_PID; exit" INT
wait
```

Make it executable and run:
```bash
chmod +x start-dev.sh
./start-dev.sh
```

### 5. Access the Dashboard

Open your browser and navigate to:
```
http://localhost:8080
```

The frontend will now properly connect to the backend at `http://localhost:5000`.

## Network Configuration

### Vite Server Configuration
The Vite server is now configured in `frontend/vite.config.ts` to:
```typescript
server: {
  host: '0.0.0.0',  // Listen on all interfaces
  port: 8080,
  proxy: {
    '/api': {
      target: 'http://localhost:5000',
      changeOrigin: true,
    }
  }
}
```

This means:
- The server is accessible from any IP address (localhost, 127.0.0.1, your machine's IP)
- API calls are proxied to the backend, avoiding CORS issues
- You can access it via `http://localhost:8080` or `http://<your-ip>:8080`

## API Endpoints

### Backend (Port 5000)

#### Market Data
- `POST /api/market/quote` - Get real-time quote for a symbol
- `POST /api/market/depth` - Get market depth for a symbol
- `POST /api/market/historical` - Get historical data for a symbol
- `GET /api/market/nifty-realtime` - Get Nifty 50 real-time data

#### AI Analysis
- `POST /api/gemini/analyze_market_log` - Analyze market movements with AI
- `POST /api/gemini/stock-deep-dive` - Deep dive analysis on a stock

#### Breeze API
- `POST /api/breeze/admin/api-session` - Set daily Breeze session

## Troubleshooting

### Frontend not accessible
1. Check if Vite is running: `ps aux | grep vite`
2. Check if port 8080 is listening: `netstat -tuln | grep 8080`
3. Try accessing: `curl http://localhost:8080`

### Backend not accessible
1. Check if Flask is running: `ps aux | grep python3.*app.py`
2. Check if port 5000 is listening: `netstat -tuln | grep 5000`
3. Try accessing: `curl http://localhost:5000/api/health`

### API Connection Errors
1. Check that backend is running before starting frontend
2. Verify API_URL in frontend `.env.local` (defaults to http://localhost:5000)
3. Check browser console for specific error messages
4. Ensure CORS is properly configured in the backend

### Breeze API Errors
1. Ensure Breeze proxy is running if using live data
2. Set the session token in the UI Settings
3. Check that BREEZE_PROXY_SERVICE_URL environment variable is correct

## Development Notes

- The frontend uses Vite's proxy feature to avoid CORS issues during development
- All API calls from frontend go through the `/api` prefix which is proxied to the backend
- The `apiService.ts` file centralizes all API communication logic
- Market data updates are throttled to avoid rate limiting

## License

[Your License Here]
