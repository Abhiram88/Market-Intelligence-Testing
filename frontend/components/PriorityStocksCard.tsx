import React, { useEffect, useState, useRef, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';
import { supabase } from '../lib/supabase';
import { fetchHistorical } from '../services/apiService';
import { getMarketSessionStatus } from '../services/marketService';
import { getProxyBaseUrl, normalizeBreezeQuoteFromRow } from '../services/breezeService';
import { LiquidityMetrics } from '../types';
import { X, ArrowUp, ArrowDown, Bookmark, AlertCircle } from 'lucide-react';

interface PriorityStock {
  symbol: string;
  company_name: string;
}

interface QuoteData {
  last_traded_price: number;
  change: number;
  percent_change: number;
  open: number;
  high: number;
  low: number;
  previous_close: number;
  volume: number;
  ltp?: number;
  ltp_percent_change?: number;
  total_quantity_traded?: number;
  best_bid_price?: number;
  best_bid_quantity?: number;
  best_offer_price?: number;
  best_offer_quantity?: number;
}

interface PriorityStocksCardProps {
  /** Called with the raw tick payload whenever a NIFTY tick arrives on the shared socket. */
  onNiftyTick?: (data: Record<string, unknown>) => void;
}

export const PriorityStocksCard: React.FC<PriorityStocksCardProps> = ({ onNiftyTick }) => {
  const STALE_THRESHOLD_MS = 60_000;
  const FEED_HEALTHY_THRESHOLD_MS = 15_000;

  const [priorityStocks, setPriorityStocks] = useState<PriorityStock[]>([]);
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [historicalCache, setHistoricalCache] = useState<Record<string, number>>({});
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [showRawFeed, setShowRawFeed] = useState(false);
  const [tickCount, setTickCount] = useState(0);
  const [lastTickMs, setLastTickMs] = useState<number | null>(null);
  const lastTickMsRef = useRef<number | null>(null);
  const stalenessTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep a stable ref to onNiftyTick so the socket closure doesn't go stale.
  const onNiftyTickRef = useRef(onNiftyTick);
  useEffect(() => { onNiftyTickRef.current = onNiftyTick; }, [onNiftyTick]);

  const fetchTrackedSymbols = async () => {
    try {
      const { data, error } = await supabase.from('priority_stocks').select('*');
      if (error) {
        console.warn('Priority stocks fetch error:', error.message);
        return [];
      }
      if (!data || !Array.isArray(data)) return [];
      const mapped: PriorityStock[] = data.map((row: Record<string, unknown>) => ({
        symbol: String(row.symbol ?? ''),
        company_name: String(row.company_name ?? ''),
      }));
      setPriorityStocks(mapped);
      return data;
    } catch (e) {
      console.error('Watchlist fetch failed:', e);
    }
    return [];
  };

  const refreshHistoricalData = async (symbol: string) => {
    try {
      const today = new Date();
      const fortyDaysAgo = new Date();
      fortyDaysAgo.setDate(today.getDate() - 40);
      const bars = await fetchHistorical(
        symbol,
        fortyDaysAgo.toISOString().split('T')[0],
        today.toISOString().split('T')[0]
      );
      if (bars.length > 0) {
        const last20 = bars.slice(-20);
        const avgVol = last20.reduce((acc: number, bar: any) => acc + parseFloat(bar.volume), 0) / last20.length;
        setHistoricalCache(prev => ({ ...prev, [symbol]: avgVol }));
      }
    } catch (e) {
      console.warn(`Historical sync failed for ${symbol}`);
    }
  };

  // Fetch watchlist on mount; kick off historical baseline fetches (not time-sensitive).
  useEffect(() => {
    const init = async () => {
      const stocks = await fetchTrackedSymbols();
      if (stocks.length > 0) {
        stocks.forEach((s: any) => refreshHistoricalData(String(s.symbol)));
      }
    };
    init();
  }, []);

  // Stable string key representing the current watchlist. Changes only when stocks are added/removed.
  const watchlistKey = useMemo(
    () => priorityStocks.map(s => s.symbol).join(','),
    [priorityStocks]
  );

  // ── Single shared Socket.IO connection for NIFTY + all watchlist stocks ──────
  // This avoids the Breeze on_ticks overwrite bug where a second socket subscription
  // would replace the first subscriber's callback.
  const socketRef = useRef<Socket | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Always subscribe to NIFTY; also subscribe to all watchlist stocks.
    const symbolsToSubscribe = ['NIFTY', ...priorityStocks.map(s => s.symbol)];

    const connect = () => {
      // Google Cloud Run requires HTTP long-polling to establish the session first.
      // Starting with 'websocket' causes "WebSocket is closed before the connection is
      // established" because Cloud Run terminates WebSocket upgrades before they complete.
      // Starting with 'polling' lets Socket.IO handshake succeed, then upgrade to WebSocket.
      const socket = io(getProxyBaseUrl(), {
        transports: ['polling', 'websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 10000,
        timeout: 20000,
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        console.log('[PriorityStocksCard] Socket connected, subscribing:', symbolsToSubscribe);
        socket.emit('subscribe_to_watchlist', {
          stocks: symbolsToSubscribe,
          proxy_key: localStorage.getItem('breeze_proxy_key') || '',
        });
      });

      socket.on('watchlist_update', (data: Record<string, unknown>) => {
        const symbol = String(data.symbol || '').toUpperCase();
        if (!symbol) return;

        if (symbol === 'NIFTY' || symbol === 'NIFTY 50') {
          // Route to the Nifty card via the callback from MonitorTab.
          onNiftyTickRef.current?.(data);
          return;
        }

        const normalized = normalizeBreezeQuoteFromRow(data, symbol);
        const now = Date.now();
        setTickCount(n => n + 1);
        setLastTickMs(now);
        lastTickMsRef.current = now;
        setQuotes(prev => {
          const existing = prev[symbol];
          return {
            ...prev,
            [symbol]: {
              ...normalized,
      // Preserve non-zero H/L from previous ticks — Breeze sends them only when they change.
              high: normalized.high !== 0 ? normalized.high : (existing?.high ?? 0),
              low:  normalized.low  !== 0 ? normalized.low  : (existing?.low  ?? 0),
              previous_close: normalized.previous_close !== 0
                ? normalized.previous_close
                : (existing?.previous_close ?? 0),
      // Preserve bid/ask/volume: depth ticks may not carry trade data, exchange-quote ticks
      // may not carry depth data. Keep previous good values when the new tick delivers 0.
              best_bid_price: normalized.best_bid_price
                ? normalized.best_bid_price : (existing?.best_bid_price ?? 0),
              best_bid_quantity: normalized.best_bid_quantity
                ? normalized.best_bid_quantity : (existing?.best_bid_quantity ?? 0),
              best_offer_price: normalized.best_offer_price
                ? normalized.best_offer_price : (existing?.best_offer_price ?? 0),
              best_offer_quantity: normalized.best_offer_quantity
                ? normalized.best_offer_quantity : (existing?.best_offer_quantity ?? 0),
              volume: normalized.volume !== 0
                ? normalized.volume : (existing?.volume ?? 0),
              total_quantity_traded: normalized.volume !== 0
                ? normalized.volume : (existing?.total_quantity_traded ?? existing?.volume ?? 0),
              last_traded_price: normalized.last_traded_price !== 0
                ? normalized.last_traded_price : (existing?.last_traded_price ?? 0),
              ltp: normalized.last_traded_price !== 0
                ? normalized.last_traded_price : (existing?.ltp ?? existing?.last_traded_price ?? 0),
            },
          };
        });
        setErrors(prev => {
          const next = { ...prev };
          delete next[symbol];
          return next;
        });
      });

      // If the proxy can't start the feed (no Breeze session yet), retry after 30s
      // so that the subscription auto-resumes once the session is activated.
      socket.on('watchlist_error', (err: Record<string, unknown>) => {
        console.warn('[PriorityStocksCard] watchlist_error:', err?.error);
        if (getMarketSessionStatus().isOpen && socket.connected) {
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = setTimeout(() => {
            if (socket.connected) {
              console.log('[PriorityStocksCard] Retrying subscription after watchlist_error...');
              socket.emit('subscribe_to_watchlist', {
                stocks: symbolsToSubscribe,
                proxy_key: localStorage.getItem('breeze_proxy_key') || '',
              });
            }
          }, 30000);
        }
      });

      socket.on('connect_error', (err: Error) => console.warn('[PriorityStocksCard] Socket connect error:', err.message));
      socket.on('disconnect', () => console.log('[PriorityStocksCard] Socket disconnected'));
    };

    connect();

    stalenessTimerRef.current = setInterval(() => {
      const socket = socketRef.current;
      if (!socket?.connected) return;
      if (!getMarketSessionStatus().isOpen) return;
      const last = lastTickMsRef.current;
      if (last !== null && Date.now() - last < STALE_THRESHOLD_MS) return;
      console.warn('[PriorityStocksCard] Stale feed detected — re-subscribing…');
      socket.emit('subscribe_to_watchlist', {
        stocks: symbolsToSubscribe,
        proxy_key: localStorage.getItem('breeze_proxy_key') || '',
      });
    }, 30_000);

    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (stalenessTimerRef.current) clearInterval(stalenessTimerRef.current);
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  // Re-connect (and re-subscribe with new list) whenever the watchlist stock list changes.
  // When a stock is removed, this cleanup disconnects the old socket, which triggers the proxy
  // to unsubscribe its Breeze feeds and disconnect the Breeze WebSocket.
  }, [watchlistKey]);  // Re-connect when the watchlist symbol list changes

  const validateMarketData = (q: QuoteData | undefined): { isValid: boolean; reason?: string } => {
    if (!q) return { isValid: false, reason: 'No quote data' };
    const bid = q.best_bid_price || 0;
    const ask = q.best_offer_price || 0;
    if (bid <= 0 || ask <= 0) return { isValid: false, reason: 'Invalid bid/ask prices' };
    if (ask < bid) return { isValid: false, reason: 'Ask < Bid (invalid)' };
    // Spread > 10% of bid price indicates stale/market-closed data
    if (((ask - bid) / bid) * 100 > 10) return { isValid: false, reason: 'Abnormal spread (>10%)' };
    return { isValid: true };
  };

  const calculateMetrics = (symbol: string): LiquidityMetrics | null => {
    const q = quotes[symbol];
    const avgVol = historicalCache[symbol];

    const validation = validateMarketData(q);

    if (!validation.isValid) {
      // Use 'MARKET CLOSED' only when the session is actually closed.
      // When the market IS open but bid/ask are missing (common for illiquid stocks),
      // use 'LIMIT ONLY' so we don't falsely report the market as closed.
      const sessionOpen = getMarketSessionStatus().isOpen;
      const hasLtp = q && (q.last_traded_price > 0 || (q.ltp ?? 0) > 0);
      const execStyle = (!sessionOpen || !hasLtp) ? 'MARKET CLOSED' : 'LIMIT ONLY';
      return {
        spread_pct: null,
        depth_ratio: null,
        vol_ratio: null,
        regime: 'NEUTRAL',
        execution_style: execStyle,
        bid: 0, ask: 0, bidQty: 0, askQty: 0,
        avg_vol_20d: avgVol || null,
        liquidity_quality_score: 0,
        liquidity_grade: execStyle === 'MARKET CLOSED' ? 'F' : 'D',
        is_tradeable: false,
        risk_level: 'EXTREME',
        spread_status: 'AVOID',
        volume_status: 'LOW',
        depth_status: 'BALANCED',
        time_regime: 'AFTER_HOURS',
        execution_hint: validation.reason || 'No data available',
      };
    }

    const bid = q.best_bid_price || 0;
    const ask = q.best_offer_price || 0;
    const bidQty = q.best_bid_quantity || 0;
    const askQty = q.best_offer_quantity || 0;
    const mid = (bid + ask) / 2;

    const vol_today = q.total_quantity_traded || q.volume || 0;
    const vol_ratio = avgVol && avgVol > 0 ? vol_today / avgVol : null;

    const close = q.last_traded_price || q.ltp || 0;
    const high = q.high || 0;
    const low = q.low || 0;
    const open = q.open || 0;
    const range = Math.max(high - low, 0.01);

    const spread_pct = ((ask - bid) / mid) * 100;
    const depth_ratio = (bidQty + 1) / (askQty + 1);

    // Spread status
    let spread_status: LiquidityMetrics['spread_status'];
    if (spread_pct < 0.05) spread_status = 'EXCELLENT';
    else if (spread_pct < 0.15) spread_status = 'GOOD';
    else if (spread_pct < 0.30) spread_status = 'ACCEPTABLE';
    else if (spread_pct < 0.50) spread_status = 'POOR';
    else spread_status = 'AVOID';

    // Volume status
    let volume_status: LiquidityMetrics['volume_status'];
    if (!vol_ratio) volume_status = 'NORMAL';
    else if (vol_ratio < 0.5) volume_status = 'LOW';
    else if (vol_ratio < 1.2) volume_status = 'NORMAL';
    else if (vol_ratio < 2.0) volume_status = 'ELEVATED';
    else if (vol_ratio < 4.0) volume_status = 'HIGH';
    else volume_status = 'EXTREME';

    // Depth status
    let depth_status: LiquidityMetrics['depth_status'];
    if (depth_ratio < 0.5) depth_status = 'HEAVY SELLING';
    else if (depth_ratio < 0.8) depth_status = 'SELLING BIAS';
    else if (depth_ratio <= 1.2) depth_status = 'BALANCED';
    else if (depth_ratio <= 2.5) depth_status = 'BUYING BIAS';
    else depth_status = 'HEAVY BUYING';

    // Time-of-day regime (NSE hours: 09:15–15:30 IST).
    // Always derive IST from UTC to be independent of the browser's local timezone.
    const now = new Date();
    const istOffset = 5.5 * 60; // IST = UTC + 5h30m, in minutes
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const istMinutes = (utcMinutes + istOffset) % (24 * 60);
    let time_regime: LiquidityMetrics['time_regime'];
    if (istMinutes >= 9 * 60 + 15 && istMinutes < 10 * 60) time_regime = 'OPENING';
    else if (istMinutes >= 15 * 60 && istMinutes < 15 * 60 + 30) time_regime = 'CLOSING';
    else if (istMinutes >= 10 * 60 && istMinutes < 15 * 60) time_regime = 'NORMAL';
    else time_regime = 'AFTER_HOURS';

    // Price regime
    const wick_ratio = (high - Math.max(open, close)) / range;
    const close_pos = (close - low) / range;
    let regime: LiquidityMetrics['regime'] = 'NEUTRAL';
    if (wick_ratio > 0.55 && close_pos < 0.35 && vol_ratio && vol_ratio > 2.5) regime = 'DISTRIBUTION';
    else if (close_pos > 0.70 && vol_ratio && vol_ratio > 2.0) regime = 'BREAKOUT';

    // Liquidity quality score (0-100)
    let score = 50;
    if (spread_status === 'EXCELLENT') score += 35;
    else if (spread_status === 'GOOD') score += 25;
    else if (spread_status === 'ACCEPTABLE') score += 10;
    else if (spread_status === 'POOR') score -= 10;
    else score -= 30;

    if (volume_status === 'HIGH') score += 30;
    else if (volume_status === 'ELEVATED') score += 20;
    else if (volume_status === 'NORMAL') score += 10;
    else if (volume_status === 'LOW') score -= 15;
    // EXTREME volume is context-dependent (could be strong momentum or a circuit-breaker spike),
    // so no automatic score adjustment is applied — other signals (regime/spread) will determine quality.

    if (depth_status === 'BALANCED') score += 20;
    else if (depth_status === 'BUYING BIAS') score += 15;
    else if (depth_status === 'SELLING BIAS') score -= 10;
    else if (depth_status === 'HEAVY SELLING') score -= 20;
    else score += 5; // HEAVY BUYING

    if (regime === 'BREAKOUT') score += 15;
    else if (regime === 'DISTRIBUTION') score -= 15;

    if (time_regime === 'OPENING' || time_regime === 'CLOSING') score -= 10;

    const liquidity_quality_score = Math.max(0, Math.min(100, score));

    let liquidity_grade: LiquidityMetrics['liquidity_grade'];
    let is_tradeable: boolean;
    if (liquidity_quality_score >= 85) { liquidity_grade = 'A'; is_tradeable = true; }
    else if (liquidity_quality_score >= 70) { liquidity_grade = 'B'; is_tradeable = true; }
    else if (liquidity_quality_score >= 55) { liquidity_grade = 'C'; is_tradeable = true; }
    else if (liquidity_quality_score >= 40) { liquidity_grade = 'D'; is_tradeable = false; }
    else { liquidity_grade = 'F'; is_tradeable = false; }

    // Execution style (5 states)
    let execution_style: LiquidityMetrics['execution_style'];
    let execution_hint: string;

    if (spread_pct > 0.50) {
      execution_style = 'AVOID';
      execution_hint = `Spread too wide (${spread_pct.toFixed(2)}%) — illiquid`;
    } else if (time_regime === 'OPENING' || time_regime === 'CLOSING') {
      execution_style = 'CAUTION';
      execution_hint = `${time_regime === 'OPENING' ? 'Opening' : 'Closing'} volatility — spreads widening`;
    } else if (regime === 'DISTRIBUTION' && depth_ratio < 0.6) {
      execution_style = 'AVOID';
      execution_hint = 'Distribution + heavy selling pressure';
    } else if (
      spread_pct < 0.10 &&
      (vol_ratio === null || vol_ratio >= 1.2) &&
      depth_ratio > 0.7 && depth_ratio < 2.5 &&
      time_regime === 'NORMAL'
    ) {
      execution_style = 'OK FOR MARKET';
      execution_hint = `Excellent liquidity — market orders OK at ₹${mid.toFixed(2)}`;
    } else if (
      spread_pct < 0.15 &&
      (vol_ratio === null || vol_ratio >= 1.0) &&
      depth_ratio > 0.6 && depth_ratio < 3.0
    ) {
      execution_style = 'OK FOR MARKET';
      execution_hint = 'Good liquidity — market orders acceptable';
    } else if (spread_pct < 0.30) {
      execution_style = 'LIMIT ONLY';
      execution_hint = `Use limit orders near ₹${(bid + (ask - bid) * 0.4).toFixed(2)} to save spread`;
    } else {
      execution_style = 'LIMIT ONLY';
      execution_hint = 'Moderate spread — limit orders recommended';
    }

    // Risk level
    let risk_level: LiquidityMetrics['risk_level'];
    if (execution_style === 'AVOID') risk_level = 'EXTREME';
    else if (execution_style === 'CAUTION' || spread_pct > 0.30) risk_level = 'HIGH';
    else if (spread_pct > 0.15 || vol_ratio === null || vol_ratio < 1.0) risk_level = 'MEDIUM';
    else risk_level = 'LOW';

    return {
      spread_pct, depth_ratio, vol_ratio, regime, execution_style,
      bid, ask, bidQty, askQty,
      avg_vol_20d: avgVol || null,
      liquidity_quality_score, liquidity_grade, is_tradeable, risk_level,
      spread_status, volume_status, depth_status, time_regime, execution_hint,
    };
  };

  const getRecommendationHint = (metrics: LiquidityMetrics | null) => {
    if (!metrics) return 'Calculating...';
    if (metrics.execution_style === 'MARKET CLOSED') return 'Market closed — no live data';
    if (metrics.execution_style === 'AVOID') return metrics.execution_hint || 'Avoid — poor liquidity';
    if (metrics.execution_style === 'CAUTION') return metrics.execution_hint || 'Caution — volatile period';
    if (metrics.execution_style === 'OK FOR MARKET') {
      return metrics.liquidity_grade === 'A' ? 'Excellent setup' : 'Good liquidity';
    }
    // LIMIT ONLY
    if (metrics.regime === 'BREAKOUT' && metrics.volume_status === 'HIGH') return 'Momentum building';
    if (metrics.volume_status === 'LOW') return 'Low volume — wait';
    return metrics.execution_hint || 'Use limits to save spread';
  };

  const removeStock = async (symbol: string) => {
    const { error } = await supabase.from('priority_stocks').delete().eq('symbol', symbol);
    if (!error) {
      // Removing from state triggers the socket effect to reconnect with the new (smaller) list,
      // which causes the proxy to unsubscribe the removed symbol's Breeze feed automatically.
      setPriorityStocks(prev => prev.filter(s => s.symbol !== symbol));
      setQuotes(prev => { const n = { ...prev }; delete n[symbol]; return n; });
      setErrors(prev => { const n = { ...prev }; delete n[symbol]; return n; });
    }
  };

  const marketStatus = getMarketSessionStatus();

  return (
    <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-xl h-full flex flex-col group">
      <div className="flex justify-between items-start mb-4 relative z-10">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-emerald-100 bg-emerald-50">
            <div className={`w-1 h-1 rounded-full ${marketStatus.isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
            <span className={`text-[8px] font-black uppercase tracking-[0.2em] ${marketStatus.isOpen ? 'text-emerald-600' : 'text-slate-400'}`}>
              {marketStatus.isOpen ? 'LIQUIDITY TICKER' : 'MARKET CLOSED'}
            </span>
          </div>
          <h2 className="text-lg font-black text-slate-900 uppercase tracking-tighter mt-1">Watchlist</h2>
        </div>
        <div className="flex flex-col items-end">
          <button
            onClick={() => setShowRawFeed(!showRawFeed)}
            className={`text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border transition-all ${showRawFeed ? 'bg-indigo-600 text-white border-indigo-600' : 'text-slate-400 border-slate-100 hover:bg-slate-50'}`}
          >
            Raw Feed
          </button>
          {marketStatus.isOpen ? (
            <div className="flex items-center gap-1">
              {lastTickMs && (Date.now() - lastTickMs) < FEED_HEALTHY_THRESHOLD_MS ? (
                <>
                  <span className="flex h-1.5 w-1.5 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-emerald-400"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                  </span>
                  <p className="text-[8px] font-black text-emerald-600 uppercase tracking-tight">Live · {tickCount} ticks</p>
                </>
              ) : (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block"></span>
                  <p className="text-[8px] font-black text-amber-600 uppercase tracking-tight">
                    {lastTickMs ? 'Awaiting ticks…' : 'Connecting…'}
                  </p>
                </>
              )}
            </div>
          ) : (
            <p className="text-[8px] font-black text-slate-400 uppercase tracking-tight">Polling suspended</p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-1 space-y-2 max-h-[350px] relative z-10">
        {priorityStocks.length === 0 ? (
          <div className="py-12 text-center space-y-2 opacity-40 flex flex-col items-center">
            <Bookmark className="w-8 h-8 mb-2" />
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Empty Ledger</p>
          </div>
        ) : (
          priorityStocks.map((stock) => {
            const quote = quotes[stock.symbol];
            const metrics = calculateMetrics(stock.symbol);
            const error = errors[stock.symbol];
            const displayPrice = quote?.last_traded_price ?? quote?.ltp ?? null;
            const displayPct = quote?.percent_change ?? quote?.ltp_percent_change ?? null;
            const isPositive = (quote?.change ?? 0) >= 0;
            const isExpanded = expandedSymbol === stock.symbol;

            return (
              <div key={stock.symbol} className="group relative rounded-xl border border-slate-100 bg-slate-50 hover:bg-white hover:border-indigo-100 hover:shadow-md transition-all duration-300 overflow-hidden">
                <div
                  className="flex items-center justify-between p-3.5 cursor-pointer"
                  onClick={() => setExpandedSymbol(isExpanded ? null : stock.symbol)}
                >
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-black text-slate-900">{stock.symbol}</span>
                      {error && <AlertCircle className="w-3 h-3 text-red-500" />}
                    </div>
                    <span className="text-[7px] font-bold text-slate-400 uppercase truncate max-w-[100px]">{stock.company_name}</span>
                  </div>

                  <div className="flex items-center gap-4">
                    {displayPrice !== null ? (
                      <div className="text-right">
                        <p className="text-xs font-black text-slate-900 tabular-nums">
                          {displayPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </p>
                        <div className={`flex items-center justify-end gap-1 text-[8px] font-black ${isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {isPositive ? <ArrowUp className="w-2 h-2" /> : <ArrowDown className="w-2 h-2" />}
                          <span className="tabular-nums">{Math.abs(displayPct || 0).toFixed(2)}%</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-right">
                        <p className="text-xs font-black text-slate-300 tabular-nums">--</p>
                        <p className="text-[8px] font-black text-slate-200 uppercase">{error ? 'Error' : 'Awaiting...'}</p>
                      </div>
                    )}

                    <button
                      onClick={(e) => { e.stopPropagation(); removeStock(stock.symbol); }}
                      className="p-1.5 text-slate-300 hover:text-rose-500 transition-all rounded hover:bg-rose-50"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="p-5 bg-white border-t border-slate-50 space-y-6 animate-in slide-in-from-top-2 duration-300">
                    {showRawFeed ? (
                      <pre className="text-[8px] font-mono bg-slate-50 p-3 rounded-xl overflow-x-auto text-slate-500 max-h-40 overflow-y-auto">
                        {JSON.stringify({ quote, metrics, error }, null, 2)}
                      </pre>
                    ) : (
                      <>
                        {error ? (
                          <div className="p-4 bg-red-50 rounded-xl border border-red-100 flex items-center gap-3 text-red-600">
                            <AlertCircle className="w-4 h-4" />
                            <span className="text-[10px] font-bold uppercase tracking-widest">{error}</span>
                          </div>
                        ) : (
                          <div className="space-y-5">
                            {/* Liquidity Quality Score Card */}
                            <div className="p-4 bg-gradient-to-br from-slate-50 to-white rounded-xl border border-slate-100">
                              <div className="flex items-center justify-between mb-3">
                                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Liquidity Quality</p>
                                <div className="flex items-center gap-2">
                                  <span className={`text-2xl font-black tabular-nums ${
                                    metrics?.liquidity_grade === 'A' ? 'text-emerald-600' :
                                    metrics?.liquidity_grade === 'B' ? 'text-green-600' :
                                    metrics?.liquidity_grade === 'C' ? 'text-amber-600' :
                                    metrics?.liquidity_grade === 'D' ? 'text-orange-600' :
                                    'text-rose-600'
                                  }`}>
                                    {metrics?.liquidity_grade || '—'}
                                  </span>
                                  <span className="text-[10px] font-bold text-slate-400">
                                    {metrics?.liquidity_quality_score ?? 0}/100
                                  </span>
                                </div>
                              </div>

                              {/* Progress bar */}
                              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-full transition-all duration-500 ${
                                    (metrics?.liquidity_quality_score ?? 0) >= 85 ? 'bg-emerald-500' :
                                    (metrics?.liquidity_quality_score ?? 0) >= 70 ? 'bg-green-500' :
                                    (metrics?.liquidity_quality_score ?? 0) >= 55 ? 'bg-amber-500' :
                                    (metrics?.liquidity_quality_score ?? 0) >= 40 ? 'bg-orange-500' :
                                    'bg-rose-500'
                                  }`}
                                  style={{ width: `${metrics?.liquidity_quality_score ?? 0}%` }}
                                />
                              </div>

                              <div className="flex items-center justify-between mt-2">
                                <span className={`px-2 py-1 rounded text-[8px] font-black uppercase tracking-widest border ${
                                  metrics?.is_tradeable
                                    ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                                    : 'bg-rose-50 text-rose-600 border-rose-100'
                                }`}>
                                  {metrics?.is_tradeable ? 'TRADEABLE' : 'AVOID'}
                                </span>

                                <span className={`px-2 py-1 rounded text-[8px] font-black uppercase tracking-widest border ${
                                  metrics?.risk_level === 'LOW' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                                  metrics?.risk_level === 'MEDIUM' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                                  metrics?.risk_level === 'HIGH' ? 'bg-orange-50 text-orange-600 border-orange-100' :
                                  'bg-rose-50 text-rose-600 border-rose-100'
                                }`}>
                                  RISK: {metrics?.risk_level || '—'}
                                </span>
                              </div>
                            </div>

                            {/* Bid/Ask/Spread Grid - Enhanced */}
                            <div className="grid grid-cols-3 gap-4">
                              <div className="flex flex-col gap-1.5">
                                <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Best Bid</p>
                                <p className="text-[10px] font-black text-slate-900 tabular-nums">
                                  ₹{metrics?.bid?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || '—'}
                                </p>
                                <p className="text-[8px] font-bold text-slate-400">{(metrics?.bidQty ?? 0).toLocaleString()} shares</p>
                              </div>

                              <div className="flex flex-col gap-1.5">
                                <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Best Ask</p>
                                <p className="text-[10px] font-black text-slate-900 tabular-nums">
                                  ₹{metrics?.ask?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || '—'}
                                </p>
                                <p className="text-[8px] font-bold text-slate-400">{(metrics?.askQty ?? 0).toLocaleString()} shares</p>
                              </div>

                              <div className="flex flex-col gap-1.5 text-right">
                                <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Spread</p>
                                <div className="space-y-1">
                                  <span className={`px-2 py-1 rounded text-[10px] font-black tabular-nums border inline-block ${
                                    metrics?.spread_status === 'EXCELLENT' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                                    metrics?.spread_status === 'GOOD' ? 'bg-green-50 text-green-600 border-green-100' :
                                    metrics?.spread_status === 'ACCEPTABLE' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                                    metrics?.spread_status === 'POOR' ? 'bg-orange-50 text-orange-600 border-orange-100' :
                                    'bg-rose-50 text-rose-600 border-rose-100'
                                  }`}>
                                    {metrics?.spread_pct !== null && metrics?.spread_pct !== undefined ? metrics.spread_pct.toFixed(3) + '%' : '—'}
                                  </span>
                                  <p className="text-[7px] font-bold text-slate-400 uppercase tracking-widest">{metrics?.spread_status || '—'}</p>
                                </div>
                              </div>
                            </div>

                            {/* Volume/Depth/Regime Grid - Enhanced */}
                            <div className="grid grid-cols-4 gap-4 pt-4 border-t border-slate-50">
                              <div className="flex flex-col gap-1.5">
                                <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Vol Today</p>
                                <p className="text-[9px] font-black text-slate-900">
                                  {(quote?.total_quantity_traded ?? quote?.volume ?? 0) > 0
                                    ? ((quote?.total_quantity_traded ?? quote?.volume ?? 0) / 1000000).toFixed(2) + 'M'
                                    : '—'}
                                </p>
                              </div>

                              <div className="flex flex-col gap-1.5 text-center">
                                <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Vol Ratio</p>
                                <div className="space-y-0.5">
                                  <p className={`text-[9px] font-black ${
                                    metrics?.volume_status === 'HIGH' || metrics?.volume_status === 'ELEVATED' ? 'text-emerald-600' :
                                    metrics?.volume_status === 'LOW' ? 'text-rose-500' :
                                    metrics?.volume_status === 'EXTREME' ? 'text-orange-600' :
                                    'text-slate-900'
                                  }`}>
                                    {metrics?.vol_ratio ? metrics.vol_ratio.toFixed(2) + 'x' : '—'}
                                  </p>
                                  <p className="text-[7px] font-bold text-slate-400 uppercase">{metrics?.volume_status || '—'}</p>
                                </div>
                              </div>

                              <div className="flex flex-col gap-1.5 text-center">
                                <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Depth</p>
                                <div className="space-y-0.5">
                                  <p className={`text-[9px] font-black ${
                                    metrics?.depth_status === 'BUYING BIAS' || metrics?.depth_status === 'HEAVY BUYING' ? 'text-emerald-600' :
                                    metrics?.depth_status === 'SELLING BIAS' || metrics?.depth_status === 'HEAVY SELLING' ? 'text-rose-600' :
                                    'text-slate-900'
                                  }`}>
                                    {metrics?.depth_ratio?.toFixed(2) || '—'}
                                  </p>
                                  <p className="text-[7px] font-bold text-slate-400 uppercase tracking-tight leading-tight">{
                                    metrics?.depth_status === 'HEAVY SELLING' ? 'HEAVY SELL' :
                                    metrics?.depth_status === 'SELLING BIAS' ? 'SELL BIAS' :
                                    metrics?.depth_status === 'BUYING BIAS' ? 'BUY BIAS' :
                                    metrics?.depth_status === 'HEAVY BUYING' ? 'HEAVY BUY' :
                                    'BALANCED'
                                  }</p>
                                </div>
                              </div>

                              <div className="flex flex-col gap-1.5 text-right">
                                <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Regime</p>
                                <div>
                                  <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest border inline-block ${
                                    metrics?.regime === 'BREAKOUT' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                                    metrics?.regime === 'DISTRIBUTION' ? 'bg-rose-50 text-rose-600 border-rose-100' :
                                    'bg-slate-50 text-slate-400 border-slate-100'
                                  }`}>
                                    {metrics?.regime || '—'}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Execution Style Section - Enhanced */}
                            <div className="pt-4 border-t border-slate-50">
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Execution Style</p>
                                <span className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest border-2 ${
                                  metrics?.execution_style === 'OK FOR MARKET' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                  metrics?.execution_style === 'CAUTION' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                  metrics?.execution_style === 'AVOID' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                                  metrics?.execution_style === 'MARKET CLOSED' ? 'bg-slate-50 text-slate-500 border-slate-200' :
                                  'bg-blue-50 text-blue-700 border-blue-200'
                                }`}>
                                  {metrics?.execution_style || '—'}
                                </span>
                              </div>

                              {/* Execution Hint */}
                              <div className={`p-3 rounded-lg border text-[9px] font-medium leading-relaxed ${
                                metrics?.execution_style === 'OK FOR MARKET' ? 'bg-emerald-50/50 border-emerald-100 text-emerald-900' :
                                metrics?.execution_style === 'CAUTION' ? 'bg-amber-50/50 border-amber-100 text-amber-900' :
                                metrics?.execution_style === 'AVOID' ? 'bg-rose-50/50 border-rose-100 text-rose-900' :
                                'bg-blue-50/50 border-blue-100 text-blue-900'
                              }`}>
                                {metrics?.execution_hint || 'Calculating...'}
                              </div>

                              {/* Time Context */}
                              {metrics?.time_regime !== 'AFTER_HOURS' && (
                                <div className="flex items-center gap-2 mt-2">
                                  <div className={`w-2 h-2 rounded-full ${
                                    metrics?.time_regime === 'NORMAL' ? 'bg-emerald-500' : 'bg-amber-500'
                                  }`} />
                                  <p className="text-[8px] font-bold text-slate-500 uppercase tracking-wider">
                                    {metrics?.time_regime === 'OPENING' ? 'Opening Session (9:15-10:00 AM)' :
                                     metrics?.time_regime === 'CLOSING' ? 'Closing Session (3:00-3:30 PM)' :
                                     'Normal Trading Hours'}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Footer with recommendation hint */}
                        <div className="flex items-center justify-between gap-4 pt-4 border-t border-slate-50">
                          <div className="flex items-center gap-2">
                            <div className={`w-1.5 h-1.5 rounded-full ${
                              metrics?.execution_style === 'OK FOR MARKET' ? 'bg-emerald-500' :
                              metrics?.execution_style === 'AVOID' ? 'bg-rose-500' :
                              metrics?.execution_style === 'CAUTION' ? 'bg-amber-500' :
                              'bg-blue-500'
                            }`} />
                            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
                              {getRecommendationHint(metrics)}
                            </p>
                          </div>
                          <div className="flex items-baseline gap-1">
                            <span className="text-[7px] font-black text-slate-400 uppercase">Avg Vol (20D):</span>
                            <span className="text-[8px] font-bold text-slate-600">
                              {metrics?.avg_vol_20d ? (metrics.avg_vol_20d / 1000000).toFixed(1) : '—'}M
                            </span>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-slate-100 relative z-10">
        <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest leading-tight">
          {marketStatus.isOpen ? 'Real-time tick feed active. Breeze WebSocket.' : 'Market closed. Live data available when market opens.'}
        </p>
      </div>
    </div>
  );
};
