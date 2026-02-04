import { MarketLog, ResearchTask } from './types';

export const MOCK_MARKET_LOG: MarketLog = {
  id: 'log-001',
  log_date: new Date().toISOString().split('T')[0],
  ltp: 22450.30,
  points_change: 125.45,
  change_percent: 0.56,
  day_high: 22500.10,
  day_low: 22350.00,
  volume: 12500000,
  source: 'ICICI Breeze',
  is_live: true,
  niftyClose: 22450.30,
  niftyChange: 125.45,
  niftyChangePercent: 0.56,
  date: new Date().toISOString().split('T')[0],
};

export const PRIORITY_STOCKS = [
  { symbol: 'RELIANCE', ltp: 2980.50, change: 1.2 },
  { symbol: 'HDFCBANK', ltp: 1450.20, change: -0.5 },
  { symbol: 'INFY', ltp: 1620.00, change: 0.8 },
  { symbol: 'TCS', ltp: 4100.75, change: 0.3 },
  { symbol: 'ICICIBANK', ltp: 1080.40, change: 1.5 },
];

export const INITIAL_RESEARCH_TASKS: ResearchTask[] = [
  { id: '1', symbol: 'NIFTY', date: '2024-05-20', status: 'completed', result: 'High volatility detected due to election sentiment.', prompt: 'Analyze NIFTY volatility on 2024-05-20' },
  { id: '2', symbol: 'NIFTY', date: '2024-05-21', status: 'pending', result: null, prompt: 'Analyze NIFTY volatility on 2024-05-21' },
  { id: '3', symbol: 'NIFTY', date: '2024-_5-22', status: 'pending', result: null, prompt: 'Analyze NIFTY volatility on 2024-05-22' },
];
