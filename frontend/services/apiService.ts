/**
 * API Service - Connects Frontend to Backend APIs
 * Provides functions for market data, quotes, and AI analysis
 */

import { MarketLog, NewsAttribution } from '../types';
import { getProxyBaseUrl, getStockMappings, normalizeBreezeQuoteFromRow } from './breezeService';

export interface QuoteResponse {
  last_traded_price: number;
  change: number;
  percent_change: number;
  open: number;
  high: number;
  low: number;
  previous_close: number;
  volume: number;
  best_bid_price?: number;
  best_bid_quantity?: number;
  best_offer_price?: number;
  best_offer_quantity?: number;
  ltp?: number;
  ltp_percent_change?: number;
  total_quantity_traded?: number;
}

export interface DepthResponse {
  best_bid_price: number;
  best_bid_quantity: number;
  best_offer_price: number;
  best_offer_quantity: number;
}

interface HistoricalBar {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const resolveStockCode = async (symbol: string) => {
  const mappings = await getStockMappings([symbol]);
  return mappings[symbol] || symbol;
};

/**
 * Fetch a quote for a given stock symbol
 */
export const fetchQuote = async (symbol: string): Promise<QuoteResponse> => {
  const stock_code = await resolveStockCode(symbol);
  const response = await fetch(`${getProxyBaseUrl()}/api/breeze/quotes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Proxy-Key': localStorage.getItem('breeze_proxy_key') || ''
    },
    body: JSON.stringify({
      stock_code,
      exchange_code: 'NSE',
      product_type: 'cash'
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to fetch quote' }));
    throw new Error(error.message || `Failed to fetch quote for ${symbol}`);
  }

  const data = await response.json();
  
  const row = Array.isArray(data.Success)
    ? data.Success.find((x: any) => x.exchange_code === "NSE" || x.stock_code === stock_code)
    : (data.Success?.[0] || data.Success);
  if (!row) throw new Error(`No quote data for ${symbol}`);

  return normalizeBreezeQuoteFromRow(row, stock_code);
};

/**
 * Fetch market depth for a given stock symbol
 */
export const fetchDepth = async (symbol: string): Promise<DepthResponse> => {
  const stock_code = await resolveStockCode(symbol);
  const response = await fetch(`${getProxyBaseUrl()}/api/breeze/depth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Proxy-Key': localStorage.getItem('breeze_proxy_key') || ''
    },
    body: JSON.stringify({
      stock_code,
      exchange_code: 'NSE',
      product_type: 'cash'
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to fetch depth' }));
    throw new Error(error.message || `Failed to fetch depth for ${symbol}`);
  }

  const data = await response.json();
  
  // Handle both direct response and nested Success object
  if (data.Success) {
    const depthData = Array.isArray(data.Success) ? data.Success[0] : data.Success;
    return {
      best_bid_price: parseFloat(depthData.best_bid_price || 0),
      best_bid_quantity: parseFloat(depthData.best_bid_quantity || 0),
      best_offer_price: parseFloat(depthData.best_offer_price || 0),
      best_offer_quantity: parseFloat(depthData.best_offer_quantity || 0)
    };
  }
  
  return data;
};

/**
 * Fetch historical data for a given stock symbol
 */
export const fetchHistorical = async (
  symbol: string,
  fromDate: string,
  toDate: string
): Promise<HistoricalBar[]> => {
  const stock_code = await resolveStockCode(symbol);
  const response = await fetch(`${getProxyBaseUrl()}/api/breeze/historical`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Proxy-Key': localStorage.getItem('breeze_proxy_key') || ''
    },
    body: JSON.stringify({
      stock_code,
      exchange_code: 'NSE',
      product_type: 'cash',
      from_date: fromDate,
      to_date: toDate,
      interval: '1day'
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to fetch historical data' }));
    throw new Error(error.message || `Failed to fetch historical data for ${symbol}`);
  }

  const data = await response.json();
  
  // Handle both direct response and nested Success object
  if (data.Success) {
    return data.Success;
  }
  
  return data;
};

/**
 * Summarize market outlook using Gemini AI
 */
export const summarizeMarketOutlook = async (log: MarketLog): Promise<NewsAttribution> => {
  const response = await fetch(`${getProxyBaseUrl()}/api/gemini/summarize_market_outlook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(log)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to analyze market' }));
    throw new Error(error.message || 'Failed to synthesize market intelligence');
  }

  const data = await response.json();
  
  if (data.error) {
    throw new Error(data.error);
  }
  
  return data;
};

/**
 * Perform deep dive analysis on a stock using Gemini AI
 */
export const analyzeStockDeepDive = async (symbol: string): Promise<NewsAttribution> => {
  const response = await fetch(`${getProxyBaseUrl()}/api/gemini/stock-deep-dive`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ symbol })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to analyze stock' }));
    throw new Error(error.message || `Failed to perform deep dive on ${symbol}`);
  }

  const data = await response.json();
  
  if (data.error) {
    throw new Error(data.error);
  }
  
  return data;
};

/**
 * Set the Breeze API session
 */
export const setBreezeSession = async (apiSession: string, adminKey: string) => {
  const response = await fetch(`${getProxyBaseUrl()}/api/breeze/admin/api-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Proxy-Admin-Key': adminKey
    },
    body: JSON.stringify({ api_session: apiSession })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to set session' }));
    throw new Error(error.message || 'Failed to activate Breeze session');
  }

  return await response.json();
};
