import { supabase } from '../lib/supabase';
import { fetchBreezeNiftyQuote, BreezeQuote } from './breezeService';
import { MarketLog } from '../types';

// --- Re-exporting for convenience ---





// --- STATE & THROTTLING ---
let lastApiCallTimestamp = 0;
let lastDbWriteTimestamp = 0;
let consecutiveApiFails = 0;

export interface MarketTelemetry extends BreezeQuote {
  dataSource: 'Breeze Direct' | 'Cache' | 'Offline';
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
    if (now - lastApiCallTimestamp < 2000) {
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
      if (consecutiveApiFails >= 5) {
        const lastKnown = await fetchLastKnownNiftyClose();
        return { ...lastKnown, dataSource: 'Cache', errorType: 'network' };
      }
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
        try {
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
        } catch (_) {
          // ignore if market_logs schema/RLS doesn't match
        }
        return niftyData;
      } catch (apiError) {
        console.error("One-time API call failed:", apiError);
        throw new Error("No market telemetry available from Breeze or cache.");
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