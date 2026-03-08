import { supabase } from '../lib/supabase';
import { fetchBreezeNiftyQuote, BreezeQuote } from './breezeService';
import { MarketLog } from '../types';

// --- STATE & THROTTLING ---
let lastApiCallTimestamp = 0;
let lastDbWriteTimestamp = 0;
let consecutiveApiFails = 0;

const OPEN_MARKET_THROTTLE_MS = 2000; // 2s between live-market REST calls

export interface MarketTelemetry extends BreezeQuote {
  dataSource: 'Breeze Direct' | 'Cache';
  errorType?: 'token' | 'network' | 'none';
}

export const getMarketSessionStatus = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffset);
  
  const day = istDate.getUTCDay();
  const hours = istDate.getUTCHours();
  const minutes = istDate.getUTCMinutes();
  const time = hours * 100 + minutes;

  const isWeekday = day >= 1 && day <= 5;
  const isMarketHours = time >= 900 && time <= 1530;

  return {
    isOpen: isWeekday && isMarketHours,
    status: isWeekday && isMarketHours ? 'Live Trading Session' : 'Market Closed',
  };
};


// --- CORE LOGIC ---
export const fetchRealtimeMarketTelemetry = async (): Promise<MarketTelemetry> => {
  const { isOpen } = getMarketSessionStatus();

  // 2. Market Open Strategy
  if (isOpen) {
    const now = Date.now();
    if (now - lastApiCallTimestamp < OPEN_MARKET_THROTTLE_MS) {
      throw new Error('Polling too frequently');
    }
    lastApiCallTimestamp = now;

    try {
      const niftyData = await fetchBreezeNiftyQuote();
      consecutiveApiFails = 0;

      // Persistence (throttled); skip on schema/RLS mismatch so Nifty still works
      if (now - lastDbWriteTimestamp > 30000) {
        try {
          const marketLog: Omit<MarketLog, 'id' | 'log_date'> = {
            ltp: niftyData.last_traded_price,
            points_change: niftyData.change,
            change_percent: niftyData.percent_change,
            day_high: niftyData.high,
            day_low: niftyData.low,
            volume: niftyData.volume,
            source: 'Breeze Direct',
            is_live: true,
            date: new Date().toISOString().split('T')[0],
            niftyClose: niftyData.last_traded_price,
            niftyChange: niftyData.change,
            niftyChangePercent: niftyData.percent_change,
          };
          const { error } = await supabase.from('market_logs').upsert(marketLog, { onConflict: 'log_date' });
          if (!error) lastDbWriteTimestamp = now;
        } catch (_) {
          // ignore upsert failure (e.g. column name mismatch, RLS)
        }
      }

      return { ...niftyData, dataSource: 'Breeze Direct', errorType: 'none' };

    } catch (error: any) {
      consecutiveApiFails++;
      // When market is open, never return cache on load: keep throwing so UI shows "Loading" until socket or REST delivers live data
      const errorType = error.message.includes('session') ? 'token' : 'network';
      throw new Error(errorType);
    }
  }
  // Market Closed — no data is available or relevant outside trading hours.
  // Show nothing; the UI will render the "Market closed" empty state.
  else {
    throw new Error('market_closed');
  }
};