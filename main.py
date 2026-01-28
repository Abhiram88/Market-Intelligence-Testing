
import os
import json
import time
import requests
import datetime
import pytz
from flask import Flask, request, jsonify
from flask_cors import CORS
from google import genai
from google.genai import types
from supabase import create_client, Client

app = Flask(__name__)
# Contract Alignment: Enable CORS for your React frontend
CORS(app, resources={r"/api/*": {"origins": "*"}})

# --- Configuration & Environment ---
GCP_PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "gen-lang-client-0751458856")

# Use BREEZE_PROXY_URL to match your deployment command
# Ensure the fallback points to your actual us-central1 service if possible
BREEZE_PROXY_URL = os.environ.get("BREEZE_PROXY_URL", "https://maia-breeze-proxy-service-919207294606.us-central1.run.app").rstrip("/")
VERTEX_LOCATION = os.environ.get("VERTEX_LOCATION", "us-central1")

# --- Global Cache for Performance ---
_cache = {}

def fetch_secret(name):
    """Retrieve secrets from environment or Secret Manager (simulated)."""
    # In this environment, we use environment variables
    val = os.environ.get(name)
    if val: return val
    return ""

# --- Supabase & Mapping Logic ---
def get_supabase() -> Client:
    if "supabase" not in _cache:
        url = os.environ.get("SUPABASE_URL", "https://xbnzvmgawikqzxutmoea.supabase.co")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "sb_publishable_8TYnAzAX4s-CHAPVOpmLEA_Puqwcuwo")
        _cache["supabase"] = create_client(url, key)
    return _cache["supabase"]

def get_breeze_short_name(symbol: str) -> str:
    """Map NSE symbol to Breeze short_name using your nse_master_list table."""
    sym = symbol.strip().upper()
    if f"map_{sym}" in _cache:
        return _cache[f"map_{sym}"]

    sb = get_supabase()
    try:
        resp = sb.table("nse_master_list").select("short_name").eq("symbol", sym).maybe_single().execute()
        if resp.data and resp.data.get("short_name"):
            short_name = resp.data["short_name"].strip().upper()
            _cache[f"map_{sym}"] = short_name
            return short_name
    except Exception as e:
        print(f"Supabase mapping failed for {sym}: {e}")
    
    return sym

def get_ist_now():
    return datetime.datetime.now(pytz.timezone('Asia/Kolkata'))

def is_market_open():
    now = get_ist_now()
    if now.weekday() >= 5: return False
    time_val = now.hour * 100 + now.minute
    return 900 <= time_val <= 1530

def extract_json(text):
    try:
        first_brace = text.find('{')
        last_brace = text.rfind('}')
        if first_brace != -1 and last_brace != -1:
            return json.loads(text[first_brace:last_brace + 1])
        return json.loads(text)
    except Exception as e:
        print(f"JSON Extraction Error: {e}")
        return None

# --- Proxy Communication Helper ---
def call_proxy(endpoint, payload, method="POST", headers=None):
    url = f"{BREEZE_PROXY_URL}/{endpoint.lstrip('/')}"
    try:
        if method == "POST":
            r = requests.post(url, json=payload, headers=headers, timeout=30)
        else:
            r = requests.get(url, headers=headers, timeout=30)
        return r.json(), r.status_code
    except Exception as e:
        return {"ok": False, "error": f"Proxy Communication Failed: {str(e)}"}, 502

# --- API Routes ---

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "maia-backend-intelligence"})

@app.route("/api/breeze/admin/api-session", methods=["POST"])
def admin_handshake():
    payload = request.get_json() or {}
    headers = {"X-Proxy-Admin-Key": os.environ.get("BREEZE_PROXY_ADMIN_KEY")}
    return call_proxy("breeze/admin/api-session", payload, headers=headers)

@app.route("/api/market/quote", methods=["POST"])
def get_market_quote():
    data = request.get_json() or {}
    symbol = data.get("symbol", data.get("stock_code", ""))
    payload = {
        "stock_code": get_breeze_short_name(symbol),
        "exchange_code": data.get("exchange_code", "NSE"),
        "product_type": data.get("product_type", "cash")
    }
    return call_proxy("breeze/quotes", payload)

@app.route("/api/market/depth", methods=["POST"])
def get_market_depth():
    data = request.get_json() or {}
    payload = {
        "stock_code": get_breeze_short_name(data.get("symbol", "")),
        "exchange_code": "NSE",
        "product_type": "cash"
    }
    return call_proxy("breeze/depth", payload)

@app.route("/api/market/nifty-realtime", methods=["GET"])
def get_nifty_realtime():
    if is_market_open():
        res, status = call_proxy("breeze/quotes", {"stock_code": "NIFTY"})
        if status == 200 and res.get("Success"):
            data = res["Success"]
            data["market_status"] = "LIVE_TRADING_SESSION"
            return jsonify(data), 200
    
    # Fallback to Supabase
    sb = get_supabase()
    last_log = sb.table('market_logs').select('*').order('log_date', desc=True).limit(1).maybe_single().execute()
    if last_log.data:
        log = last_log.data
        return jsonify({
            "last_traded_price": log['ltp'],
            "change": log['points_change'],
            "percent_change": log['change_percent'],
            "high": log['day_high'],
            "low": log['day_low'],
            "volume": log['volume'],
            "market_status": "MARKET_CLOSED"
        }), 200
    return jsonify({"error": "No data available"}), 404

@app.route("/api/gemini/analyze_market_log", methods=["POST"])
def analyze_market():
    ai_client = genai.Client(api_key=GEMINI_API_KEY, vertexai=True)
    log = request.json
    log_date = log.get('log_date', str(get_ist_now().date()))
    direction = "upward (BULLISH)" if log.get('niftyChange', 0) >= 0 else "downward (BEARISH)"
    
    sys_instr = "You are a Senior Quantitative Market Strategist and Financial Journalist specializing in the Indian Equity Markets (NSE/BSE). Your goal is to perform a 'Forensic News Correlation.' You must identify the specific macro-economic or geopolitical events that caused the Nifty 50 index to move on a specific date. Do not provide generic market advice; provide specific, data-backed causal links."
    
    prompt = f"""Analyze the Nifty 50 market movement for {log_date}.
TECHNICAL TELEMETRY:
Closing Price: {log.get('niftyClose')}
Point Change: {log.get('niftyChange')}
Percentage Change: {log.get('niftyChangePercent')}%
Session Trend: {direction}

OBJECTIVES:
1. Use Google Search Grounding to find the top 3-5 high-impact financial news stories published specifically on this date.
2. Synthesize a 'Causal Narrative' (min 300 words) that explains how these news stories influenced institutional buying or selling pressure.
3. Categorize the move (e.g., Monetary Policy, Geopolitical, Earnings).
4. Identify the specific Affected Stocks and Affected Sectors that led the rally or decline.

OUTPUT RULES:
Return the response in STRICT JSON format with keys: headline, narrative, category, sentiment, impact_score, affected_stocks, affected_sectors."""

    try:
        response = ai_client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=sys_instr,
                tools=[types.Tool(google_search=types.GoogleSearch())]
            )
        )
        result = extract_json(response.text)
        if result:
            # Persistence
            sb = get_supabase()
            payload = {
                "market_log_id": log.get('id'),
                "headline": result.get('headline'),
                "narrative": result.get('narrative'),
                "impact_score": result.get('impact_score'),
                "model": "gemini-2.5-flash",
                "impact_json": {
                    "stocks": result.get('affected_stocks'),
                    "sectors": result.get('affected_sectors'),
                    "category": result.get('category'),
                    "sentiment": result.get('sentiment')
                }
            }
            sb.table('news_attribution').upsert(payload, on_conflict='market_log_id').execute()
            return jsonify(result)
        return jsonify({"error": "Failed to parse AI response"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/gemini/stock-deep-dive', methods=['POST'])
def analyze_stock():
    ai_client = genai.Client(api_key=GEMINI_API_KEY, vertexai=True)
    data = request.json
    symbol = data.get('symbol')
    date = data.get('date', str(get_ist_now().date()))
    
    sys_instr = "You are a Senior Equity Analyst specializing in Indian Equities. Perform a forensic audit of a specific stock based on recent news and market data."
    
    prompt = f"""As a Senior Equity Analyst, perform a FORENSIC AUDIT for the NSE stock symbol: {symbol} for the date: {date}.
    
OBJECTIVES:
1. Determine the price movement drivers for {symbol} based on recent news.
2. Find specific reasons for recent moves (Earnings, Order Wins, Corporate Actions, Sectoral pressure, etc.).
3. Obtain at least 2-3 recent analyst recommendations (calls) from reputable financial sources. Include Rating and Target Price.
4. Synthesize a 300+ word causal narrative explaining the outlook.
5. Provide a swing trading recommendation (1 day to 1 month) based on the current setup.
6. Provide a punchy headline and sentiment bias.

OUTPUT RULES:
Return the response in STRICT JSON format with keys: headline, narrative, category, sentiment, impact_score, swing_recommendation, affected_stocks, affected_sectors, analyst_calls."""

    try:
        response = ai_client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=sys_instr,
                tools=[types.Tool(google_search=types.GoogleSearch())]
            )
        )
        result = extract_json(response.text)
        return jsonify(result) if result else jsonify({"error": "Failed to parse AI response"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
