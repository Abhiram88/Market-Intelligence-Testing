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
  is_live: false, // Mock data is not live
};

export const PRIORITY_STOCKS = [
  { symbol: 'RELIANCE', ltp: 2980.50, change: 1.2 },
  { symbol: 'HDFCBANK', ltp: 1450.20, change: -0.5 },
  { symbol: 'INFY', ltp: 1620.00, change: 0.8 },
  { symbol: 'TCS', ltp: 4100.75, change: 0.3 },
  { symbol: 'ICICIBANK', ltp: 1080.40, change: 1.5 },
];

export const INITIAL_RESEARCH_TASKS: ResearchTask[] = [
  { id: '1', date: '2024-05-20', status: 'COMPLETED', result: 'High volatility detected due to election sentiment.' },
  { id: '2', date: '2024-05-21', status: 'PENDING' },
  { id: '3', date: '2024-05-22', status: 'PENDING' },
];
