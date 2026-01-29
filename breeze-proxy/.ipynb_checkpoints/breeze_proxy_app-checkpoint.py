
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
    global breeze_client
    if breeze_client is None:
        try:
            # This will check Secret Manager first, then your 'export' variables
            api_key = get_secret("BREEZE_API_KEY") 
            
            if not api_key:
                logger.error("API Key is empty! Check your exports or Secret Manager.")
                return None

            breeze_client = BreezeConnect(api_key=api_key)
            logger.info(f"BreezeConnect initialized with key ending in: {api_key[-4:]}")
        except Exception as e:
            logger.error(f"Breeze initialization error: {e}")
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
    
    # FIX: Add a third None here to satisfy the 3-variable unpack in your routes
    return client, None, None

# --- API Routes ---

@app.route("/breeze/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "session_active": bool(DAILY_SESSION_TOKEN)})

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
    # Add status_code to the unpack list
    client, err_resp, status_code = ensure_breeze_session()
    
    # If there is an error response, return it with the status code
    if err_resp: 
        return err_resp, status_code

    data = request.get_json() or {}
    stock_code = data.get("stock_code")
    if not stock_code: return jsonify({"error": "stock_code required"}), 400

    try:
        raw_data = client.get_quotes(
            stock_code=stock_code, 
            exchange_code=data.get("exchange_code", "NSE"), 
            product_type="cash"
        )
        
        if raw_data and raw_data.get("Success"):
            row = raw_data["Success"][0]
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
                "best_offer_quantity": float(row.get("best_offer_quantity", 0))
            }
            return jsonify({"Success": formatted}), 200
        return jsonify({"error": "No data returned from Breeze"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# --- Corrected Market Depth ---
@app.route("/breeze/depth", methods=["POST"])
def get_depth(): # Unique name
    client, err_resp, status_code = ensure_breeze_session() # Catching all 3 values
    if err_resp: 
        return err_resp, status_code

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

# --- Corrected Historical Data ---
@app.route("/breeze/historical", methods=["POST"])
def get_historical(): # Unique name
    client, err_resp, status_code = ensure_breeze_session() # Catching all 3 values
    if err_resp: 
        return err_resp, status_code

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
        return jsonify(res), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500



if __name__ == "__main__":
    # Change debug to True
    app.run(host="0.0.0.0", port=8081, debug=True)