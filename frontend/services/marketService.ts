import { supabase } from '../lib/supabase';
import { fetchBreezeNiftyQuote, BreezeQuote } from './breezeService';
import { MarketLog } from '../types';

// --- Re-exporting for convenience ---





// --- STATE & THROTTLING ---
let lastApiCallTimestamp = 0;
let lastDbWriteTimestamp = 0;
let consecutiveApiFails = 0;

export interface MarketTelemetry extends BreezeQuote {
  dataSource: 'Breeze Direct' | 'Cache' | 'Simulation' | 'Offline';
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
  const isMarketHours = time >= 915 && time <= 1530;

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
    // Throttle API calls to 1 per second
    const now = Date.now();
    if (now - lastApiCallTimestamp < 1000) {
      // Return a placeholder or last known value to prevent UI flicker
      // This part depends on how the calling component manages state.
      // For now, we'll throw an error to signal the poll should be skipped.
      throw new Error('Polling too frequently');
    }
    lastApiCallTimestamp = now;

    try {
      const niftyData = await fetchBreezeNiftyQuote();
      consecutiveApiFails = 0;

      // Persistence (throttled)
      if (now - lastDbWriteTimestamp > 30000) {
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
        await supabase.from('market_logs').upsert(marketLog, { onConflict: 'log_date' });
        lastDbWriteTimestamp = now;
      }

      return { ...niftyData, dataSource: 'Breeze Direct', errorType: 'none' };

    } catch (error: any) {
      consecutiveApiFails++;
      if (consecutiveApiFails >= 3) {
        // Fallback to DB
        const lastKnown = await fetchLastKnownNiftyClose();
        return { ...lastKnown, dataSource: 'Cache', errorType: 'network' };
      }
      // Distinguish between token/auth errors and general network issues
      const errorType = error.message.includes('session') ? 'token' : 'network';
      throw new Error(errorType);
    }
  }
  // 3. Market Closed Strategy
  else {
    return { ...(await fetchLastKnownNiftyClose()), dataSource: 'Cache', errorType: 'none' };
  }
};


export const fetchLastKnownNiftyClose = async (): Promise<BreezeQuote> => {
    const { data, error } = await supabase
      .from('market_logs')
      .select('*')
      .order('log_date', { ascending: false })
      .limit(1)
      .single();
  
    if (error || !data) {
      console.warn("No cached market data found, doing one-time API call.");
      try {
        const niftyData = await fetchBreezeNiftyQuote();
        // Also persist this one-time fetch
        const marketLog: Omit<MarketLog, 'id'> = {
            log_date: new Date().toISOString().split('T')[0],
            ltp: niftyData.last_traded_price,
            points_change: niftyData.change,
            change_percent: niftyData.percent_change,
            day_high: niftyData.high,
            day_low: niftyData.low,
            volume: niftyData.volume,
            source: 'Breeze Direct',
            is_live: false,
            date: new Date().toISOString().split('T')[0],
            niftyClose: niftyData.last_traded_price,
            niftyChange: niftyData.change,
            niftyChangePercent: niftyData.percent_change,
          };
        await supabase.from('market_logs').upsert(marketLog, { onConflict: 'log_date' });
        return niftyData;
      } catch (apiError) {
        console.error("One-time API call failed:", apiError);
        return { // Return a zeroed-out object on complete failure
            last_traded_price: 0, change: 0, percent_change: 0, open: 0, high: 0,
            low: 0, previous_close: 0, volume: 0
        };
      }
    }
  
    return {
      last_traded_price: data.ltp,
      change: data.points_change,
      percent_change: data.change_percent,
      open: 0, // Market closed, open is not relevant
      high: data.day_high,
      low: data.day_low,
      previous_close: data.ltp - data.points_change,
      volume: data.volume,
    };
  };