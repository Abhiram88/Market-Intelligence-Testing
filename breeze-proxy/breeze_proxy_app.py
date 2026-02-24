import secrets
from flask import Flask, request, jsonify
from flask_cors import CORS, cross_origin
from flask_socketio import SocketIO
from breeze_connect import BreezeConnect
import os
import logging
from dotenv import load_dotenv
import json
import datetime
import pytz
from google import genai
from google.genai import types
from supabase import create_client, Client

# Load environment variables from .env file for local testing
load_dotenv()

app = Flask(__name__)
# CORS: set CORS_ORIGINS env (comma-separated) or use defaults (local + legacy Vertex IP)
_default_origins = [
    "http://localhost:8082", "http://localhost:5173",
    "http://127.0.0.1:8082", "http://127.0.0.1:5173",
    "http://34.170.234.220:8082",
]
_cors_origins_raw = os.environ.get("CORS_ORIGINS", "")
CORS_ORIGINS = [o.strip() for o in _cors_origins_raw.split(",") if o.strip()] or _default_origins
CORS(app, origins=CORS_ORIGINS, supports_credentials=True)
socketio = SocketIO(app, cors_allowed_origins=CORS_ORIGINS)

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Global State & Cache ---
_secret_cache = {}
breeze_client = None
DAILY_SESSION_TOKEN = None
ai_client = None
supabase = None
mapping_cache = {}

@app.route("/", methods=["GET"])
@cross_origin()
def home():
    return jsonify({
        "message": "MAIA Breeze Proxy is Running",
        "endpoints": [
            "/api/breeze/health",
            "/api/breeze/quotes",
            "/api/gemini/summarize_market_outlook",
            "/api/gemini/stock-deep-dive"
        ]
    }), 200

def get_secret(secret_name):
    """Fetch secrets from environment variables with local caching."""
    if secret_name in _secret_cache:
        return _secret_cache[secret_name]
    
    val = os.environ.get(secret_name)
    
    if val:
        logger.info(f"Loaded secret '{secret_name}' successfully.")
        _secret_cache[secret_name] = val
    else:
        logger.error(f"Failed to find secret '{secret_name}' in environment.")
    
    return val

def initialize_breeze():
    """Initializes the BreezeConnect client."""
    global breeze_client
    if breeze_client is None:
        try:
            api_key = get_secret("BREEZE_API_KEY") 
            if not api_key:
                logger.error("BREEZE_API_KEY is missing!")
                return None

            breeze_client = BreezeConnect(api_key=api_key)
            logger.info(f"BreezeConnect initialized.")
        except Exception as e:
            logger.error(f"Breeze initialization error: {e}")
    return breeze_client

def initialize_ai_clients():
    """Initializes the Gemini and Supabase clients."""
    global ai_client, supabase
    if ai_client is None:
        try:
            gemini_api_key = get_secret("GEMINI_API_KEY")
            if not gemini_api_key:
                logger.error("GEMINI_API_KEY is missing!")
            else:
                ai_client = genai.Client(api_key=gemini_api_key, vertexai=True)
                logger.info("Gemini AI client initialized.")
        except Exception as e:
            logger.error(f"Gemini AI client initialization error: {e}")

    if supabase is None:
        try:
            supabase_url = get_secret("SUPABASE_URL")
            supabase_key = get_secret("SUPABASE_KEY")
            if not supabase_url or not supabase_key:
                logger.error("Supabase URL or Key is missing!")
            else:
                supabase = create_client(supabase_url, supabase_key)
                logger.info("Supabase client initialized.")
        except Exception as e:
            logger.error(f"Supabase client initialization error: {e}")

def ensure_breeze_session():
    """Validates the active session before processing data requests."""
    client = initialize_breeze()
    if not client:
        return None, jsonify({"error": "Breeze client not initialized"}), 500
    
    if not client.session_key and DAILY_SESSION_TOKEN:
        try:
            client.generate_session(
                api_secret=get_secret("BREEZE_API_SECRET"), 
                session_token=DAILY_SESSION_TOKEN
            )
            logger.info("Breeze session regenerated.")
        except Exception as e:
            return None, jsonify({"error": f"Session generation failed: {e}"}), 401
    elif not client.session_key:
        return None, jsonify({"error": "Session token missing. Use /api/breeze/admin/api-session"}), 401
    
    return client, None, None

def get_ist_now():
    return datetime.datetime.now(pytz.timezone('Asia/Kolkata'))

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

def get_breeze_symbol(standard_symbol):
    """Maps standard NSE symbols to Breeze short names using Supabase nse_master_list."""
    if not supabase:
        initialize_ai_clients()
    if not supabase:
        logger.error("Supabase client not initialized, cannot get breeze symbol.")
        return standard_symbol

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

# --- API Routes ---

@app.route("/api/", methods=["GET"])
@cross_origin()
def root_health():
    """Service health check."""
    return jsonify({"status": "ok", "service": "maia-breeze-proxy"})

@app.route("/api/breeze/health", methods=["GET"])
@cross_origin()
def health():
    return jsonify({"status": "ok", "session_active": bool(DAILY_SESSION_TOKEN)})

@app.route("/api/breeze/admin/api-session", methods=["POST", "OPTIONS"])
@cross_origin()
def set_session():
    """Activate the daily session token."""
    if request.method == "OPTIONS":
        return "", 200
    global DAILY_SESSION_TOKEN
    data = request.get_json() or {}
    api_session = data.get("api_session")

    provided_key = request.headers.get('X-Proxy-Admin-Key', '').strip()
    ADMIN_KEY = get_secret("BREEZE_PROXY_ADMIN_KEY")
    
    if not ADMIN_KEY or not secrets.compare_digest(provided_key, ADMIN_KEY.strip()):
        return jsonify({"error": "Unauthorized"}), 401

    if not api_session:
        return jsonify({"error": "api_session required"}), 400
    
    client = initialize_breeze()
    try:
        api_secret = get_secret("BREEZE_API_SECRET")
        client.generate_session(api_secret=api_secret, session_token=api_session)
        DAILY_SESSION_TOKEN = api_session
        return jsonify({"status": "success", "message": "Daily session activated"}), 200
    except Exception as e:
        logger.error(f"Session Error: {e}")
        return jsonify({"error": "Failed to generate session", "details": str(e)}), 500

@app.route("/api/breeze/quotes", methods=["POST"])
@cross_origin()
def get_quotes():
    """Fetch real-time stock quotes."""
    client, err_resp, status_code = ensure_breeze_session()
    if err_resp: return err_resp, status_code

    data = request.get_json() or {}
    try:
        res = client.get_quotes(
            stock_code=data.get("stock_code"), 
            exchange_code=data.get("exchange_code", "NSE"), 
            product_type="cash"
        )
        return jsonify(res), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/breeze/depth", methods=["POST"])
@cross_origin()
def get_depth():
    """Fetch L2 Market Depth."""
    client, err_resp, status_code = ensure_breeze_session()
    if err_resp: return err_resp, status_code

    data = request.get_json() or {}
    try:
        res = client.get_market_depth2(
            stock_code=data.get("stock_code"),
            exchange_code=data.get("exchange_code", "NSE"),
            product_type="cash"
        )
        return jsonify(res), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/breeze/historical", methods=["POST"])
@cross_origin()
def get_historical():
    """Fetch historical OHLC data."""
    client, err_resp, status_code = ensure_breeze_session()
    if err_resp: return err_resp, status_code

    data = request.get_json() or {}
    try:
        res = client.get_historical_data(
            stock_code=data.get("stock_code"),
            exchange_code=data.get("exchange_code", "NSE"),
            product_type="cash",
            from_date=data.get("from_date"),
            to_date=data.get("to_date"),
            interval=data.get("interval", "1day")
        )
        return jsonify(res), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/gemini/summarize_market_outlook', methods=['POST', 'OPTIONS'])
@cross_origin()
def summarize_market_outlook():
    if request.method == 'OPTIONS':
        return jsonify(success=True)
    
    initialize_ai_clients()
    if not ai_client:
        return jsonify({"error": "Gemini AI client not initialized"}), 500

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
            if supabase:
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
                try:
                    supabase.table('news_attribution').upsert(payload, on_conflict='market_log_id').execute()
                except Exception as e:
                    logger.error(f"Supabase upsert error: {e}")
            return jsonify(result)
        return jsonify({"error": "Failed to parse AI response"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/gemini/stock-deep-dive', methods=['POST', 'OPTIONS'])
@cross_origin()
def analyze_stock():
    if request.method == 'OPTIONS':
        return jsonify(success=True)

    initialize_ai_clients()
    if not ai_client:
        return jsonify({"error": "Gemini AI client not initialized"}), 500

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
            client, err_resp, status_code = ensure_breeze_session()
            if err_resp:
                logger.error(f"Could not get breeze session: {err_resp.get_data(as_text=True)}")
                socketio.sleep(30) # Wait longer if session is the issue
                continue
            
            breeze_code = get_breeze_symbol(symbol)
            try:
                res = client.get_quotes(
                    stock_code=breeze_code, 
                    exchange_code="NSE", 
                    product_type="cash"
                )
                if res.get("Success"):
                    res["Success"]["symbol"] = symbol
                    socketio.emit('watchlist_update', res["Success"], room=sid)
                else:
                    logger.error(f"Error fetching quote for {symbol}: {res}")

            except Exception as e:
                logger.error(f"Error fetching quote for {symbol}: {e}")
        socketio.sleep(5)
        
# --- Startup ---
if __name__ == "__main__":
    initialize_ai_clients()
    # Cloud Run injected port or local safe 8082
    port = int(os.environ.get("PORT", 8082))
    socketio.run(app, host="0.0.0.0", port=port, debug=False)