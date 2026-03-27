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

### Breeze Proxy (`breeze-proxy/breeze_proxy_app.py`, ~1700 lines)
> **Reference copy only** — live code is in `https://github.com/Abhiram88/MAIA-Breeze-Proxy.git` on branch `copilot/fix-build-failure-backend-server`. Changes must be pushed there and deployed to Cloud Run manually.

Secure intermediary keeping ICICI Breeze API credentials server-side. Key responsibilities:
- BreezeConnect WebSocket client → tick queue → Socket.IO room dispatch (zero-latency pipeline for algo trading)
- Symbol mapping (hardcoded overrides + Supabase `nse_master_list` fallback)
- Reg30 Gemini analysis pipeline
- Session token management via `/api/breeze/admin/api-session`

**`DAILY_SESSION_TOKEN` is in-memory only** — resets on every Cloud Run restart/redeploy. User must re-enter via the key icon (BreezeTokenModal) in the app after each deploy.

### Frontend (`frontend/src/`)
Tab-based SPA: **MonitorTab** (real-time watchlist, Nifty streaming, order book), **ResearchTab** (Gemini stock deep-dive), **Reg30Tab** (regulatory filing analysis).

Key services:
- `services/apiService.ts` — REST client for backend
- `services/breezeService.ts` — Breeze symbol mapping + health checks
- `services/reg30Service.ts` — NSE filing parsing (XBRL/iXBRL text extraction, symbol detection)
- `services/reg30GeminiService.ts` — Reg30-specific Gemini analysis
- `lib/supabase.ts` — Supabase client

### Database (Supabase — `public` schema)

**Event Analysis Pipeline:**
| Table | Purpose |
|---|---|
| `ingestion_runs` | Tracks each data ingestion run |
| `event_candidates` | Raw candidate events (FK → `ingestion_runs`) |
| `analyzed_events` | Analyzed events with confidence/impact scores (FK → `ingestion_runs`, `event_candidates`) |
| `historical_event_analysis` | Full historical event analysis with pre/post price data (53 cols) |
| `event_price_history` | Price snapshots linked to events (FK → `historical_event_analysis`) |
| `event_processing_queue` | Retry queue for event processing (FK → `historical_event_analysis`) |
| `processing_logs` | Processing log entries (FK → `historical_event_analysis`) |
| `pattern_statistics` | Statistical analysis of trading patterns |

**Market Data:**
| Table | Purpose |
|---|---|
| `market_logs` | Daily NIFTY index data |
| `news_attribution` | AI-attributed news → market movements (FK → `market_logs`) |
| `ledger_events` | Market ledger entries with sentiment score, affected stocks/sectors (arrays) |
| `ledger_sources` | Source links for ledger events (FK → `ledger_events`) |
| `volatile_queue` | Volatile market condition queue (PK: `log_date`) |

**Reference & Support:**
| Table | Purpose |
|---|---|
| `nse_master_list` | NSE symbol mappings; PK is `short_name` (text), not UUID |
| `priority_stocks` | Priority watchlist stocks |
| `gemini_cache` | Cache for Gemini API responses |
| `research_status` | Research system status tracking |
| `iq_schema_meta` | Schema version metadata |

**Key schema notes:**
- All major tables use UUID PKs (`gen_random_uuid()`), except `nse_master_list` (PK: `short_name`) and `volatile_queue` (PK: `log_date`)
- `analyzed_events.event_fingerprint` is a deduplication key (NOT NULL)
- `historical_event_analysis` tracks full price timeline: `price_30d_before` → `price_90d_after`, plus returns (`return_7d_pct`, `return_30d_pct`, `return_90d_pct`) and volume analysis
- `event_processing_queue` has `retry_count` / `max_retries` (default 3) for resilience
- `ledger_events.affected_stocks` and `affected_sectors` are `text[]` arrays

## Key Patterns

**Symbol Mapping**: NSE tokens → Breeze trading codes. Same hardcoded map exists in frontend, main backend, and proxy. Supabase `nse_master_list` is the fallback. The proxy uses module-level caching to avoid repeated Supabase lookups (HTTP 406 errors from multiple row matches).

**Real-time Data Flow**: BreezeConnect WebSocket → proxy tick queue → Socket.IO rooms per symbol → frontend `subscribe_to_watchlist` events.

**AI Pipeline**: Raw text/symbol → Gemini (with Google Search tool) → JSON extracted from response → stored in Supabase `news_attribution`.

**Market Hours**: IST timezone check (9:00 AM–3:30 PM weekdays). Closed market falls back to Supabase cached data.

**Reg30 Analysis**: NSE filing text → regex symbol/company extraction → Gemini forensic audit with structured JSON schema → Supabase persistence.

## Deployment

- **Frontend**: Netlify (`frontend/dist`, SPA redirect configured)
- **Breeze Proxy**: Google Cloud Run (eventlet/gunicorn worker) — source at https://github.com/Abhiram88/MAIA-Breeze-Proxy.git
- **Main API**: Not containerized; run directly or behind a process manager
