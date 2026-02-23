import os
import json
import datetime
import requests
import pytz
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit
from google import genai
from google.genai import types
from supabase import create_client, Client

app = Flask(__name__)
CORS(app, origins=["http://34.170.234.220:8082"], supports_credentials=True)
socketio = SocketIO(app, cors_allowed_origins="*")

# --- CONFIGURATION ---
GEMINI_API_KEY = os.environ.get("API_KEY")
# This should be the URL of your deployed breeze_proxy_app.py
BREEZE_PROXY_URL = os.environ.get("BREEZE_PROXY_URL", "https://maia-breeze-proxy-service-919207294606.us-central1.run.app").rstrip("/")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://xbnzvmgawikqzxutmoea.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "sb_publishable_8TYnAzAX4s-CHAPVOpmLEA_Puqwcuwo")

# --- INITIALIZATION ---
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
ai_client = genai.Client(api_key=GEMINI_API_KEY, vertexai=True)

# Cache for symbol mappings
mapping_cache = {}

# --- HELPERS ---
def get_ist_now():
    return datetime.datetime.now(pytz.timezone('Asia/Kolkata'))

def is_indian_market_open():
    now_ist = get_ist_now()
    # Market open from 9:00 AM to 3:30 PM IST on weekdays
    if now_ist.weekday() < 5 and \
       (now_ist.hour > 9 or (now_ist.hour == 9 and now_ist.minute >= 0)) and \
       (now_ist.hour < 15 or (now_ist.hour == 15 and now_ist.minute <= 30)):
        return True
    return False

def get_breeze_symbol(standard_symbol):
    """Maps standard NSE symbols to Breeze short names using Supabase nse_master_list."""
    if standard_symbol in mapping_cache:
        return mapping_cache[standard_symbol]
    
    try:
        response = supabase.table('nse_master_list').select('short_name').eq('symbol', standard_symbol).maybe_single().execute()
        if response.data:
            short_name = response.data['short_name']
            mapping_cache[standard_symbol] = short_name
            return short_name
    except Exception as e:
        print(f"Mapping Error for {standard_symbol}: {e}")
    
    return standard_symbol

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

def get_proxy_headers():
    proxy_key = request.headers.get("X-Proxy-Key", "")
    return {
        "Content-Type": "application/json",
        "X-Proxy-Key": proxy_key
    }

# --- BREEZE PROXY ENDPOINTS ---
@app.route('/api/breeze/admin/api-session', methods=['POST', 'OPTIONS'])
def set_session():
    if request.method == 'OPTIONS':
        return jsonify(success=True)
    try:
        res = requests.post(
            f"{BREEZE_PROXY_URL}/api/breeze/admin/api-session",
            json=request.json,
            headers={"X-Proxy-Admin-Key": request.headers.get("X-Proxy-Admin-Key")}
        )
        print("--- PROXY DEBUG (set_session) ---")
        print(f"Status Code: {res.status_code}")
        print(f"Headers: {res.headers}")
        print(f"Raw Text: {res.text}")
        print("-------------------------------------")
        return jsonify(res.json()), res.status_code
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

def get_quote_data(symbol, proxy_key=""):
    breeze_code = get_breeze_symbol(symbol)
    payload = {
        "stock_code": breeze_code,
        "exchange_code": "NSE",
        "product_type": "cash"
    }
    headers = {
        "Content-Type": "application/json",
        "X-Proxy-Key": proxy_key
    }
    try:
        res = requests.post(
            f"{BREEZE_PROXY_URL}/api/breeze/quotes",
            headers=headers
        )
        print("--- PROXY DEBUG (get_quote_data) ---")
        print(f"Status Code: {res.status_code}")
        print(f"Headers: {res.headers}")
        print(f"Raw Text: {res.text}")
        print("--------------------------------------")
        return res.json(), res.status_code
    except Exception as e:
        return {"status": "error", "message": str(e)}, 500

@app.route('/api/market/quote', methods=['POST', 'OPTIONS'])
def get_quote():
    if request.method == 'OPTIONS':
        return jsonify(success=True)
    data = request.json
    symbol = data.get("symbol")
    if not symbol:
        return jsonify({"status": "error", "message": "Symbol is required"}), 400
    
    proxy_key = request.headers.get("X-Proxy-Key", "")
    quote, status_code = get_quote_data(symbol, proxy_key)
    return jsonify(quote), status_code

@app.route('/api/market/depth', methods=['POST', 'OPTIONS'])
def get_depth():
    if request.method == 'OPTIONS':
        return jsonify(success=True)
    data = request.json
    symbol = data.get("symbol")
    if not symbol:
        return jsonify({"status": "error", "message": "Symbol is required"}), 400
        
    breeze_code = get_breeze_symbol(symbol)
    payload = {
        "stock_code": breeze_code,
        "exchange_code": "NSE",
        "product_type": "cash"
    }

    try:
        res = requests.post(
            f"{BREEZE_PROXY_URL}/api/breeze/depth",
            json=payload,
            headers=get_proxy_headers()
        )
        return jsonify(res.json()), res.status_code
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/market/historical', methods=['POST', 'OPTIONS'])
def get_historical():
    if request.method == 'OPTIONS':
        return jsonify(success=True)
    data = request.json
    symbol = data.get("symbol")
    from_date = data.get("from_date")
    to_date = data.get("to_date")
    
    if not symbol:
        return jsonify({"status": "error", "message": "Symbol is required"}), 400

    breeze_code = get_breeze_symbol(symbol)
    payload = {
        "stock_code": breeze_code,
        "exchange_code": "NSE",
        "product_type": "cash",
        "from_date": from_date,
        "to_date": to_date,
        "interval": "1day"
    }

    try:
        res = requests.post(
            f"{BREEZE_PROXY_URL}/api/breeze/historical",
            json=payload,
            headers=get_proxy_headers()
        )
        return jsonify(res.json()), res.status_code
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/market/nifty-realtime', methods=['GET'])
def get_nifty_realtime():
    if is_indian_market_open():
        res = requests.post(
            f"{BREEZE_PROXY_URL}/quotes",
            json={"stock_code": "NIFTY", "exchange_code": "NSE", "product_type": "cash"},
            headers=get_proxy_headers()
        )
        if res.status_code == 200:
            data = res.json().get("Success")
            if data:
                data["market_status"] = "LIVE_TRADING_SESSION"
                return jsonify(data), 200
    
    # Fallback to Supabase
    last_log = supabase.table('market_logs').select('*').order('log_date', desc=True).limit(1).maybe_single().execute()
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

# --- GEMINI INTELLIGENCE ENDPOINTS ---
@app.route('/api/gemini/summarize_market_outlook', methods=['POST', 'OPTIONS'])
def summarize_market_outlook():
    if request.method == 'OPTIONS':
        return jsonify(success=True)
    log = request.json
    log_date = log.get('log_date', str(get_ist_now().date()))
    direction = "upward (BULLISH)" if log.get('niftyChange', 0) >= 0 else "downward (BEARISH)"

    sys_instr = "You are a Senior Equity Analyst and Financial Journalist for a top-tier publication, specializing in the Indian Equity Markets. Your task is to synthesize a compelling and insightful market summary that explains the key drivers behind the Nifty 50's performance for a given day. You must provide a clear narrative, supported by data and specific events."

    prompt = f"""Provide a comprehensive market summary for the Nifty 50 on {log_date}.
The market closed at {log.get('niftyClose')}, with a change of {log.get('niftyChange')} points ({log.get('niftyChangePercent')}%). The session trend was {direction}.

Your analysis should be a narrative of at least 300 words, explaining the 'why' behind the market's movement.

Your response must be in a STRICT JSON format with the following keys:
- "headline": A punchy, insightful headline summarizing the day's action.
- "narrative": A detailed narrative explaining the causal factors (e.g., policy announcements, corporate earnings, global cues, sector-specific news).
- "outlook": A brief forward-looking statement on what to expect in the near term.
- "affected_sectors": A list of the top 3-5 sectors that were most impacted.
- "key_stocks": A list of key stocks that were movers and shakers.
"""

    try:
        response = ai_client.models.generate_content(
            model='gemini-3-pro',
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=sys_instr,
                tools=[types.Tool(google_search=types.GoogleSearch())]
            )
        )
        result = extract_json(response.text)
        if result:
            # Persistence
            payload = {
                "market_log_id": log.get('id'),
                "headline": result.get('headline'),
                "narrative": result.get('narrative'),
                "outlook": result.get('outlook'),
                "model": "gemini-3-pro",
                "impact_json": {
                    "stocks": result.get('key_stocks'),
                    "sectors": result.get('affected_sectors'),
                }
            }
            supabase.table('news_attribution').upsert(payload, on_conflict='market_log_id').execute()
            return jsonify(result)
        return jsonify({"error": "Failed to parse AI response"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/gemini/stock-deep-dive', methods=['POST', 'OPTIONS'])
def analyze_stock():
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

@app.route('/api/reg30/analyze_event_text', methods=['POST', 'OPTIONS'])
def analyze_reg30():
    data = request.json
    event_text = data.get("event_text")
    
    sys_instr = "You are an expert Indian equity events analyst. You ONLY extract data. NEVER fabricate."
    
    prompt = f"""Analyze the following corporate disclosure text for an Indian equity event:
    "{event_text}"

    Task: Extract the following structured data. Convert raw INR to Crores (CR) where applicable.
    - order_value_cr: (NUMBER, if available, converted to Crores)
    - stage: (STRING, enum: L1, LOA, WO, NTP, MOU, OTHER)
    - execution_months: (NUMBER, estimated duration of the contract/order in months)
    - customer: (STRING, name of the customer, if relevant)

    The model MUST provide "evidence_spans"—direct quotes from the text that prove the extraction is real.

    Response MUST be valid JSON.
    """

    try:
        response = ai_client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=sys_instr,
                response_mime_type="application/json",
                response_schema={
                    "type": "OBJECT",
                    "properties": {
                        "summary": {"type": "STRING"},
                        "impact_score": {"type": "NUMBER"},
                        "extracted": {
                            "type": "OBJECT",
                            "properties": {
                                "order_value_cr": {"type": "NUMBER"},
                                "stage": {"type": "STRING", "enum": ["L1", "LOA", "WO", "NTP", "MOU", "OTHER"]},
                                "execution_months": {"type": "NUMBER"},
                                "customer": {"type": "STRING"}
                            }
                        },
                        "evidence_spans": {"type": "ARRAY", "items": {"type": "STRING"}}
                    }
                }
            )
        )
        return jsonify(json.loads(response.text))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# --- SOCKET.IO HANDLERS ---
@socketio.on('connect')
def handle_connect():
    print('Client connected:', request.sid)

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected:', request.sid)

@socketio.on('subscribe_to_watchlist')
def handle_watchlist_subscription(data):
    sid = request.sid
    stock_list = data.get('stocks', [])
    proxy_key = data.get('proxy_key', '')
    print(f"Client {sid} subscribed to watchlist: {stock_list}")
    socketio.start_background_task(track_watchlist, stock_list, proxy_key, sid)

def track_watchlist(stock_list, proxy_key, sid):
    is_connected = True
    while is_connected:
        if not socketio.server.manager.is_connected(sid):
            is_connected = False
            break

        for symbol in stock_list:
            quote, status = get_quote_data(symbol, proxy_key)
            if status == 200:
                if quote.get("Success"):
                    quote["Success"]["symbol"] = symbol
                    socketio.emit('watchlist_update', quote["Success"], room=sid)
            else:
                print(f"Error fetching quote for {symbol}: {quote}")
        socketio.sleep(5)

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000)