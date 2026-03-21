/**
 * API Service - Connects Frontend to Backend APIs
 * Provides functions for market data, quotes, and AI analysis
 .
 */

import { MarketLog, NewsAttribution } from '../types';

// Backend API URL - defaults to localhost for local development
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

interface QuoteResponse {
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

interface DepthResponse {
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

/**
 * Fetch a quote for a given stock symbol
 */
export const fetchQuote = async (symbol: string): Promise<QuoteResponse> => {
  const response = await fetch(`${API_BASE_URL}/api/market/quote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Proxy-Key': localStorage.getItem('breeze_proxy_key') || ''
    },
    body: JSON.stringify({ symbol })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to fetch quote' }));
    throw new Error(error.message || `Failed to fetch quote for ${symbol}`);
  }

  const data = await response.json();
  
  // Handle both direct response and nested Success object
  if (data.Success) {
    return data.Success;
  }
  
  return data;
};

/**
 * Fetch market depth for a given stock symbol
 */
export const fetchDepth = async (symbol: string): Promise<DepthResponse> => {
  const response = await fetch(`${API_BASE_URL}/api/market/depth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Proxy-Key': localStorage.getItem('breeze_proxy_key') || ''
    },
    body: JSON.stringify({ symbol })
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
  const response = await fetch(`${API_BASE_URL}/api/market/historical`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Proxy-Key': localStorage.getItem('breeze_proxy_key') || ''
    },
    body: JSON.stringify({
      symbol,
      from_date: fromDate,
      to_date: toDate
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
 * Analyze market radar using Gemini AI
 */
export const analyzeMarketRadar = async (log: MarketLog): Promise<NewsAttribution> => {
  const response = await fetch(`${API_BASE_URL}/api/gemini/analyze_market_log`, {
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
  const response = await fetch(`${API_BASE_URL}/api/gemini/stock-deep-dive`, {
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
  const response = await fetch(`${API_BASE_URL}/api/breeze/admin/api-session`, {
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
