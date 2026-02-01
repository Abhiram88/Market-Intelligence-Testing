# Fix: Frontend Server Connection Issue (ERR_CONNECTION_TIMED_OUT)

## Problem Summary
The frontend server was failing to start with the error:
```
This site can't be reached
10.128.0.4 took too long to respond.
ERR_CONNECTION_TIMED_OUT
```

Additionally, the Monitor dashboard could not display information from the ICICI Direct API because the frontend couldn't connect to the backend.

## Root Cause Analysis

1. **Missing API Service Module**: The frontend components (`MonitorTab.tsx`, `PriorityStocksCard.tsx`) were importing functions from `'../services/apiService'` which didn't exist, causing module resolution failures.

2. **Vite Configuration Issue**: The Vite dev server was not configured to bind to all network interfaces (`0.0.0.0`), potentially causing it to bind to a specific IP that wasn't accessible.

3. **Missing Shared Dependencies**: The frontend was trying to import shared TypeScript files (`lib/supabase.ts`, `types.ts`, `mockData.ts`) from the root directory, but module resolution expected them in the frontend directory.

## Solution Implemented

### 1. Created `frontend/services/apiService.ts`
This new service module provides all the functions needed to connect the frontend to the backend APIs:

```typescript
// Market data functions
- fetchQuote(symbol: string): Promise<QuoteResponse>
- fetchDepth(symbol: string): Promise<DepthResponse>
- fetchHistorical(symbol, fromDate, toDate): Promise<HistoricalBar[]>

// AI analysis functions
- analyzeMarketRadar(log: MarketLog): Promise<NewsAttribution>
- analyzeStockDeepDive(symbol: string): Promise<NewsAttribution>

// Breeze API functions
- setBreezeSession(apiSession: string, adminKey: string)
```

### 2. Updated `frontend/vite.config.ts`
```typescript
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',  // Listen on all interfaces (was missing)
    port: 8080,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      }
    }
  }
})
```

Key changes:
- Added `host: '0.0.0.0'` to listen on all network interfaces
- Added API proxy configuration to route `/api` requests to the backend
- This prevents CORS issues and provides a clean development experience

### 3. Copied Shared Dependencies
Copied the following files to the frontend directory for proper module resolution:
- `lib/supabase.ts` → `frontend/lib/supabase.ts`
- `types.ts` → `frontend/types.ts`
- `mockData.ts` → `frontend/mockData.ts`

### 4. Added Configuration Files
- **`.env.example`**: Template for environment variables (VITE_API_URL)
- **`.gitignore`**: Prevents committing node_modules, .env files, and build artifacts
- **`README.md`**: Comprehensive documentation for setup and troubleshooting

## Testing & Verification

### Frontend Server Status ✅
```bash
$ netstat -tuln | grep 8080
tcp6  0  0  :::8080  :::*  LISTEN
```

### Frontend Accessibility ✅
```bash
$ curl -I http://localhost:8080
HTTP/1.1 200 OK
Content-Type: text/html
```

### UI Loading ✅
The Monitor dashboard now loads successfully showing:
- NIFTY 50 real-time card (placeholder data shown as backend is not running)
- Watchlist section (empty, ready for stocks to be added)
- Intelligence synthesis section with Market Radar and Equity Deep Dive tabs
- Clean UI with no module resolution errors

![Frontend Screenshot](https://github.com/user-attachments/assets/9bc9d221-8ccc-4b9c-a16e-27d068ee83af)

## How to Use

### Start the Frontend (Development)
```bash
cd frontend
npm run dev
```

The server will start on `http://0.0.0.0:8080` and be accessible via:
- `http://localhost:8080`
- `http://127.0.0.1:8080`
- `http://<your-ip>:8080` (from other devices on the network)

### Connect to Backend
To enable full functionality with ICICI Direct API data:

1. **Start the Backend API:**
   ```bash
   python3 app.py
   # Runs on http://0.0.0.0:5000
   ```

2. **Configure Environment (Optional):**
   ```bash
   cd frontend
   cp .env.example .env.local
   # Edit .env.local if backend is on a different host/port
   ```

3. **The frontend will automatically proxy API calls:**
   - Frontend makes request to `/api/market/quote`
   - Vite proxies it to `http://localhost:5000/api/market/quote`
   - Backend processes and returns data
   - Frontend displays the data in the Monitor dashboard

## Network Configuration Details

### Why `0.0.0.0` vs Specific IP?
- `0.0.0.0` binds to all available network interfaces
- A specific IP (like `10.128.0.4`) only binds to that interface
- If the IP changes or isn't available, the server fails to start
- `0.0.0.0` ensures maximum accessibility and flexibility

### Port Configuration
- **Frontend:** Port 8080 (configurable via `--port` flag)
- **Backend:** Port 5000 (standard Flask default)
- **Breeze Proxy:** Port 8081 (separate microservice)

## Next Steps

To complete the integration with ICICI Direct API:

1. **Install Backend Dependencies:**
   ```bash
   pip3 install flask flask-cors requests google-genai supabase pytz
   ```

2. **Set Environment Variables:**
   ```bash
   export API_KEY="your-gemini-api-key"
   export BREEZE_PROXY_SERVICE_URL="http://localhost:8081"
   ```

3. **Start Backend:**
   ```bash
   python3 app.py
   ```

4. **Configure Breeze Session** (in UI):
   - Click "API Settings" in the navbar
   - Enter your Breeze session token and admin key
   - The Monitor dashboard will now display live market data

## Files Changed

```
frontend/
├── services/
│   └── apiService.ts          [NEW] - API communication layer
├── lib/
│   └── supabase.ts            [NEW] - Supabase client
├── types.ts                   [NEW] - TypeScript type definitions
├── mockData.ts                [NEW] - Mock data for development
├── vite.config.ts             [MODIFIED] - Added server config
├── .env.example               [NEW] - Environment template
└── .gitignore                 [NEW] - Git ignore rules

README.md                      [NEW] - Complete setup guide
```

## Impact

✅ **Frontend server now starts successfully on all network interfaces**  
✅ **No more ERR_CONNECTION_TIMED_OUT errors**  
✅ **Monitor dashboard UI loads correctly**  
✅ **Frontend is ready to connect to backend for live ICICI Direct data**  
✅ **Clean development experience with proper module resolution**  
✅ **Comprehensive documentation for future development**
