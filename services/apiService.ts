
import { MarketLog, NewsAttribution } from "../types";

/**
 * CRITICAL: This must point to your Flask Backend URL (Cloud Run).
 * Studio AI apps run in the browser, so relative paths like "/api/..." will fail.
 */
const BACKEND_URL = "https://market-attribution-backend-919207294606.us-west1.run.app"; 

const getHeaders = () => {
  const proxyKey = localStorage.getItem("breeze_proxy_key") || "";
  return {
    "Content-Type": "application/json",
    "X-Proxy-Key": proxyKey,
    "X-Proxy-Admin-Key": proxyKey // Used for session handshake
  };
};

const handleResponse = async (res: Response) => {
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ message: "Unknown Server Error" }));
    throw new Error(errorData.message || `API Error: ${res.status}`);
  }
  return res.json();
};

// ---- Breeze session (Frontend -> Flask -> Breeze Proxy) ----
export const setBreezeSession = async (apiSession: string) => {
  const res = await fetch(`${BACKEND_URL}/api/breeze/admin/api-session`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ api_session: apiSession }),
  });
  return handleResponse(res);
};

// ---- Breeze quote/depth/historical (Frontend -> Flask -> Breeze Proxy) ----
export const fetchQuote = async (symbol: string) => {
  const res = await fetch(`${BACKEND_URL}/api/market/quote`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ symbol }),
  });
  const data = await handleResponse(res);
  if (!data.Success) throw new Error(`No quote data for ${symbol}`);
  return data.Success;
};

export const fetchDepth = async (symbol: string) => {
  const res = await fetch(`${BACKEND_URL}/api/market/depth`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ symbol }),
  });
  const data = await handleResponse(res);
  return data;
};

export const fetchHistorical = async (symbol: string, fromDate: string, toDate: string) => {
  const res = await fetch(`${BACKEND_URL}/api/market/historical`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ symbol, from_date: fromDate, to_date: toDate }),
  });
  const data = await handleResponse(res);
  return data.Success || [];
};

export const fetchNiftyRealtime = async () => {
  const res = await fetch(`${BACKEND_URL}/api/market/nifty-realtime`, {
    headers: getHeaders()
  });
  return handleResponse(res);
};

// ---- Gemini/Vertex intelligence (Frontend -> Flask only) ----
export const analyzeMarketRadar = async (log: MarketLog): Promise<NewsAttribution> => {
  const res = await fetch(`${BACKEND_URL}/api/gemini/analyze_market_log`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(log),
  });
  return handleResponse(res);
};

export const analyzeStockDeepDive = async (symbol: string): Promise<NewsAttribution> => {
  const res = await fetch(`${BACKEND_URL}/api/gemini/stock-deep-dive`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ symbol }),
  });
  return handleResponse(res);
};

export const analyzeReg30EventText = async (event_text: string) => {
  const res = await fetch(`${BACKEND_URL}/api/reg30/analyze_event_text`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ event_text }),
  });
  return handleResponse(res);
};
