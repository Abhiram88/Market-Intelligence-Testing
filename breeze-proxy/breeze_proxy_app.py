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
import yaml
import re
from google import genai
from google.genai import types
from supabase import create_client, Client

# Load environment variables from .env file for local testing
load_dotenv()

# Load YAML config file (if present) as a fallback for secrets
_yaml_config = {}
_CONFIG_PATH = os.environ.get("CONFIG_PATH", "config.yaml")
if os.path.isfile(_CONFIG_PATH):
    try:
        with open(_CONFIG_PATH, "r") as f:
            _yaml_config = {k: v for k, v in (yaml.safe_load(f) or {}).items() if v}
        logging.info(f"Loaded config from {_CONFIG_PATH}")
    except Exception as e:
        logging.warning(f"Failed to load {_CONFIG_PATH}: {e}")

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*", "methods": ["GET", "POST", "OPTIONS"], "allow_headers": ["Content-Type", "X-Proxy-Key", "X-Proxy-Admin-Key"]}})
socketio = SocketIO(app, cors_allowed_origins="*")


@app.after_request
def add_cors_headers(response):
    """Ensure every response has CORS headers so preflight and errors still allow the frontend."""
    origin = request.origin if request.origin else "*"
    response.headers["Access-Control-Allow-Origin"] = origin
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Proxy-Key, X-Proxy-Admin-Key"
    response.headers["Access-Control-Max-Age"] = "86400"
    return response


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


# ─────────────────────────────────────────────
# HOME
# ─────────────────────────────────────────────
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


# ─────────────────────────────────────────────
# SECRETS
# ─────────────────────────────────────────────
def get_secret(secret_name):
    """Fetch secrets from environment variables or YAML config file, with local caching."""
    if secret_name in _secret_cache:
        return _secret_cache[secret_name]

    val = os.environ.get(secret_name)
    if val is None:
        val = _yaml_config.get(secret_name)

    if val:
        logger.info(f"Loaded secret '{secret_name}' successfully.")
        _secret_cache[secret_name] = val
    else:
        logger.error(f"Failed to find secret '{secret_name}' in environment or config file.")

    return val


# ─────────────────────────────────────────────
# CLIENT INITIALIZERS
# ─────────────────────────────────────────────
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
            logger.info("BreezeConnect initialized.")
        except Exception as e:
            logger.error(f"Breeze initialization error: {e}")
    return breeze_client


def initialize_supabase():
    """Initializes the Supabase client only."""
    global supabase
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
    return supabase


def initialize_ai_clients():
    """Initializes the Gemini AI and Supabase clients."""
    global ai_client
    if ai_client is None:
        try:
            gemini_api_key = get_secret("GEMINI_API_KEY")
            if not gemini_api_key:
                logger.error("GEMINI_API_KEY is missing!")
            else:
                ai_client = genai.Client(api_key=gemini_api_key)
                logger.info("Gemini AI client initialized.")
        except Exception as e:
            logger.error(f"Gemini AI client initialization error: {e}")

    # Always ensure Supabase is also initialized alongside Gemini
    initialize_supabase()


# ─────────────────────────────────────────────
# SESSION MANAGEMENT
# ─────────────────────────────────────────────
def ensure_breeze_session():
    """Validates the active Breeze session before processing data requests."""
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


# ─────────────────────────────────────────────
# UTILITIES
# ─────────────────────────────────────────────
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
        logger.error(f"JSON Extraction Error: {e}")
        return None


def normalize_breeze_response(res):
    """
    Breeze API returns inconsistent shapes:
      - dict with 'Success' key: {"Success": {...}, "Status": 200}
      - plain list: [{...}]
      - plain dict: {...}
    Returns a normalized dict or None.
    """
    if isinstance(res, dict):
        return res.get("Success") or res
    if isinstance(res, list) and len(res) > 0:
        return res[0]
    return None


def to_float(value, default=0.0):
    try:
        if value is None or value == "":
            return float(default)
        return float(value)
    except Exception:
        return float(default)


def canonical_symbol(sym):
    s = str(sym or "").strip().upper()
    if s in {"NIFTY 50", "NIFTY50"}:
        return "NIFTY"
    return s


def wrap_success_payload(payload):
    """
    Ensure REST responses always match frontend expectation:
    { "Success": [ ... ] } or { "Success": { ... } }
    """
    if isinstance(payload, list):
        return {"Success": payload}
    return {"Success": [payload]} if payload is not None else {"Success": []}


def normalize_tick_for_frontend(ticks, resolved_symbol):
    """
    Breeze websocket quote ticks use keys like `last`, `bPrice`, `sPrice`, `ttq`.
    Frontend expects fields like `ltp`, `last_traded_price`, `percent_change`, etc.
    """
    last = to_float(ticks.get("last", ticks.get("ltp", ticks.get("last_traded_price", 0))))
    previous_close = to_float(ticks.get("close", ticks.get("previous_close", 0)))
    change = to_float(ticks.get("change", (last - previous_close)))
    pct = ticks.get("ltp_percent_change", ticks.get("percent_change", ticks.get("chng_per")))
    if pct is None or pct == "":
        pct = ((change / previous_close) * 100.0) if previous_close else 0.0
    pct = to_float(pct)
    vol = to_float(ticks.get("ttq", ticks.get("total_quantity_traded", ticks.get("total_volume", ticks.get("volume", 0)))))

    normalized = dict(ticks)
    normalized.update({
        "symbol": resolved_symbol,
        "stock_code": resolved_symbol,
        "ltp": last,
        "last_traded_price": last,
        "previous_close": previous_close,
        "change": change,
        "ltp_percent_change": pct,
        "percent_change": pct,
        "best_bid_price": to_float(ticks.get("bPrice", ticks.get("best_bid_price", 0))),
        "best_bid_quantity": to_float(ticks.get("bQty", ticks.get("best_bid_quantity", 0))),
        "best_offer_price": to_float(ticks.get("sPrice", ticks.get("best_offer_price", 0))),
        "best_offer_quantity": to_float(ticks.get("sQty", ticks.get("best_offer_quantity", 0))),
        "volume": vol,
        "total_quantity_traded": vol,
        "open": to_float(ticks.get("open", 0)),
        "high": to_float(ticks.get("high", 0)),
        "low": to_float(ticks.get("low", 0)),
    })
    return normalized


def get_gemini_model_candidates():
    """
    Ordered fallback list.
    Keep flash first for availability/latency; upgrade to pro when available.
    """
    raw = get_secret("GEMINI_MODELS") or os.environ.get("GEMINI_MODELS", "")
    configured = [m.strip() for m in raw.split(",") if m and m.strip()]
    if configured:
        return configured
    return ["gemini-2.5-flash", "gemini-2.5-pro"]


def generate_with_model_fallback(prompt, sys_instr):
    last_error = None
    for model_name in get_gemini_model_candidates():
        try:
            response = ai_client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=sys_instr,
                    tools=[types.Tool(google_search=types.GoogleSearch())]
                )
            )
            return response, model_name
        except Exception as e:
            last_error = e
            logger.warning(f"Gemini model failed ({model_name}): {e}")
            continue
    raise RuntimeError(f"All Gemini model attempts failed. Last error: {last_error}")


def get_breeze_symbol(standard_symbol):
    """Maps standard NSE symbols to Breeze short names using Supabase nse_master_list."""
    # FIX: use initialize_supabase() directly — not initialize_ai_clients()
    if not supabase:
        initialize_supabase()
    if not supabase:
        logger.error("Supabase not initialized, cannot map symbol.")
        return standard_symbol

    if standard_symbol in mapping_cache:
        return mapping_cache[standard_symbol]

    try:
        response = (
            supabase.table('nse_master_list')
            .select('short_name')
            .eq('symbol', standard_symbol)
            .maybe_single()
            .execute()
        )
        if response.data:
            short_name = response.data['short_name']
            mapping_cache[standard_symbol] = short_name
            logger.info(f"Mapped {standard_symbol} -> {short_name}")
            return short_name
    except Exception as e:
        logger.error(f"Mapping Error for {standard_symbol}: {e}")

    return standard_symbol


# ─────────────────────────────────────────────
# HEALTH ROUTES
# ─────────────────────────────────────────────
@app.route("/api/", methods=["GET"])
@cross_origin()
def root_health():
    return jsonify({"status": "ok", "service": "maia-breeze-proxy"})


@app.route("/api/breeze/health", methods=["GET"])
@cross_origin()
def health():
    return jsonify({"status": "ok", "session_active": bool(DAILY_SESSION_TOKEN)})


# ─────────────────────────────────────────────
# ADMIN: SET SESSION
# ─────────────────────────────────────────────
@app.route("/api/breeze/admin/api-session", methods=["POST", "OPTIONS"])
@cross_origin()
def set_session():
    """Activate the daily Breeze session token."""
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
    if not client:
        return jsonify({"error": "Breeze client could not be initialized"}), 500

    try:
        api_secret = get_secret("BREEZE_API_SECRET")
        client.generate_session(api_secret=api_secret, session_token=api_session)
        DAILY_SESSION_TOKEN = api_session
        return jsonify({"status": "success", "message": "Daily session activated"}), 200
    except Exception as e:
        logger.error(f"Session Error: {e}")
        return jsonify({"error": "Failed to generate session", "details": str(e)}), 500


# ─────────────────────────────────────────────
# BREEZE DATA ROUTES
# ─────────────────────────────────────────────
@app.route("/api/breeze/quotes", methods=["POST"])
@cross_origin()
def get_quotes():
    """Fetch real-time stock quotes."""
    client, err_resp, status_code = ensure_breeze_session()
    if err_resp:
        return err_resp, status_code

    data = request.get_json() or {}
    try:
        res = client.get_quotes(
            stock_code=data.get("stock_code"),
            exchange_code=data.get("exchange_code", "NSE"),
            product_type="cash"
        )
        normalized = normalize_breeze_response(res)
        if normalized:
            return jsonify(wrap_success_payload(normalized)), 200
        return jsonify({"error": "Empty response from Breeze", "raw": str(res)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/breeze/depth", methods=["POST"])
@cross_origin()
def get_depth():
    """Fetch L2 Market Depth."""
    client, err_resp, status_code = ensure_breeze_session()
    if err_resp:
        return err_resp, status_code

    data = request.get_json() or {}
    try:
        res = client.get_market_depth2(
            stock_code=data.get("stock_code"),
            exchange_code=data.get("exchange_code", "NSE"),
            product_type="cash"
        )
        normalized = normalize_breeze_response(res)
        if normalized:
            return jsonify(wrap_success_payload(normalized)), 200
        return jsonify({"error": "Empty response from Breeze", "raw": str(res)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/breeze/historical", methods=["POST"])
@cross_origin()
def get_historical():
    """Fetch historical OHLC data."""
    client, err_resp, status_code = ensure_breeze_session()
    if err_resp:
        return err_resp, status_code

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
        if isinstance(res, dict) and "Success" in res:
            return jsonify({"Success": res.get("Success") or []}), 200
        if isinstance(res, list):
            return jsonify({"Success": res}), 200
        normalized = normalize_breeze_response(res)
        if normalized:
            return jsonify(wrap_success_payload(normalized)), 200
        return jsonify({"error": "Empty response from Breeze", "raw": str(res)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────────
# GEMINI ROUTES
# ─────────────────────────────────────────────
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

    sys_instr = (
        "You are a Senior Equity Analyst and Financial Journalist for a top-tier publication, "
        "specializing in the Indian Equity Markets. Your task is to synthesize a compelling and "
        "insightful market summary that explains the key drivers behind the Nifty 50's performance "
        "for a given day. You must provide a clear narrative, supported by data and specific events."
    )

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
        response, selected_model = generate_with_model_fallback(prompt, sys_instr)
        result = extract_json(response.text)
        if result:
            if supabase:
                payload = {
                    "market_log_id": log.get('id'),
                    "headline": result.get('headline'),
                    "narrative": result.get('narrative'),
                    "outlook": result.get('outlook'),
                    "model": selected_model,
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

    sys_instr = (
        "You are a Senior Equity Analyst specializing in Indian Equities. "
        "Perform a forensic audit of a specific stock based on recent news and market data."
    )

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
        response, _ = generate_with_model_fallback(prompt, sys_instr)
        result = extract_json(response.text)
        return jsonify(result) if result else jsonify({"error": "Failed to parse AI response"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────────
# SOCKET.IO HANDLERS
# ─────────────────────────────────────────────
@socketio.on('connect')
def handle_connect():
    logger.info(f"Client connected: {request.sid}")


@socketio.on('disconnect')
def handle_disconnect():
    logger.info(f"Client disconnected: {request.sid}")


@socketio.on('subscribe_to_watchlist')
def handle_watchlist_subscription(data):
    sid = request.sid
    stock_list = data.get('stocks', [])
    proxy_key = data.get('proxy_key', '')
    logger.info(f"Client {sid} subscribed to watchlist: {stock_list}")
    socketio.start_background_task(track_watchlist, stock_list, proxy_key, sid)


def track_watchlist(stock_list, proxy_key, sid):
    """
    Uses Breeze WebSocket feeds for real-time watchlist updates.
    Subscribes once per stock and emits ticks via callback — no REST polling.
    """
    client, err_resp, _ = ensure_breeze_session()
    if err_resp:
        logger.error(f"Could not get Breeze session for watchlist (sid={sid}).")
        socketio.emit('watchlist_error', {"error": "Breeze session not available"}, room=sid)
        return

    # Build aliases: any incoming identifier -> frontend standard symbol
    symbol_map = {}
    for symbol in stock_list:
        std = canonical_symbol(symbol)
        breeze_code = canonical_symbol(get_breeze_symbol(std))
        symbol_map[std] = std
        symbol_map[breeze_code] = std
        if std == "NIFTY":
            symbol_map["NIFTY 50"] = std

    def on_ticks(ticks):
        """Callback fired by Breeze WebSocket on every price update."""
        try:
            # FIX: pass required '/' namespace argument to is_connected
            if not socketio.server.manager.is_connected(sid, '/'):
                return

            # Breeze quote ticks may contain stock_code, stock_name, or token in symbol (e.g., "4.1!NIFTY 50")
            raw_symbol = ticks.get("stock_code") or ticks.get("stock_name") or ticks.get("symbol") or ""
            token_match = re.match(r"^\d+\.\d+!(.+)$", str(raw_symbol))
            if token_match:
                raw_symbol = token_match.group(1)

            resolved_symbol = symbol_map.get(canonical_symbol(raw_symbol))
            if not resolved_symbol:
                # last-resort fallback for single-subscription clients
                resolved_symbol = canonical_symbol(stock_list[0]) if len(stock_list) == 1 else canonical_symbol(raw_symbol)

            payload = normalize_tick_for_frontend(ticks, resolved_symbol)
            socketio.emit('watchlist_update', payload, room=sid)
        except Exception as e:
            logger.error(f"Error emitting tick to {sid}: {e}")

    # Connect Breeze WebSocket and assign tick callback
    try:
        client.on_ticks = on_ticks
        client.ws_connect()
        logger.info(f"Breeze WebSocket connected for client {sid}")
    except Exception as e:
        logger.error(f"Breeze WebSocket connection failed for {sid}: {e}")
        socketio.emit('watchlist_error', {"error": "WebSocket connection failed"}, room=sid)
        return

    # Subscribe to each stock feed
    subscribed_codes = []
    for symbol in stock_list:
        breeze_code = canonical_symbol(get_breeze_symbol(symbol))
        try:
            client.subscribe_feeds(
                exchange_code="NSE",
                stock_code=breeze_code,
                product_type="cash",
                get_exchange_quotes=True,
                get_market_depth=False
            )
            subscribed_codes.append((breeze_code, symbol))
            logger.info(f"Subscribed to feed: {symbol} ({breeze_code})")
        except Exception as e:
            logger.error(f"Failed to subscribe to {symbol}: {e}")

    # Keep background task alive while client is connected
    # Ticks arrive via on_ticks callback above — no polling needed here
    while True:
        try:
            # FIX: pass '/' namespace to is_connected
            if not socketio.server.manager.is_connected(sid, '/'):
                logger.info(f"Client {sid} disconnected — cleaning up feeds.")
                break
        except Exception:
            break
        socketio.sleep(5)

    # Clean up: unsubscribe feeds and disconnect WebSocket
    for breeze_code, symbol in subscribed_codes:
        try:
            client.unsubscribe_feeds(
                exchange_code="NSE",
                stock_code=breeze_code,
                product_type="cash",
                get_exchange_quotes=True,
                get_market_depth=False
            )
            logger.info(f"Unsubscribed feed: {symbol} ({breeze_code})")
        except Exception as e:
            logger.error(f"Error unsubscribing {symbol}: {e}")

    try:
        client.ws_disconnect()
        logger.info(f"Breeze WebSocket disconnected for client {sid}")
    except Exception as e:
        logger.error(f"Error disconnecting WebSocket for {sid}: {e}")


# ─────────────────────────────────────────────
# STARTUP
# ─────────────────────────────────────────────
if __name__ == "__main__":
    initialize_ai_clients()
    port = int(os.environ.get("PORT", 8082))
    socketio.run(app, host="0.0.0.0", port=port, debug=False)