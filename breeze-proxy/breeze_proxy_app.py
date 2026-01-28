
from flask import Flask, request, jsonify
from breeze_connect import BreezeConnect
from google.cloud import secretmanager
import os
import json
import logging

app = Flask(__name__)

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Global State & Cache ---
_secret_cache = {}
breeze_client = None
DAILY_SESSION_TOKEN = None

def get_secret(secret_name):
    """Fetch secrets from Google Secret Manager with local caching."""
    if secret_name in _secret_cache:
        return _secret_cache[secret_name]
    
    project_id = os.environ.get("GCP_PROJECT_ID")
    if not project_id:
        # Fallback for local development
        return os.environ.get(secret_name)
    
    client = secretmanager.SecretManagerServiceClient()
    name = f"projects/{project_id}/secrets/{secret_name}/versions/latest"
    try:
        response = client.access_secret_version(request={"name": name})
        val = response.payload.data.decode("UTF-8")
        _secret_cache[secret_name] = val
        return val
    except Exception as e:
        logger.error(f"Failed to fetch secret {secret_name}: {e}")
        return os.environ.get(secret_name)

def initialize_breeze():
    """Initializes the BreezeConnect client instance."""
    global breeze_client
    if breeze_client is None:
        try:
            api_key = get_secret("BREEZE_API_KEY")
            breeze_client = BreezeConnect(api_key=api_key)
            logger.info("BreezeConnect client initialized.")
        except Exception as e:
            logger.error(f"Breeze initialization error: {e}")
            breeze_client = None
    return breeze_client

def ensure_breeze_session():
    """Validates the active session before processing data requests."""
    client = initialize_breeze()
    if not client:
        return None, jsonify({"error": "Breeze client not initialized"}), 500
    
    if not client.session_key and DAILY_SESSION_TOKEN:
        try:
            client.generate_session(api_secret=get_secret("BREEZE_API_SECRET"), session_token=DAILY_SESSION_TOKEN)
            logger.info("Breeze session regenerated.")
        except Exception as e:
            return None, jsonify({"error": f"Session invalid: {e}"}), 401
    elif not client.session_key:
        return None, jsonify({"error": "Breeze session token not set. Use /admin/api-session"}), 401
    
    return client, None

# --- API Routes ---

@app.route("/breeze/health", methods=["GET"])
def health():
    """Health check endpoint with detailed status"""
    return jsonify({
        "status": "ok", 
        "session_active": bool(DAILY_SESSION_TOKEN),
        "breeze_client_initialized": breeze_client is not None,
        "session_key_set": bool(breeze_client and breeze_client.session_key) if breeze_client else False
    })

@app.route("/breeze/admin/api-session", methods=["POST"])
def set_session():
    """Handshake from UI to activate the daily data pipe."""
    global DAILY_SESSION_TOKEN
    data = request.get_json() or {}
    api_session = data.get("api_session")
    admin_key = request.headers.get("X-Proxy-Admin-Key")

    if admin_key != get_secret("BREEZE_PROXY_ADMIN_KEY"):
        return jsonify({"error": "Unauthorized"}), 401

    if not api_session:
        return jsonify({"error": "api_session is required"}), 400
    
    client = initialize_breeze()
    try:
        client.generate_session(api_secret=get_secret("BREEZE_API_SECRET"), session_token=api_session)
        DAILY_SESSION_TOKEN = api_session
        return jsonify({"status": "success", "message": "Daily session activated"}), 200
    except Exception as e:
        return jsonify({"error": f"Failed to generate session: {e}"}), 500

@app.route("/breeze/quotes", methods=["POST"])
def get_quotes():
    """Fetch quotes from Breeze API with improved error handling"""
    client, err_resp = ensure_breeze_session()
    if err_resp: return err_resp

    data = request.get_json() or {}
    stock_code = data.get("stock_code")
    if not stock_code: 
        return jsonify({"error": "stock_code required"}), 400

    exchange_code = data.get("exchange_code", "NSE")
    product_type = data.get("product_type", "cash")
    
    logger.info(f"Fetching quote for {stock_code} on {exchange_code}")

    try:
        raw_data = client.get_quotes(
            stock_code=stock_code, 
            exchange_code=exchange_code, 
            product_type=product_type
        )
        
        logger.info(f"Raw data from Breeze: {raw_data}")
        
        if raw_data and raw_data.get("Success"):
            # Handle both dict and list responses
            success_data = raw_data["Success"]
            if isinstance(success_data, list):
                if len(success_data) == 0:
                    return jsonify({"error": f"No data for {stock_code}"}), 404
                row = success_data[0]
            else:
                row = success_data
            
            formatted = {
                "last_traded_price": float(row.get("ltp", 0)),
                "change": float(row.get("change", 0)),
                "percent_change": float(row.get("ltp_percent_change", 0)),
                "high": float(row.get("high", 0)),
                "low": float(row.get("low", 0)),
                "open": float(row.get("open", 0)),
                "volume": float(row.get("total_quantity_traded", 0)),
                "previous_close": float(row.get("previous_close", 0)),
                "best_bid_price": float(row.get("best_bid_price", 0)),
                "best_bid_quantity": float(row.get("best_bid_quantity", 0)),
                "best_offer_price": float(row.get("best_offer_price", 0)),
                "best_offer_quantity": float(row.get("best_offer_quantity", 0)),
                "stock_code": stock_code
            }
            logger.info(f"Quote fetched successfully for {stock_code}")
            return jsonify({"Success": formatted}), 200
        else:
            error_msg = raw_data.get("Error", "No data returned from Breeze")
            logger.error(f"Breeze API error for {stock_code}: {error_msg}")
            return jsonify({"error": error_msg}), 404
            
    except Exception as e:
        logger.error(f"Exception fetching quote for {stock_code}: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

@app.route("/breeze/depth", methods=["POST"])
def get_depth():
    client, err_resp = ensure_breeze_session()
    if err_resp: return err_resp

    data = request.get_json() or {}
    try:
        res = client.get_market_depth(
            stock_code=data.get("stock_code"),
            exchange_code="NSE",
            product_type="cash"
        )
        return jsonify(res), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/breeze/historical", methods=["POST"])
def get_historical():
    client, err_resp = ensure_breeze_session()
    if err_resp: return err_resp

    data = request.get_json() or {}
    try:
        res = client.get_historical_data(
            stock_code=data.get("stock_code"),
            exchange_code="NSE",
            product_type="cash",
            from_date=data.get("from_date"),
            to_date=data.get("to_date"),
            interval=data.get("interval", "1day")
        )
        if res and res.get("Success"):
            bars = [{
                "datetime": b.get("datetime"),
                "open": float(b.get("open", 0)),
                "high": float(b.get("high", 0)),
                "low": float(b.get("low", 0)),
                "close": float(b.get("close", 0)),
                "volume": float(b.get("volume", 0))
            } for b in res["Success"]]
            return jsonify({"Success": bars}), 200
        return jsonify(res), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8081)))
