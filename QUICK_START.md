# Quick Answer: How to Run the Application

## TL;DR - The Short Answer

You need to run **THREE** services simultaneously:

```bash
# Terminal 1
python app.py

# Terminal 2  
cd breeze-proxy && ./start.sh

# Terminal 3
cd frontend && npm start
```

Or just run: `./start-all.sh` (does it all automatically)

---

## Why Three Services?

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  YOU → Frontend → Backend → Breeze Proxy → ICICI Breeze     │
│        (8080)     (5000)     (8081)         (Cloud)         │
│                                                              │
│        React UI   app.py    Bridge to      Market Data     │
│                   + AI       ICICI API                      │
│                   + DB                                      │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## What Each File Does

### 1. Frontend (`frontend/` directory)
**What**: The user interface you see in your browser  
**Port**: 8080  
**Start**: `cd frontend && npm start`  
**Access**: http://localhost:8080

### 2. Backend (`app.py` in root)
**What**: The main API server that:
- Talks to Gemini AI for analysis
- Manages the database (Supabase)
- Forwards market data requests to Breeze Proxy
- Provides `/api/` endpoints for the frontend

**Port**: 5000  
**Start**: `python app.py`  
**Why needed**: Without this, frontend has no one to talk to!

### 3. Breeze Proxy (`breeze-proxy/breeze_proxy_app.py`)
**What**: The bridge to ICICI Breeze API
- Manages ICICI API sessions
- Fetches real market data
- Handles credentials securely

**Port**: 8081  
**Start**: `cd breeze-proxy && ./start.sh`  
**Why needed**: Without this, no market data!

---

## Common Questions

### Q: Can I just run the frontend?
**A**: No! Frontend needs the backend (`app.py`) to get data.

### Q: What if I only run frontend + app.py?
**A**: It will work partially, but market data won't load (needs Breeze Proxy).

### Q: What's the minimum to see something?
**A**: All three services. They work together as a team.

### Q: What happened to app.py? Why is it there?
**A**: `app.py` is your **main backend server**! It:
- Processes all API requests from the frontend
- Integrates with Gemini AI
- Manages your database
- Routes market data requests to Breeze Proxy

It's the "brain" of the application.

---

## Real Example: Getting NIFTY Data

1. **User** opens browser → `http://localhost:8080`
2. **Frontend** loads, shows dashboard
3. **Frontend** requests NIFTY data: `GET /api/market/nifty-realtime`
4. **Vite proxy** forwards to: `http://localhost:5000/api/market/nifty-realtime`
5. **Backend (app.py)** receives request
6. **Backend** forwards to: `http://localhost:8081/breeze/quotes`
7. **Breeze Proxy** fetches from ICICI Breeze API
8. **Breeze Proxy** returns data to Backend
9. **Backend** adds AI analysis (Gemini)
10. **Backend** returns to Frontend
11. **Frontend** displays to User

**All three services needed for this to work!**

---

## Troubleshooting

### "I ran npm start but see errors"
→ Did you start the backend first? Run `python app.py`

### "Backend says can't connect to Breeze Proxy"
→ Start Breeze Proxy: `cd breeze-proxy && ./start.sh`

### "Everything is running but no data"
→ Check all three terminals are showing "Running on..." messages

### "Too confusing with three terminals"
→ Use the startup script: `./start-all.sh`

---

## Summary Table

| What | Where | Port | Start Command |
|------|-------|------|---------------|
| Frontend (UI) | `frontend/` | 8080 | `npm start` |
| Backend (API) | `app.py` | 5000 | `python app.py` |
| Breeze Proxy | `breeze-proxy/` | 8081 | `./start.sh` |

**All three are required!**

---

## For More Details

- **Complete guide**: `HOW_TO_RUN.md`
- **Port conflicts**: `PORT_CONFLICT_RESOLUTION.md`
- **Architecture deep dive**: See `HOW_TO_RUN.md` → Architecture section

---

**Bottom Line**: Run all three services, then open http://localhost:8080 🚀
