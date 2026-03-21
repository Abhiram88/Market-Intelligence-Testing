# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Market Attribution Intelligence — a financial analysis platform for Indian NSE/BSE equity markets. It combines real-time market data streaming (ICICI Breeze), AI-powered stock analysis (Google Gemini), and regulatory filing (Reg 30) event extraction.

## Development Commands

### Frontend (React + Vite, `frontend/`)
```bash
cd frontend
npm install
npm run dev       # Dev server on port 8082
npm run build     # TypeScript compile + Vite bundle
npm run lint      # ESLint
npm run preview   # Serve built dist
```

### Backend (Flask, root)
```bash
pip install -r requirements.txt
python app.py     # Flask-SocketIO on port 5000
```

### Breeze Proxy (Flask, `breeze-proxy/`)
```bash
pip install -r breeze-proxy/requirements.txt
python breeze-proxy/breeze_proxy_app.py  # Port 8080
```

### Environment Setup
Copy `.env.example` and fill in:
- `API_KEY` — Gemini (Vertex AI) API key
- `BREEZE_PROXY_URL` — Breeze proxy URL (Cloud Run or `http://localhost:8080`)
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — Supabase credentials
- `CORS_ORIGINS` — Comma-separated allowed origins (optional)

## Architecture

Three-tier system with a React SPA, a Flask main API, and a dedicated Breeze proxy:

```
Frontend (React, :8082)
    │
    ├─ /api/breeze/* ──→ Breeze Proxy (:8080) ──→ ICICI Breeze API
    │                         │                    (real-time ticks via WebSocket)
    ├─ /api/*        ──→ Main API (:5000)
    │                         │
    │                    Gemini AI API
    │                    Supabase (PostgreSQL)
    │
    └─ Direct (frontend): Supabase, @google/genai
```

**Frontend proxy** (configured in `vite.config.ts`): `/api/breeze/*` → `:8080`, `/api/*` → `:5000`.

### Main Backend (`app.py`)
- `/api/breeze/*` — proxies to Breeze proxy
- `/api/market/*` — Nifty real-time data, falls back to Supabase cache when market is closed
- `/api/gemini/*` — AI endpoints: `summarize_market_outlook`, `stock-deep-dive`, reg30 event analysis
- Socket.IO — real-time watchlist subscriptions

### Breeze Proxy (`breeze-proxy/breeze_proxy_app.py`, ~1450 lines)
Secure intermediary keeping ICICI Breeze API credentials server-side. Key responsibilities:
- BreezeConnect WebSocket client → tick queue → Socket.IO room dispatch
- Symbol mapping (hardcoded overrides + Supabase `nse_master_list` fallback)
- Reg30 Gemini analysis pipeline
- Session token management via `/api/breeze/admin/api-session`

### Frontend (`frontend/src/`)
Tab-based SPA: **MonitorTab** (real-time watchlist, Nifty streaming, order book), **ResearchTab** (Gemini stock deep-dive), **Reg30Tab** (regulatory filing analysis).

Key services:
- `services/apiService.ts` — REST client for backend
- `services/breezeService.ts` — Breeze symbol mapping + health checks
- `services/reg30Service.ts` — NSE filing parsing (XBRL/iXBRL text extraction, symbol detection)
- `services/reg30GeminiService.ts` — Reg30-specific Gemini analysis
- `lib/supabase.ts` — Supabase client

### Database (Supabase)
Key tables: `nse_master_list` (NSE→Breeze symbol mappings), `market_logs`, `news_attribution` (AI analysis results).

## Key Patterns

**Symbol Mapping**: NSE tokens → Breeze trading codes. Same hardcoded map exists in frontend, main backend, and proxy. Supabase `nse_master_list` is the fallback. The proxy uses module-level caching to avoid repeated Supabase lookups (HTTP 406 errors from multiple row matches).

**Real-time Data Flow**: BreezeConnect WebSocket → proxy tick queue → Socket.IO rooms per symbol → frontend `subscribe_to_watchlist` events.

**AI Pipeline**: Raw text/symbol → Gemini (with Google Search tool) → JSON extracted from response → stored in Supabase `news_attribution`.

**Market Hours**: IST timezone check (9:00 AM–3:30 PM weekdays). Closed market falls back to Supabase cached data.

**Reg30 Analysis**: NSE filing text → regex symbol/company extraction → Gemini forensic audit with structured JSON schema → Supabase persistence.

## Deployment

- **Frontend**: Netlify (`frontend/dist`, SPA redirect configured)
- **Breeze Proxy**: Google Cloud Run (eventlet/gunicorn worker)
- **Main API**: Not containerized; run directly or behind a process manager
