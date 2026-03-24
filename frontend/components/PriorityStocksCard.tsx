import React, { useEffect, useState, useRef, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';
import { supabase } from '../lib/supabase';
import { fetchHistorical } from '../services/apiService';
import { getMarketSessionStatus } from '../services/marketService';
import { getProxyBaseUrl, normalizeBreezeQuoteFromRow } from '../services/breezeService';
import { LiquidityMetrics } from '../types';
import { X, ArrowUp, ArrowDown, Bookmark, AlertCircle, ChevronDown, ChevronUp, Code2 } from 'lucide-react';

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
  onNiftyTick?: (data: Record<string, unknown>) => void;
}

const Badge: React.FC<{ children: React.ReactNode; color: 'emerald' | 'rose' | 'amber' | 'orange' | 'gray' | 'indigo' | 'teal' }> = ({ children, color }) => {
  const styles = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    orange: 'bg-orange-50 text-orange-700 border-orange-200',
    gray: 'bg-gray-100 text-gray-500 border-gray-200',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    teal: 'bg-teal-50 text-teal-700 border-teal-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${styles[color]}`}>
      {children}
    </span>
  );
};

export const PriorityStocksCard: React.FC<PriorityStocksCardProps> = ({ onNiftyTick }) => {
  const [priorityStocks, setPriorityStocks] = useState<PriorityStock[]>([]);
  const [stocksFetched, setStocksFetched] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [historicalCache, setHistoricalCache] = useState<Record<string, number>>({});
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [showRawFeed, setShowRawFeed] = useState(false);

  const onNiftyTickRef = useRef(onNiftyTick);
  useEffect(() => { onNiftyTickRef.current = onNiftyTick; }, [onNiftyTick]);

  const fetchTrackedSymbols = async () => {
    try {
      const { data, error } = await supabase.from('priority_stocks').select('*');
      if (error) { console.warn('Priority stocks fetch error:', error.message); return []; }
      if (!data || !Array.isArray(data)) return [];
      const mapped: PriorityStock[] = data.map((row: Record<string, unknown>) => ({
        symbol: String(row.symbol ?? ''),
        company_name: String(row.company_name ?? ''),
      }));
      setPriorityStocks(mapped);
      setStocksFetched(true);
      return data;
    } catch (e) { console.error('Watchlist fetch failed:', e); }
    return [];
  };

  const refreshHistoricalData = async (symbol: string) => {
    try {
      const today = new Date();
      const fortyDaysAgo = new Date();
      fortyDaysAgo.setDate(today.getDate() - 40);
      const bars = await fetchHistorical(symbol, fortyDaysAgo.toISOString().split('T')[0], today.toISOString().split('T')[0]);
      if (bars.length > 0) {
        const last20 = bars.slice(-20);
        const avgVol = last20.reduce((acc: number, bar: any) => acc + parseFloat(bar.volume), 0) / last20.length;
        setHistoricalCache(prev => ({ ...prev, [symbol]: avgVol }));
      }
    } catch (e) { console.warn(`Historical sync failed for ${symbol}`); }
  };

  useEffect(() => {
    const init = async () => {
      const stocks = await fetchTrackedSymbols();
      if (stocks.length > 0) stocks.forEach((s: any) => refreshHistoricalData(String(s.symbol)));
    };
    init();
  }, []);

  const watchlistKey = useMemo(() => priorityStocks.map(s => s.symbol).join(','), [priorityStocks]);

  const socketRef = useRef<Socket | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Wait for Supabase stocks to load before connecting — prevents a double
    // subscription cycle (first with only NIFTY, then again with all stocks)
    // which causes a proxy race condition that silently drops watchlist feeds.
    if (!stocksFetched) return;
    const symbolsToSubscribe = ['NIFTY', ...priorityStocks.map(s => s.symbol)];
    const connect = () => {
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
        socket.emit('subscribe_to_watchlist', {
          stocks: symbolsToSubscribe,
          proxy_key: localStorage.getItem('breeze_proxy_key') || '',
        });
      });
      socket.on('watchlist_update', (data: Record<string, unknown>) => {
        const symbol = String(data.symbol || '').toUpperCase();
        if (!symbol) return;
        if (symbol === 'NIFTY' || symbol === 'NIFTY 50') {
          onNiftyTickRef.current?.(data);
          return;
        }
        const normalized = normalizeBreezeQuoteFromRow(data, symbol);
        setQuotes(prev => {
          const existing = prev[symbol];
          return {
            ...prev,
            [symbol]: {
              ...normalized,
              high: normalized.high !== 0 ? normalized.high : (existing?.high ?? 0),
              low: normalized.low !== 0 ? normalized.low : (existing?.low ?? 0),
              previous_close: normalized.previous_close !== 0 ? normalized.previous_close : (existing?.previous_close ?? 0),
            },
          };
        });
        setErrors(prev => { const next = { ...prev }; delete next[symbol]; return next; });
      });
      socket.on('watchlist_error', (err: Record<string, unknown>) => {
        console.warn('[PriorityStocksCard] watchlist_error:', err?.error);
        if (getMarketSessionStatus().isOpen && socket.connected) {
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = setTimeout(() => {
            if (socket.connected) {
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
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [watchlistKey, stocksFetched]);

  const validateMarketData = (q: QuoteData | undefined): { isValid: boolean; reason?: string } => {
    if (!q) return { isValid: false, reason: 'No quote data' };
    const bid = q.best_bid_price || 0;
    const ask = q.best_offer_price || 0;
    if (bid <= 0 || ask <= 0) return { isValid: false, reason: 'Invalid bid/ask prices' };
    if (ask < bid) return { isValid: false, reason: 'Ask < Bid (invalid)' };
    if (((ask - bid) / bid) * 100 > 10) return { isValid: false, reason: 'Abnormal spread (>10%)' };
    return { isValid: true };
  };

  const calculateMetrics = (symbol: string): LiquidityMetrics | null => {
    const q = quotes[symbol];
    const avgVol = historicalCache[symbol];
    const validation = validateMarketData(q);
    if (!validation.isValid) {
      return {
        spread_pct: null, depth_ratio: null, vol_ratio: null, regime: 'NEUTRAL',
        execution_style: 'MARKET CLOSED', bid: 0, ask: 0, bidQty: 0, askQty: 0,
        avg_vol_20d: avgVol || null, liquidity_quality_score: 0, liquidity_grade: 'F',
        is_tradeable: false, risk_level: 'EXTREME', spread_status: 'AVOID',
        volume_status: 'LOW', depth_status: 'BALANCED', time_regime: 'AFTER_HOURS',
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

    let spread_status: LiquidityMetrics['spread_status'];
    if (spread_pct < 0.05) spread_status = 'EXCELLENT';
    else if (spread_pct < 0.15) spread_status = 'GOOD';
    else if (spread_pct < 0.30) spread_status = 'ACCEPTABLE';
    else if (spread_pct < 0.50) spread_status = 'POOR';
    else spread_status = 'AVOID';

    let volume_status: LiquidityMetrics['volume_status'];
    if (!vol_ratio) volume_status = 'NORMAL';
    else if (vol_ratio < 0.5) volume_status = 'LOW';
    else if (vol_ratio < 1.2) volume_status = 'NORMAL';
    else if (vol_ratio < 2.0) volume_status = 'ELEVATED';
    else if (vol_ratio < 4.0) volume_status = 'HIGH';
    else volume_status = 'EXTREME';

    let depth_status: LiquidityMetrics['depth_status'];
    if (depth_ratio < 0.5) depth_status = 'HEAVY SELLING';
    else if (depth_ratio < 0.8) depth_status = 'SELLING BIAS';
    else if (depth_ratio <= 1.2) depth_status = 'BALANCED';
    else if (depth_ratio <= 2.5) depth_status = 'BUYING BIAS';
    else depth_status = 'HEAVY BUYING';

    const now = new Date();
    const istOffset = 5.5 * 60;
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const istMinutes = (utcMinutes + istOffset) % (24 * 60);
    let time_regime: LiquidityMetrics['time_regime'];
    if (istMinutes >= 9 * 60 + 15 && istMinutes < 10 * 60) time_regime = 'OPENING';
    else if (istMinutes >= 15 * 60 && istMinutes < 15 * 60 + 30) time_regime = 'CLOSING';
    else if (istMinutes >= 10 * 60 && istMinutes < 15 * 60) time_regime = 'NORMAL';
    else time_regime = 'AFTER_HOURS';

    const wick_ratio = (high - Math.max(open, close)) / range;
    const close_pos = (close - low) / range;
    let regime: LiquidityMetrics['regime'] = 'NEUTRAL';
    if (wick_ratio > 0.55 && close_pos < 0.35 && vol_ratio && vol_ratio > 2.5) regime = 'DISTRIBUTION';
    else if (close_pos > 0.70 && vol_ratio && vol_ratio > 2.0) regime = 'BREAKOUT';

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
    if (depth_status === 'BALANCED') score += 20;
    else if (depth_status === 'BUYING BIAS') score += 15;
    else if (depth_status === 'SELLING BIAS') score -= 10;
    else if (depth_status === 'HEAVY SELLING') score -= 20;
    else score += 5;
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

    let execution_style: LiquidityMetrics['execution_style'];
    let execution_hint: string;
    if (spread_pct > 0.50) { execution_style = 'AVOID'; execution_hint = `Spread too wide (${spread_pct.toFixed(2)}%) — illiquid`; }
    else if (time_regime === 'OPENING' || time_regime === 'CLOSING') { execution_style = 'CAUTION'; execution_hint = `${time_regime === 'OPENING' ? 'Opening' : 'Closing'} volatility — spreads widening`; }
    else if (regime === 'DISTRIBUTION' && depth_ratio < 0.6) { execution_style = 'AVOID'; execution_hint = 'Distribution + heavy selling pressure'; }
    else if (spread_pct < 0.10 && (vol_ratio === null || vol_ratio >= 1.2) && depth_ratio > 0.7 && depth_ratio < 2.5 && time_regime === 'NORMAL') { execution_style = 'OK FOR MARKET'; execution_hint = `Excellent liquidity — market orders OK at ₹${mid.toFixed(2)}`; }
    else if (spread_pct < 0.15 && (vol_ratio === null || vol_ratio >= 1.0) && depth_ratio > 0.6 && depth_ratio < 3.0) { execution_style = 'OK FOR MARKET'; execution_hint = 'Good liquidity — market orders acceptable'; }
    else if (spread_pct < 0.30) { execution_style = 'LIMIT ONLY'; execution_hint = `Use limit orders near ₹${(bid + (ask - bid) * 0.4).toFixed(2)} to save spread`; }
    else { execution_style = 'LIMIT ONLY'; execution_hint = 'Moderate spread — limit orders recommended'; }

    let risk_level: LiquidityMetrics['risk_level'];
    if (execution_style === 'AVOID') risk_level = 'EXTREME';
    else if (execution_style === 'CAUTION' || spread_pct > 0.30) risk_level = 'HIGH';
    else if (spread_pct > 0.15 || vol_ratio === null || vol_ratio < 1.0) risk_level = 'MEDIUM';
    else risk_level = 'LOW';

    return { spread_pct, depth_ratio, vol_ratio, regime, execution_style, bid, ask, bidQty, askQty, avg_vol_20d: avgVol || null, liquidity_quality_score, liquidity_grade, is_tradeable, risk_level, spread_status, volume_status, depth_status, time_regime, execution_hint };
  };

  const getRecommendationHint = (metrics: LiquidityMetrics | null) => {
    if (!metrics) return 'Calculating…';
    if (metrics.execution_style === 'MARKET CLOSED') return 'Market closed — no live data';
    if (metrics.execution_style === 'AVOID') return metrics.execution_hint || 'Avoid — poor liquidity';
    if (metrics.execution_style === 'CAUTION') return metrics.execution_hint || 'Caution — volatile period';
    if (metrics.execution_style === 'OK FOR MARKET') return metrics.liquidity_grade === 'A' ? 'Excellent setup' : 'Good liquidity';
    if (metrics.regime === 'BREAKOUT' && metrics.volume_status === 'HIGH') return 'Momentum building';
    if (metrics.volume_status === 'LOW') return 'Low volume — wait';
    return metrics.execution_hint || 'Use limits to save spread';
  };

  const removeStock = async (symbol: string) => {
    const { error } = await supabase.from('priority_stocks').delete().eq('symbol', symbol);
    if (!error) {
      setPriorityStocks(prev => prev.filter(s => s.symbol !== symbol));
      setQuotes(prev => { const n = { ...prev }; delete n[symbol]; return n; });
      setErrors(prev => { const n = { ...prev }; delete n[symbol]; return n; });
    }
  };

  const marketStatus = getMarketSessionStatus();

  const execStyleColor = (style: string): 'emerald' | 'rose' | 'amber' | 'orange' | 'gray' => {
    if (style === 'OK FOR MARKET') return 'emerald';
    if (style === 'AVOID') return 'rose';
    if (style === 'CAUTION') return 'orange';
    if (style === 'MARKET CLOSED') return 'gray';
    return 'amber';
  };

  const gradeColor = (g: string): 'emerald' | 'teal' | 'amber' | 'orange' | 'rose' => {
    if (g === 'A') return 'emerald';
    if (g === 'B') return 'teal';
    if (g === 'C') return 'amber';
    if (g === 'D') return 'orange';
    return 'rose';
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Watchlist</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {marketStatus.isOpen ? 'Live tick feed active' : 'Market closed'}
            </p>
          </div>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
            marketStatus.isOpen
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-gray-100 text-gray-400 border-gray-200'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${marketStatus.isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
            {marketStatus.isOpen ? 'Live' : 'Closed'}
          </span>
        </div>
        <button
          onClick={() => setShowRawFeed(!showRawFeed)}
          className={`p-1.5 rounded-lg border text-xs font-medium transition-colors ${
            showRawFeed
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'text-gray-400 border-gray-200 hover:bg-gray-50'
          }`}
          title="Toggle raw feed"
        >
          <Code2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Stock list */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
        {priorityStocks.length === 0 ? (
          <div className="py-16 flex flex-col items-center text-center opacity-50">
            <Bookmark className="w-8 h-8 text-gray-300 mb-3" />
            <p className="text-sm font-medium text-gray-400">No stocks in watchlist</p>
            <p className="text-xs text-gray-300 mt-1">Bookmark stocks from the Reg 30 tab</p>
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
              <div key={stock.symbol} className="group">
                {/* Row */}
                <div
                  className="flex items-center justify-between px-5 py-3.5 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => setExpandedSymbol(isExpanded ? null : stock.symbol)}
                >
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold text-gray-900">{stock.symbol}</span>
                      {error && <AlertCircle className="w-3.5 h-3.5 text-rose-500 flex-shrink-0" />}
                    </div>
                    <span className="text-xs text-gray-400 truncate max-w-[140px]">{stock.company_name}</span>
                  </div>

                  <div className="flex items-center gap-3">
                    {displayPrice !== null ? (
                      <div className="text-right">
                        <p className="text-sm font-semibold text-gray-900 tabular-nums">
                          ₹{displayPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </p>
                        <div className={`flex items-center justify-end gap-0.5 text-xs font-medium ${isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {isPositive ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                          <span className="tabular-nums">{Math.abs(displayPct || 0).toFixed(2)}%</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-right">
                        <p className="text-sm font-semibold text-gray-300 tabular-nums">—</p>
                        <p className="text-xs text-gray-300">{error ? 'Error' : 'Awaiting…'}</p>
                      </div>
                    )}

                    <button
                      onClick={e => { e.stopPropagation(); removeStock(stock.symbol); }}
                      className="p-1 text-gray-300 hover:text-rose-500 transition-colors rounded"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>

                    {isExpanded
                      ? <ChevronUp className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      : <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-5 py-4 bg-gray-50 border-t border-gray-100 space-y-4">
                    {showRawFeed ? (
                      <pre className="text-[10px] font-mono bg-white p-3 rounded-xl border border-gray-200 overflow-x-auto text-gray-500 max-h-40 overflow-y-auto">
                        {JSON.stringify({ quote, metrics, error }, null, 2)}
                      </pre>
                    ) : error ? (
                      <div className="flex items-center gap-2 p-3 bg-rose-50 rounded-xl border border-rose-200 text-rose-700 text-xs font-medium">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        {error}
                      </div>
                    ) : (
                      <>
                        {/* Bid / Ask / Spread */}
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            { label: 'Best Bid', value: metrics?.bid ? `₹${metrics.bid.toLocaleString('en-IN')}` : '—', sub: `(${metrics?.bidQty || 0})` },
                            { label: 'Best Ask', value: metrics?.ask ? `₹${metrics.ask.toLocaleString('en-IN')}` : '—', sub: `(${metrics?.askQty || 0})` },
                          ].map(item => (
                            <div key={item.label} className="bg-white rounded-xl p-3 border border-gray-100">
                              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{item.label}</p>
                              <p className="text-xs font-semibold text-gray-900 tabular-nums">{item.value} <span className="text-gray-400 text-[10px]">{item.sub}</span></p>
                            </div>
                          ))}
                          <div className="bg-white rounded-xl p-3 border border-gray-100">
                            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Spread %</p>
                            <Badge color={
                              !metrics || metrics.spread_pct === null ? 'gray' :
                              metrics.spread_pct < 0.15 ? 'emerald' :
                              metrics.spread_pct < 0.50 ? 'amber' : 'rose'
                            }>
                              {metrics?.spread_pct !== null && metrics?.spread_pct !== undefined
                                ? `${metrics.spread_pct.toFixed(3)}%`
                                : '—'}
                            </Badge>
                          </div>
                        </div>

                        {/* Volume / Regime / Exec */}
                        <div className="grid grid-cols-4 gap-2">
                          <div className="bg-white rounded-xl p-3 border border-gray-100 col-span-1">
                            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Vol Today</p>
                            <p className="text-xs font-semibold text-gray-900">
                              {((quote?.total_quantity_traded ?? quote?.volume ?? 0) > 0
                                ? (((quote?.total_quantity_traded ?? quote?.volume) ?? 0) / 1000000).toFixed(2)
                                : '—')}M
                            </p>
                          </div>
                          <div className="bg-white rounded-xl p-3 border border-gray-100 col-span-1">
                            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Vol Ratio</p>
                            <p className={`text-xs font-semibold tabular-nums ${
                              metrics?.vol_ratio
                                ? metrics.vol_ratio > 2 ? 'text-emerald-600' : metrics.vol_ratio < 1 ? 'text-rose-600' : 'text-gray-900'
                                : 'text-gray-400'
                            }`}>
                              {metrics?.vol_ratio?.toFixed(2) || '0.00'}x
                            </p>
                          </div>
                          <div className="bg-white rounded-xl p-3 border border-gray-100 col-span-1">
                            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Regime</p>
                            <Badge color={metrics?.regime === 'BREAKOUT' ? 'emerald' : metrics?.regime === 'DISTRIBUTION' ? 'rose' : 'gray'}>
                              {metrics?.regime || '—'}
                            </Badge>
                          </div>
                          <div className="bg-white rounded-xl p-3 border border-gray-100 col-span-1">
                            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Exec</p>
                            <Badge color={execStyleColor(metrics?.execution_style || '')}>
                              {metrics?.execution_style === 'OK FOR MARKET' ? 'MARKET OK' : (metrics?.execution_style || '—')}
                            </Badge>
                          </div>
                        </div>

                        {/* Grade / Score / Session */}
                        <div className="grid grid-cols-3 gap-2">
                          <div className="bg-white rounded-xl p-3 border border-gray-100">
                            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Liq Grade</p>
                            <Badge color={gradeColor(metrics?.liquidity_grade || 'F')}>
                              {metrics?.liquidity_grade || '—'}
                            </Badge>
                          </div>
                          <div className="bg-white rounded-xl p-3 border border-gray-100">
                            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Score</p>
                            <p className="text-xs font-semibold text-gray-900 tabular-nums">
                              {metrics?.liquidity_quality_score ?? '—'}<span className="text-gray-400">/100</span>
                            </p>
                          </div>
                          <div className="bg-white rounded-xl p-3 border border-gray-100">
                            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Session</p>
                            <Badge color={
                              metrics?.time_regime === 'OPENING' || metrics?.time_regime === 'CLOSING' ? 'orange' :
                              metrics?.time_regime === 'NORMAL' ? 'gray' : 'gray'
                            }>
                              {metrics?.time_regime || '—'}
                            </Badge>
                          </div>
                        </div>

                        {/* Hint row */}
                        <div className="flex items-center justify-between pt-1">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                              metrics?.execution_style === 'OK FOR MARKET' ? 'bg-emerald-500' :
                              metrics?.execution_style === 'AVOID' ? 'bg-rose-500' :
                              metrics?.execution_style === 'CAUTION' ? 'bg-orange-500' :
                              metrics?.execution_style === 'MARKET CLOSED' ? 'bg-gray-300' : 'bg-amber-500'
                            }`} />
                            <p className="text-xs font-medium text-gray-600">{getRecommendationHint(metrics)}</p>
                          </div>
                          <p className="text-xs text-gray-400">
                            Avg Vol (20D): <span className="font-medium text-gray-600">{metrics?.avg_vol_20d ? (metrics.avg_vol_20d / 1000000).toFixed(1) : '—'}M</span>
                          </p>
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
    </div>
  );
};
