
import os
import json
import datetime
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS
from google import genai
from google.genai import types
from supabase import create_client, Client

app = Flask(__name__)
CORS(app)

# --- CONFIGURATION ---
GEMINI_API_KEY = os.environ.get("API_KEY")
BREEZE_PROXY_URL = "https://breeze-proxy-919207294606.us-west1.run.app"
SUPABASE_URL = "https://xbnzvmgawikqzxutmoea.supabase.co"
SUPABASE_KEY = "sb_publishable_8TYnAzAX4s-CHAPVOpmLEA_Puqwcuwo"

# --- INITIALIZATION ---
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
ai_client = genai.Client(api_key=GEMINI_API_KEY, vertexai=True)

# --- HELPERS ---
def get_ist_now():
    return datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=5, minutes=30)))

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

def get_breeze_headers():
    proxy_key = request.headers.get("X-Proxy-Key", "")
    return {
        "Content-Type": "application/json",
        "X-Proxy-Key": proxy_key
    }

# --- BREEZE PROXY ENDPOINTS ---
@app.route('/api/breeze/admin/api-session', methods=['POST'])
def set_session():
    try:
        res = requests.post(
            f"{BREEZE_PROXY_URL}/api/breeze/admin/api-session",
            json=request.json,
            headers=get_breeze_headers()
        )
        return jsonify(res.json()), res.status_code
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/breeze/quote', methods=['POST'])
def get_quote():
    try:
        res = requests.post(
            f"{BREEZE_PROXY_URL}/api/breeze/quotes",
            json=request.json,
            headers=get_breeze_headers()
        )
        return jsonify(res.json()), res.status_code
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/breeze/depth', methods=['POST'])
def get_depth():
    try:
        res = requests.post(
            f"{BREEZE_PROXY_URL}/api/breeze/depth",
            json=request.json,
            headers=get_breeze_headers()
        )
        return jsonify(res.json()), res.status_code
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/breeze/historical', methods=['POST'])
def get_historical():
    try:
        res = requests.post(
            f"{BREEZE_PROXY_URL}/api/breeze/historical",
            json=request.json,
            headers=get_breeze_headers()
        )
        return jsonify(res.json()), res.status_code
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# --- GEMINI INTELLIGENCE ENDPOINTS ---
@app.route('/api/gemini/market-radar', methods=['POST'])
def analyze_market():
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
            supabase.table('news_attribution').upsert(payload, on_conflict='market_log_id').execute()
            return jsonify(result)
        return jsonify({"error": "Failed to parse AI response"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/gemini/stock-deep-dive', methods=['POST'])
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
    except Exception