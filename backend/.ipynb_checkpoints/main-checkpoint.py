import os
import json
import requests
import datetime
import pytz
import time
from flask import Flask, request, jsonify
from flask_cors import CORS
from google import genai
from google.genai import types
from supabase import create_client, Client
from google.cloud import secretmanager

app = Flask(__name__)
# Enable CORS so your React Frontend can talk to this server
CORS(app, resources={r"/api/*": {"origins": "*"}})

# --- 1. CONFIGURATION & ENVIRONMENT ---
GCP_PROJECT_ID = "gen-lang-client-0751458856"
BREEZE_PROXY_URL = os.environ.get("BREEZE_PROXY_URL", "https://maia-breeze-proxy-service-919207294606.us-central1.run.app").rstrip("/")
_cache = {}

# --- 2. HELPER FUNCTIONS (Must be defined before usage) ---

def fetch_secret(name):
    """Retrieve secrets from environment or Google Secret Manager."""
    val = os.environ.get(name)
    if val: return val
    try:
        client = secretmanager.SecretManagerServiceClient()
        resource_name = f"projects/{GCP_PROJECT_ID}/secrets/{name}/versions/latest"
        response = client.access_secret_version(request={"name": resource_name})
        return response.payload.data.decode("UTF-8")
    except Exception as e:
        print(f"Secret Fetch Error for {name}: {e}")
        return ""

def get_supabase() -> Client:
    if "supabase" not in _cache:
        url = os.environ.get("SUPABASE_URL", "https://xbnzvmgawikqzxutmoea.supabase.co")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "sb_publishable_8TYnAzAX4s-CHAPVOpmLEA_Puqwcuwo")
        _cache["supabase"] = create_client(url, key)
    return _cache["supabase"]

def get_ist_now():
    return datetime.datetime.now(pytz.timezone('Asia/Kolkata'))

def is_market_open():
    now = get_ist_now()
    if now.weekday() >= 5: return False
    time_val = now.hour * 100 + now.minute
    return 900 <= time_val <= 1530

def extract_json(text):
    try:
        first = text.find('{')
        last = text.rfind('}')
        if first != -1 and last != -1:
            return json.loads(text[first:last + 1])
        return json.loads(text)
    except Exception as e:
        print(f"JSON Extraction Error: {e}")
        return None

def call_proxy(endpoint, payload, method="POST", headers=None):
    url = f"{BREEZE_PROXY_URL}/{endpoint.lstrip('/')}"
    try:
        if method == "POST":
            r = requests.post(url, json=payload, headers=headers, timeout=30)
        else:
            r = requests.get(url, headers=headers, timeout=30)
        return r.json(), r.status_code
    except Exception as e:
        return {"error": f"Proxy Communication Failed: {str(e)}"}, 502

def get_breeze_short_name(symbol: str) -> str:
    sym = symbol.strip().upper()
    if f"map_{sym}" in _cache: return _cache[f"map_{sym}"]
    sb = get_supabase()
    try:
        resp = sb.table("nse_master_list").select("short_name").eq("symbol", sym).maybe_single().execute()
        if resp.data and resp.data.get("short_name"):
            sn = resp.data["short_name"].strip().upper()
            _cache[f"map_{sym}"] = sn
            return sn
    except Exception as e:
        print(f"Supabase mapping failed for {sym}: {e}")
    return sym

# --- 3. INITIALIZE GLOBAL VARIABLES ---
# This must happen AFTER fetch_secret is defined
GEMINI_API_KEY = fetch_secret("GEMINI_API_KEY")

# --- 4. API ROUTES ---

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "maia-backend-intelligence", "gemini_ready": bool(GEMINI_API_KEY)})

@app.route("/api/market/quote", methods=["POST"])
def get_market_quote():
    data = request.get_json() or {}
    symbol = data.get("symbol", data.get("stock_code", "ABB"))
    payload = {
        "stock_code": get_breeze_short_name(symbol),
        "exchange_code": "NSE",
        "product_type": "cash"
    }
    return call_proxy("breeze/quotes", payload)

@app.route("/api/market/nifty-realtime", methods=["GET"])
def get_nifty_realtime():
    if is_market_open():
        res, status = call_proxy("breeze/quotes", {"stock_code": "NIFTY"})
        if status == 200 and res.get("Success"):
            data = res["Success"]
            data["market_status"] = "LIVE_TRADING_SESSION"
            return jsonify(data), 200
    
    sb = get_supabase()
    last_log = sb.table('market_logs').select('*').order('log_date', desc=True).limit(1).maybe_single().execute()
    if last_log.data:
        log = last_log.data
        return jsonify({
            "last_traded_price": log['ltp'],
            "change": log['points_change'],
            "percent_change": log['change_percent'],
            "market_status": "MARKET_CLOSED"
        }), 200
    return jsonify({"error": "No data available"}), 404

# RESTORED: Nifty Macro Analysis
# RESTORED: Nifty Macro Analysis
@app.route("/api/gemini/analyze_market_log", methods=["POST"])
def analyze_market():
    # Explicitly disabling Vertex tells the SDK: "Only use my API Key."
    ai_client = genai.Client(api_key=GEMINI_API_KEY, vertexai=False)
    log = request.json
    log_date = log.get('log_date', str(get_ist_now().date()))
    
    sys_instr = """You are a Senior Quantitative Market Strategist. 
    Perform a 'Forensic News Correlation' using Gemini 3's high-level reasoning. 
    Identify macro events that caused Nifty 50 movement. Provide specific, data-backed causal links."""
    
    prompt = f"""Analyze Nifty 50 movement for {log_date}.
TELEMETRY: Close: {log.get('niftyClose')}, Change: {log.get('niftyChangePercent')}%
OBJECTIVES:
1. Identify 3-5 high-impact financial news stories for this date using Google Search.
2. Explain how these influenced institutional pressure.
3. Categorize the move and identify affected sectors.
OUTPUT RULES: Return STRICT JSON format with keys: headline, narrative, category, sentiment, impact_score, affected_stocks, affected_sectors."""

    try:
        response = ai_client.models.generate_content(
            model='gemini-3-pro-preview', 
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=sys_instr,
                tools=[types.Tool(google_search=types.GoogleSearch())],
                thinking_config=types.ThinkingConfig(thinking_level="high", include_thoughts=True)
            )
        )
        result = extract_json(response.text)
        return jsonify(result)
        
    except Exception as e:
        print(f"Gemini 3 Execution Error: {e}")
        return jsonify({"error": str(e)}), 500

# Stock Specific Forensic Audit
@app.route('/api/gemini/stock-deep-dive', methods=['POST'])
def analyze_stock():
    data = request.json or {}
    symbol = data.get('symbol', 'ABB')
    
    # Ingest Live Telemetry
    quote_res, status = get_market_quote() 
    quote_data = quote_res.get("Success", {}) if status == 200 else {}

    # FIX: Added vertexai=False here to match analyze_market and stop the 401 loop
    ai_client = genai.Client(api_key=GEMINI_API_KEY, vertexai=False)
    
    sys_instr = """You are a Lead Quantitative Strategist at a Tier-1 Hedge Fund. 
    Your expertise is in 'Event-Driven Alpha.' Use Gemini 3's Deep Think mode 
    to find causal links between telemetry and news. Prioritize actionable signals."""
    
    prompt = f"""PERFORM FORENSIC AUDIT FOR: {symbol}
LTP: {quote_data.get('last_traded_price')}, Change: {quote_data.get('percent_change')}%
Volume: {quote_data.get('volume')}

OBJECTIVES:
1. CAUSAL IDENTIFICATION: Use Search to find why {symbol} moved {quote_data.get('percent_change')}% today.
2. INSTITUTIONAL FOOTPRINT: Based on volume {quote_data.get('volume')}, is this Accumulation or Distribution?
3. ANALYST CONSENSUS: Find 3 recent ratings/targets from last 14 days.
4. ALGO TRADE PLAN: Provide Entry, Stop-Loss, and Take-Profit for a 5-day swing.

OUTPUT RULES: Return STRICT JSON with keys: headline, forensic_narrative, sentiment_score, institutional_bias, swing_setup, analyst_calls, source_citations."""

    try:
        response = ai_client.models.generate_content(
            model='gemini-3-pro-preview', 
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=sys_instr,
                tools=[types.Tool(google_search=types.GoogleSearch())],
                thinking_config=types.ThinkingConfig(thinking_level="high", include_thoughts=True)
            )
        )
        result = extract_json(response.text)
        return jsonify(result)

    except Exception as e:
        print(f"Gemini 3 Execution Error: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    # Using host 0.0.0.0 for instance access
    app.run(host='0.0.0.0', port=5000, debug=True, use_reloader=False)