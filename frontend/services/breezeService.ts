/**
 * ICICI BREEZE API CLIENT
 */
import { supabase } from '../lib/supabase';

const DEFAULT_PROXY_URL =
  import.meta.env.VITE_PROXY_URL || "https://maia-breeze-proxy-service-919207294606.us-central1.run.app";

const HARDCODED_MAPPINGS: Record<string, string> = {
  'AHLUCONT': 'AHLCON',
  'AXISCADES': 'AXIIT',
  'MEDICO': 'MEDREM',
  'WAAREERTL': 'SANADV',
  'SANGHVIMOV': 'SANMOV'
};

// Module-level cache for symbol mappings
let mappingCache: Record<string, string> = { ...HARDCODED_MAPPINGS };

export interface BreezeQuote {
  last_traded_price: number;
  change: number;
  percent_change: number;
  open: number;
  high: number;
  low: number;
  previous_close: number;
  volume: number;
  stock_code?: string;
  best_bid_price?: number;
  best_bid_quantity?: number;
  best_offer_price?: number;
  best_offer_quantity?: number;
}

export interface BreezeDepth {
  best_bid_price: number;
  best_bid_quantity: number;
  best_offer_price: number;
  best_offer_quantity: number;
  depth?: any;
}

export interface HistoricalBar {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const getProxyBaseUrl = () => {
  let base = localStorage.getItem('breeze_proxy_url') || DEFAULT_PROXY_URL;
  base = (base || DEFAULT_PROXY_URL).trim().replace(/\/$/, "");
  if (base && !base.startsWith('http')) base = `https://${base}`;
  return base || DEFAULT_PROXY_URL;
};

export const resolveApiUrl = (endpoint: string) => {
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const base = getProxyBaseUrl();
  return `${base}${path}`;
};

export const checkProxyHealth = async () => {
  const apiUrl = resolveApiUrl(`/api/breeze/health`);
  try {
    const response = await fetch(apiUrl);
    if (!response.ok) return { ok: false, error: 'Proxy unreachable' };
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      return { ok: false, error: 'Non-JSON health response' };
    }
  } catch (e) {
    return { ok: false, error: 'Network error connecting to proxy' };
  }
};

export const getStockMappings = async (symbols: string[]): Promise<Record<string, string>> => {
  if (symbols.length === 0) return mappingCache;
  
  const missingSymbols = symbols.filter(s => !mappingCache[s]);
  
  if (missingSymbols.length === 0) {
    return mappingCache;
  }

  try {
    const { data, error } = await supabase
      .from('nse_master_list')
      .select('symbol, short_name')
      .in('symbol', missingSymbols);
    
    if (!error && data) {
      data.forEach(curr => {
        mappingCache[curr.symbol] = curr.short_name;
      });
    }
  } catch (e) {
    console.warn("Symbol mapping fetch failed.");
  }
  
  return mappingCache;
};

export const setDailyBreezeSession = async (apiSession: string, adminKey: string) => {
  const apiUrl = resolveApiUrl(`/api/breeze/admin/api-session`);
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Proxy-Admin-Key": adminKey
    },
    body: JSON.stringify({ api_session: apiSession })
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error("Gateway returned invalid response format");
  }
  
  if (!response.ok) throw new Error(json?.message || "Failed to set daily session");
  return json;
};

export const fetchBreezeQuote = async (stockCode: string): Promise<BreezeQuote> => {
  const apiUrl = resolveApiUrl(`/api/breeze/quotes`);
  const proxyKey = localStorage.getItem('breeze_proxy_key') || "";

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Proxy-Key': proxyKey,
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      stock_code: stockCode,
      exchange_code: 'NSE',
      product_type: 'cash'
    })
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error("Breeze Proxy returned non-JSON.");
  }
  
  if (!response.ok) throw new Error(json.message || `Quote fetch failed`);

  const row = Array.isArray(json.Success) 
    ? json.Success.find((x: any) => x.exchange_code === "NSE" || x.stock_code === stockCode) 
    : (json.Success?.[0]);
  
  if (!row) throw new Error(`No quote data for ${stockCode}`);

  return normalizeBreezeQuoteFromRow(row, stockCode);
};

/**
 * Normalize raw Breeze API quote row (e.g. from REST or Socket.IO watchlist_update) to BreezeQuote.
 * Use this for socket payloads so the Nifty card always gets consistent field names.
 */
export const normalizeBreezeQuoteFromRow = (row: Record<string, unknown>, stockCode?: string): BreezeQuote => {
  const ltp = parseFloat(String(row.ltp ?? row.last_traded_price ?? 0));
  const prevClose = parseFloat(String(row.previous_close ?? 0));
  const changeVal = parseFloat(String(row.change ?? (ltp - prevClose) ?? 0));
  const pctChange = parseFloat(String(row.ltp_percent_change ?? row.chng_per ?? 0));

  return {
    last_traded_price: ltp,
    change: changeVal,
    percent_change: pctChange,
    open: parseFloat(String(row.open ?? 0)),
    high: parseFloat(String(row.high ?? 0)),
    low: parseFloat(String(row.low ?? 0)),
    previous_close: prevClose,
    volume: parseFloat(String(row.total_volume ?? row.volume ?? 0)),
    stock_code: stockCode,
    best_bid_price: parseFloat(String(row.best_bid_price ?? 0)),
    best_bid_quantity: parseFloat(String(row.best_bid_quantity ?? 0)),
    best_offer_price: parseFloat(String(row.best_offer_price ?? 0)),
    best_offer_quantity: parseFloat(String(row.best_offer_quantity ?? 0))
  };
};

export const fetchBreezeDepth = async (stockCode: string): Promise<BreezeDepth> => {
  const apiUrl = resolveApiUrl(`/api/breeze/depth`);
  const proxyKey = localStorage.getItem('breeze_proxy_key') || "";

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Proxy-Key': proxyKey
    },
    body: JSON.stringify({
      stock_code: stockCode,
      exchange_code: 'NSE',
      product_type: 'cash'
    })
  });

  const json = await response.json();
  if (!response.ok) throw new Error(json.message || "Depth fetch failed");

  const data = json.Success?.[0] || {};
  return {
    best_bid_price: parseFloat(data.best_bid_price || 0),
    best_bid_quantity: parseFloat(data.best_bid_quantity || 0),
    best_offer_price: parseFloat(data.best_offer_price || 0),
    best_offer_quantity: parseFloat(data.best_offer_quantity || 0),
    depth: data
  };
};

export const fetchBreezeHistorical = async (stockCode: string, fromDate: string, toDate: string, interval: string = '1day'): Promise<HistoricalBar[]> => {
  const apiUrl = resolveApiUrl(`/api/breeze/historical`);
  const proxyKey = localStorage.getItem('breeze_proxy_key') || "";

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Proxy-Key': proxyKey
    },
    body: JSON.stringify({
      stock_code: stockCode,
      exchange_code: 'NSE',
      product_type: 'cash',
      from_date: fromDate,
      to_date: toDate,
      interval: interval
    })
  });

  const json = await response.json();
  if (!response.ok) throw new Error(json.message || `Historical fetch failed`);

  if (!json.Success || !Array.isArray(json.Success)) return [];

  return json.Success.map((bar: any) => ({
    datetime: bar.datetime,
    open: parseFloat(bar.open),
    high: parseFloat(bar.high),
    low: parseFloat(bar.low),
    close: parseFloat(bar.close),
    volume: parseFloat(bar.volume)
  }));
};

export const fetchBreezeNiftyQuote = () => fetchBreezeQuote('NIFTY');