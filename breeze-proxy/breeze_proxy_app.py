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
    Ordered fallback list for us-central1 and other regions.
    Try 2.5 first, then 2.0, then 1.5 so at least one model is available.
    """
    raw = get_secret("GEMINI_MODELS") or os.environ.get("GEMINI_MODELS", "")
    configured = [m.strip() for m in raw.split(",") if m and m.strip()]
    if configured:
        return configured
    return [
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        "gemini-2.0-flash",
        "gemini-1.5-flash",
        "gemini-1.5-pro",
    ]


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

    from datetime import datetime, timedelta
    import math

    initialize_ai_clients()
    if not ai_client:
        return jsonify({"error": "Gemini AI client not initialized"}), 500

    data = request.get_json(silent=True) or {}
    symbol = (data.get('symbol') or '').strip().upper()
    if not symbol:
        return jsonify({"error": "Missing required field: symbol"}), 400

    date = data.get('date', str(get_ist_now().date()))

    # Clamp future/invalid dates to today
    try:
        req_date = datetime.strptime(date, "%Y-%m-%d").date()
        today = get_ist_now().date()
        if req_date > today:
            date = str(today)
            req_date = today
    except Exception:
        date = str(get_ist_now().date())
        req_date = get_ist_now().date()

    # ---------- Helpers ----------
    def _safe_float(x):
        try:
            if x is None or x == "":
                return None
            return float(x)
        except Exception:
            return None

    def _get(row, *keys):
        for k in keys:
            if isinstance(row, dict) and k in row and row[k] not in (None, ""):
                return row[k]
        return None

    def ema(series, period):
        if not series or len(series) < period:
            return None
        k = 2 / (period + 1.0)
        e = series[0]
        for val in series[1:]:
            e = (val * k) + (e * (1 - k))
        return e

    def rsi(series, period=14):
        if not series or len(series) < period + 1:
            return None
        gains, losses = [], []
        for i in range(1, len(series)):
            d = series[i] - series[i - 1]
            gains.append(max(d, 0.0))
            losses.append(max(-d, 0.0))
        avg_gain = sum(gains[:period]) / period
        avg_loss = sum(losses[:period]) / period
        for i in range(period, len(gains)):
            avg_gain = (avg_gain * (period - 1) + gains[i]) / period
            avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return 100.0 - (100.0 / (1.0 + rs))

    def atr(highs, lows, closes, period=14):
        if not closes or len(closes) < period + 1:
            return None
        trs = []
        for i in range(1, len(closes)):
            tr = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1]),
            )
            trs.append(tr)
        a = sum(trs[:period]) / period
        for i in range(period, len(trs)):
            a = (a * (period - 1) + trs[i]) / period
        return a

    def normalize_result(result):
        """
        Hard consistency rules so UI doesn't show bullish + avoid/sell without MIXED.
        """
        try:
            sr = result.get("swing_recommendation") or {}
            action = (sr.get("action") or "").upper().strip()
            sentiment = (result.get("sentiment") or "").upper().strip()

            if action in ("SELL", "AVOID") and sentiment == "BULLISH":
                result["sentiment"] = "MIXED"
            if action == "BUY" and sentiment == "BEARISH":
                result["sentiment"] = "MIXED"

            # If we had to change sentiment, make sure category isn't lying
            if result.get("sentiment") == "MIXED" and result.get("category") in ("SECTOR_TAILWIND", "EARNINGS", "ORDER_WIN"):
                # keep as-is, but MIXED is allowed; no forced overwrite
                pass

            return result
        except Exception:
            return result

    # ---------- Pull OHLC + LTP/Quote ----------
    ohlc_block = ""
    tech_ok = False

    last_close = None
    ltp = None
    prev_close = None

    try:
        client, err_resp, status_code = ensure_breeze_session()
        if err_resp:
            client = None

        # 1) Quotes/LTP (works even when market is closed; gives last traded/last available)
        if client:
            quote_res = None
            # Try common Breeze quote methods defensively
            for fn_name in ("get_quotes", "get_quote", "get_market_data", "get_stock_quote"):
                if hasattr(client, fn_name):
                    try:
                        fn = getattr(client, fn_name)
                        # Different SDKs have different arg names; try safest patterns
                        try:
                            quote_res = fn(stock_code=symbol, exchange_code="NSE", product_type="cash")
                        except TypeError:
                            try:
                                quote_res = fn(stock_code=symbol, exchange_code="NSE")
                            except TypeError:
                                quote_res = fn(symbol)
                        break
                    except Exception:
                        continue

            # Normalize quote payload
            q = None
            if isinstance(quote_res, dict):
                if "Success" in quote_res:
                    s = quote_res.get("Success")
                    if isinstance(s, list) and s:
                        q = s[0]
                    elif isinstance(s, dict):
                        q = s
                else:
                    q = quote_res

            if isinstance(q, dict):
                ltp = _safe_float(_get(q, "ltp", "LTP", "last_traded_price", "LastTradedPrice", "last"))
                prev_close = _safe_float(_get(q, "previous_close", "PrevClose", "prev_close", "previousClose", "close"))
                last_close = prev_close  # keep a baseline

        # 2) Historical candles to compute indicators
        candles = []
        if client:
            to_date = req_date
            from_date = to_date - timedelta(days=180)
            res = client.get_historical_data(
                stock_code=symbol,
                exchange_code="NSE",
                product_type="cash",
                from_date=str(from_date),
                to_date=str(to_date),
                interval="1day"
            )

            rows = []
            if isinstance(res, dict) and "Success" in res:
                rows = res.get("Success") or []
            elif isinstance(res, list):
                rows = res
            else:
                normalized = normalize_breeze_response(res)
                if normalized:
                    rows = normalized

            for r in (rows or []):
                o = _safe_float(_get(r, "open", "Open", "OPEN"))
                h = _safe_float(_get(r, "high", "High", "HIGH"))
                l = _safe_float(_get(r, "low", "Low", "LOW"))
                c = _safe_float(_get(r, "close", "Close", "CLOSE"))
                v = _safe_float(_get(r, "volume", "Volume", "VOLUME"))
                if None not in (o, h, l, c):
                    candles.append({"open": o, "high": h, "low": l, "close": c, "volume": v})

        if len(candles) >= 60:
            closes = [x["close"] for x in candles]
            highs = [x["high"] for x in candles]
            lows = [x["low"] for x in candles]
            vols = [x["volume"] for x in candles]

            last_close = closes[-1]  # authoritative from candles
            ema20 = ema(closes[-60:], 20)
            ema50 = ema(closes[-120:], 50) if len(closes) >= 120 else ema(closes, 50)
            rsi14 = rsi(closes, 14)
            atr14 = atr(highs, lows, closes, 14)

            lookback20 = closes[-20:]
            high20 = max(lookback20) if lookback20 else None
            low20 = min(lookback20) if lookback20 else None

            trend = "UPTREND" if (ema20 and ema50 and last_close > ema20 and ema20 > ema50) else \
                    "DOWNTREND" if (ema20 and ema50 and last_close < ema20 and ema20 < ema50) else "MIXED"

            vol_signal = "UNAVAILABLE"
            valid_vols = [v for v in vols[-30:] if isinstance(v, (int, float)) and v is not None and not math.isnan(v)]
            if len(valid_vols) >= 20 and vols[-1] is not None:
                avg20v = sum(valid_vols[-20:]) / 20
                vol_signal = "ABOVE_AVG" if vols[-1] > avg20v * 1.1 else "BELOW_AVG" if vols[-1] < avg20v * 0.9 else "NEAR_AVG"

            tech_ok = True

            ohlc_block = f"""
MARKET_SNAPSHOT (Breeze):
- last_close: {round(last_close, 2)}
- ltp: {round(ltp, 2) if ltp is not None else None}
- prev_close: {round(prev_close, 2) if prev_close is not None else None}

OHLC_TECHNICALS (computed from Breeze daily candles, recent ~6M):
- ema20: {round(ema20, 2) if ema20 is not None else None}
- ema50: {round(ema50, 2) if ema50 is not None else None}
- rsi14: {round(rsi14, 2) if rsi14 is not None else None}
- atr14: {round(atr14, 2) if atr14 is not None else None}
- 20d_high_close: {round(high20, 2) if high20 is not None else None}
- 20d_low_close: {round(low20, 2) if low20 is not None else None}
- trend: {trend}
- volume_signal: {vol_signal}

HARD RULES FOR SWING CALL:
- You MUST derive swing_recommendation from OHLC_TECHNICALS + MARKET_SNAPSHOT.
- If OHLC_TECHNICALS exists, you MUST NOT say "insufficient technical data".
- Use invalidation as a level: below ema20 or below 20d_low_close or ATR-based (e.g., entry - 1.5*ATR).
"""
        else:
            # Even if candles fail, still provide snapshot so model doesn't claim "no data" if LTP exists
            ohlc_block = f"""
MARKET_SNAPSHOT (Breeze):
- last_close: {round(last_close, 2) if last_close is not None else None}
- ltp: {round(ltp, 2) if ltp is not None else None}
- prev_close: {round(prev_close, 2) if prev_close is not None else None}

NOTE:
- OHLC candles were not sufficient to compute indicators. Swing recommendation must be conservative (HOLD/AVOID) and explain missing candles.
"""
    except Exception as e:
        logger.warning(f"OHLC/quote fetch failed for {symbol}: {e}")
        ohlc_block = ""

    sys_instr = (
        "You are a Senior Equity Analyst specializing in Indian Equities. "
        "You MUST be factual and internally consistent. "
        "If you are not able to verify a claim from reliable, recent sources, you must say so and omit it. "
        "Never invent analyst ratings/targets. Never use the word 'hypothetical'. "
        "All outputs must follow the JSON schema exactly."
    )

    prompt = f"""
As a Senior Equity Analyst, perform a FORENSIC AUDIT for the NSE stock symbol: {symbol} for the date: {date}.

{ohlc_block}

CRITICAL DATA RULES (MUST FOLLOW):
- Use only RECENT information (prefer last 30 days from {date}; max 90 days if needed and clearly label it).
- Do NOT fabricate news, events, prices, analyst calls, targets, or broker names.
- Never use the word "hypothetical".
- Prefer authoritative sources (NSE filings/announcements, company disclosures, major financial media).
- Brokerage/analyst calls: only include if publicly verifiable with a working source_url.

CONSISTENCY RULES (MUST FOLLOW):
- headline + narrative + sentiment + swing_recommendation MUST NOT contradict each other.
- If OHLC_TECHNICALS exists, swing_recommendation MUST be derived from it and MUST reference at least 2 indicators (e.g., ema20/ema50, rsi14, atr14, 20d levels).
- If fundamentals/news are bullish but technical swing setup is bearish (or vice-versa), set sentiment to "MIXED" and explain the divergence in narrative.

OBJECTIVES:
1) Identify primary price movement drivers for {symbol} based on verified recent news/events (include dates + why it mattered).
2) Provide 3–6 driver facts inside the narrative.
3) Analyst calls: only real, attributable calls with source_url; otherwise return analyst_calls: [].
4) Write a 300+ word causal narrative with risks + what to watch next 1–4 weeks.
5) Provide a swing trading recommendation (1D–1M) based on OHLC_TECHNICALS and MARKET_SNAPSHOT.

OUTPUT RULES:
Return STRICT JSON with EXACT keys:
headline, narrative, category, sentiment, impact_score, swing_recommendation, affected_stocks, affected_sectors, analyst_calls

NOW PRODUCE THE JSON ONLY. No extra text.
"""

    last_err = None

    # Grounded web first
    for model_name in get_gemini_model_candidates():
        try:
            response = ai_client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=sys_instr,
                    tools=[{"google_search": {}}],
                    temperature=0.2,
                    top_p=0.9,
                ),
            )
            result = extract_json(response.text)
            if result:
                result = normalize_result(result)
                return jsonify(result)
        except Exception as e:
            last_err = e
            logger.warning(f"Stock deep-dive grounded ({model_name}): {e}")
            continue

    # Fallback helper
    try:
        response, _ = generate_with_model_fallback(prompt, sys_instr)
        result = extract_json(response.text)
        if result:
            result = normalize_result(result)
            return jsonify(result)
    except Exception as e:
        last_err = e
        logger.warning(f"Stock deep-dive fallback failed: {e}")

    err_msg = str(last_err) if last_err else "No model succeeded"
    return jsonify({"error": f"Equity deep dive failed. {err_msg}"}), 500


@app.route('/api/attachment/parse', methods=['POST', 'OPTIONS'])
@cross_origin()
def parse_attachment():
    """Fetch a URL (e.g. NSE iXBRL) and return extracted text for Reg30 analysis."""
    if request.method == 'OPTIONS':
        return jsonify(success=True)
    try:
        import requests as req
        data = request.get_json(silent=True) or {}
        url = (data.get('url') or '').strip()
        if not url or not url.startswith('http'):
            return jsonify({"error": "Missing or invalid url"}), 400
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        }
        if 'nseindia.com' in url or 'nsearchives.nseindia.com' in url:
            headers['Referer'] = 'https://www.nseindia.com/'
        import time
        last_err = None
        for attempt in range(2):
            try:
                r = req.get(url, headers=headers, timeout=35)
                r.raise_for_status()
                html = r.text
                break
            except Exception as e:
                last_err = e
                if attempt == 0:
                    time.sleep(2)
        else:
            raise last_err
        # Strip tags and collapse whitespace for text extraction
        text = re.sub(r'<script[^>]*>[\s\S]*?</script>', ' ', html, flags=re.IGNORECASE)
        text = re.sub(r'<style[^>]*>[\s\S]*?</style>', ' ', text, flags=re.IGNORECASE)
        text = re.sub(r'<[^>]+>', ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()
        return jsonify({"text": text[:100000] if text else ""})
    except Exception as e:
        logger.warning(f"Attachment parse failed: {e}")
        return jsonify({"error": str(e), "text": ""}), 500


@app.route('/api/gemini/reg30-analyze', methods=['POST', 'OPTIONS'])
@cross_origin()
def reg30_analyze():
    """Run Reg30 event analysis with Gemini. Extraction only; impact scoring is done in frontend."""
    if request.method == 'OPTIONS':
        return jsonify(success=True)
    initialize_ai_clients()
    if not ai_client:
        return jsonify({"error": "Gemini AI client not initialized"}), 500
    try:
        data = request.get_json(silent=True) or {}
        candidate = data.get('candidate') or {}
        attachment_text = (data.get('attachment_text') or '').strip()[:30000]
        if len(attachment_text) < 100:
            return jsonify({
                "error": "Document text empty or too short. The link could not be fetched or the page has no extractable content. Check the URL or try again later."
            }), 400
        company_name = candidate.get('company_name') or 'Unknown'
        symbol = candidate.get('symbol') or ''
        source = candidate.get('source') or 'XBRL'
        raw_text = candidate.get('raw_text') or ''
        prompt = (
            "Perform a forensic extraction on this NSE disclosure:\n"
            f"Company: {company_name}\n"
            f"Symbol: {symbol}\n"
            f"Source: {source}\n"
            f"Context: {raw_text}\n\n"
            f"Document Text: {attachment_text}\n\n"
            "Return STRICT JSON only with these keys: summary (string), direction_hint (one of: POSITIVE, NEGATIVE, NEUTRAL), "
            "confidence (number 0-1), missing_fields (array of strings), evidence_spans (array of strings, max 160 chars each), "
            "extracted (object with: symbol, company_name, order_value_cr, stage, execution_months, execution_years, end_date, "
            "order_type, customer, international, new_customer, conditionality, rating_action, notches, outlook_change, "
            "amount_cr, stage_legal, ops_impact; and when present in document: nse_symbol, market_cap_cr)."
        )
        sys_instr = (
            "You are an expert Indian equity events analyst focused on NSE Regulation 30–style disclosures and order-pipeline events. "
            "You ONLY summarize and extract structured data from provided text. You do NOT browse the web.\n\n"
            "HARD RULES:\n"
            "1) NEVER fabricate numbers or facts. If not present, output null and add the field name to missing_fields.\n"
            "2) Use only provided raw_text/attachment_text. No external sources.\n"
            "3) Provide evidence_spans (<=160 chars each) for key extractions/classifications.\n"
            "4) CURRENCY: Convert raw INR to Crore (CR). 1 CR = 10,000,000 INR.\n"
            "5) STAGE: Must be one of: \"L1\" | \"LOA\" | \"WO\" | \"NTP\" | \"MOU\" | \"OTHER\".\n"
            "6) Output MUST be STRICT JSON only.\n"
            "7) MANDATORY: Read the very beginning of the document. Look for a 'General Information' section with 'NSE Symbol*' and 'Name of the Company*' (or similar). Set extracted.nse_symbol to the symbol value (e.g. MCLOUD, AHUCON) and extracted.company_name to the full company name. Always prefer these document values over any context.\n"
            "8) If the document mentions market cap or market capitalization (in Cr or Rs), extract as market_cap_cr (number in Crore).\n"
            "9) For order_value_cr use ONLY 'Broad commercial consideration' or 'size of the order(s)/contract(s)' (convert to Crore). Do NOT use 'Value of the order(s)/contract(s)' — it often has data entry errors (extra zeros)."
        )
        for model_name in get_gemini_model_candidates():
            try:
                response = ai_client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(system_instruction=sys_instr),
                )
                result = extract_json(response.text)
                if not result or not isinstance(result.get('summary'), str):
                    continue
                # Normalize: promote symbol/company from extracted to top level so frontend always has them
                extracted = result.get('extracted') or {}
                if not isinstance(extracted, dict):
                    extracted = {}
                result['symbol'] = extracted.get('nse_symbol') or extracted.get('symbol') or result.get('symbol') or symbol or ''
                result['company_name'] = extracted.get('company_name') or result.get('company_name') or company_name or 'Unknown'
                result['extracted'] = extracted
                return jsonify(result)
            except Exception as e:
                logger.warning(f"Reg30 analyze ({model_name}): {e}")
                continue
        return jsonify({"error": "Reg30 analysis failed"}), 500
    except Exception as e:
        logger.exception("Reg30 analyze error")
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