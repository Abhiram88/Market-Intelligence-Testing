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
# Enable CORS for frontend connectivity
CORS(app, resources={r"/api/*": {"origins": "*"}})

# --- 1. CONFIGURATION & ENVIRONMENT ---
GCP_PROJECT_ID = "gen-lang-client-0751458856"
BREEZE_PROXY_URL = os.environ.get("BREEZE_PROXY_URL", "https://maia-breeze-proxy-service-919207294606.us-central1.run.app").rstrip("/")
_cache = {}

# --- 2. HELPER FUNCTIONS ---

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
    """Singleton-style Supabase client with corrected secret names."""
    if "supabase" not in _cache:
        # 1. Use the URL from Secret Manager (since it's there) or Env
        url = fetch_secret("SUPABASE_URL") or os.environ.get("SUPABASE_URL")
        
        # 2. MATCH THE IMAGE: Use 'SUPABASE_ANON_KEY' instead of service role
        key = fetch_secret("SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_ANON_KEY")
        
        if not url or not key:
            raise ValueError(f"CRITICAL: Missing Supabase credentials. URL: {bool(url)}, Key: {bool(key)}")
            
        _cache["supabase"] = create_client(url, key)
    return _cache["supabase"]
    
def get_ist_now():
    """Helper for Indian Standard Time."""
    return datetime.datetime.now(pytz.timezone('Asia/Kolkata'))

def is_market_open():
    """Check if Indian markets (NSE/BSE) are currently trading."""
    now = get_ist_now()
    if now.weekday() >= 5: return False
    time_val = now.hour * 100 + now.minute
    return 900 <= time_val <= 1530

def extract_json(text):
    """Cleanly extract JSON from AI response blocks."""
    try:
        first = text.find('{')
        last = text.rfind('}')
        if first != -1 and last != -1:
            return json.loads(text[first:last + 1])
        return json.loads(text)
    except Exception as e:
        print(f"JSON Extraction Error: {e}")
        return {"error": "Failed to parse AI response", "raw_text": text}

def call_proxy(endpoint, payload, method="POST", headers=None):
    """Internal communication with the Breeze Proxy service."""
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
    """Map NSE symbols to Breeze-specific codes via Supabase."""
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

# --- 3. INITIALIZE GLOBAL GEMINI 3 CLIENT ---
GEMINI_API_KEY = fetch_secret("GEMINI_API_KEY")
ai_client = genai.Client(api_key=GEMINI_API_KEY, vertexai=False)

# --- 4. API ROUTES ---

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok", 
        "service": "maia-backend-intelligence", 
        "gemini_ready": bool(GEMINI_API_KEY)
    })

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

@app.route("/api/gemini/analyze_market_log", methods=["POST"])
def analyze_market():
    log = request.json or {}
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
                thinking_config=types.ThinkingConfig(include_thoughts=True, thinking_level="high")
            )
        )
        return jsonify(extract_json(response.text))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/gemini/stock-deep-dive', methods=['POST'])
def analyze_stock():
    data = request.json or {}
    symbol = data.get('symbol', data.get('stock_code', 'ABB')).upper()
    
    # 1. Fetch market data for telemetry
    quote_res, status = get_market_quote()
    quote_data = quote_res.get("Success", {}) if status == 200 else {}
    
    ltp = quote_data.get('last_traded_price', 'N/A')
    p_change = quote_data.get('percent_change', '0')
    vol = quote_data.get('volume', 'N/A')

    # 2. Strict Lead Strategist Directives
    sys_instr = """You are a Lead Quantitative Strategist at a Tier-1 Hedge Fund. 
    Your expertise is in 'Event-Driven Alpha.' Use Gemini 3's Deep Think mode 
    to find causal links between telemetry and news. Prioritize actionable signals. 
    DO NOT simplify the objectives. Provide a high-fidelity forensic audit with specific data points."""

    # 3. High-Fidelity Prompt
    prompt = f"""PERFORM FORENSIC AUDIT FOR: {symbol}
    LTP: {ltp} | Change: {p_change}% | Volume: {vol}

    OBJECTIVES:
    1. CAUSAL IDENTIFICATION: Use Search to find why {symbol} moved {p_change}% today. Identify specific news/events.
    2. INSTITUTIONAL FOOTPRINT: Based on volume {vol}, is this Accumulation or Distribution? Provide reasoning.
    3. ANALYST CONSENSUS: Find 3 recent ratings/targets from last 14 days.
    4. ALGO TRADE PLAN: Provide Entry, Stop-Loss, and Take-Profit for a 5-day swing.

    OUTPUT RULES: Return STRICT JSON format with keys: headline, forensic_narrative, sentiment_score, institutional_bias, swing_setup, analyst_calls, source_citations."""

    try:
        response = ai_client.models.generate_content(
            model='gemini-3-pro-preview',
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=sys_instr,
                tools=[types.Tool(google_search=types.GoogleSearch())],
                thinking_config=types.ThinkingConfig(include_thoughts=True, thinking_level="high"),
                temperature=1.0
            )
        )
        return jsonify(extract_json(response.text))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    # Binding for GCP Instance access
    app.run(host='0.0.0.0', port=5000, debug=True, use_reloader=False)