import React, { useEffect, useState, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { supabase } from '../lib/supabase';
import { fetchQuote, fetchDepth, fetchHistorical } from '../services/apiService';
import { getMarketSessionStatus } from '../services/marketService';
import { LiquidityMetrics } from '../types';
import { X, ArrowUp, ArrowDown, Bookmark, RefreshCw, Activity, AlertCircle } from 'lucide-react';

interface PriorityStock {
  symbol: string;
  company_name: string;
  last_price?: number;
  change_val?: number;
  change_percent?: number;
  last_updated?: string;
}

export const PriorityStocksCard: React.FC = () => {
  const [priorityStocks, setPriorityStocks] = useState<PriorityStock[]>([]);
  const [quotes, setQuotes] = useState<Record<string, any>>({});
  const [depths, setDepths] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [historicalCache, setHistoricalCache] = useState<Record<string, number>>({});
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [showRawFeed, setShowRawFeed] = useState(false);
  
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const isUpdatingRef = useRef(false);

  const fetchTrackedSymbols = async () => {
    try {
      const { data, error } = await supabase
        .from('priority_stocks')
        .select('*')
        .order('added_at', { ascending: false });
      
      if (!error && data) {
        setPriorityStocks(data);
        return data;
      }
    } catch (e) {
      console.error("Watchlist fetch failed:", e);
    }
    return [];
  };

  const refreshHistoricalData = async (symbol: string) => {
    try {
      const today = new Date();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(today.getDate() - 40);

      const bars = await fetchHistorical(
        symbol, 
        thirtyDaysAgo.toISOString().split('T')[0], 
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

  const updateQuotesBatch = useCallback(async (stocks: PriorityStock[], forceOnce: boolean = false) => {
    const marketStatus = getMarketSessionStatus();
    if (!marketStatus.isOpen && !forceOnce) return;
    if (document.hidden) return; 

    if (stocks.length === 0 || isUpdatingRef.current) return;
    isUpdatingRef.current = true;

    for (let i = 0; i < stocks.length; i++) {
      const stock = stocks[i];
      await new Promise(r => setTimeout(r, 300)); // Stagger

      try {
        let quote = null;
        let depth = null;

        try {
          quote = await fetchQuote(stock.symbol);
          setQuotes(prev => ({ ...prev, [stock.symbol]: quote }));
          setErrors(prev => {
            const next = { ...prev };
            delete next[stock.symbol];
            return next;
          });
        } catch (qErr: any) {
          setErrors(prev => ({ ...prev, [stock.symbol]: qErr.message }));
        }

        try {
          depth = await fetchDepth(stock.symbol);
          setDepths(prev => ({ ...prev, [stock.symbol]: depth }));
        } catch (dErr) {
          console.warn(`Depth failed for ${stock.symbol}`);
        }

        if (quote) {
          supabase
            .from('priority_stocks')
            .update({
              last_price: parseFloat(quote.last_traded_price || quote.ltp),
              change_val: parseFloat(quote.change),
              change_percent: parseFloat(quote.percent_change || quote.ltp_percent_change),
              last_updated: new Date().toISOString()
            })
            .eq('symbol', stock.symbol)
            .then(); 
        }
      } catch (error) {
        console.error(`Update failed for ${stock.symbol}`);
      }
    }
    isUpdatingRef.current = false;
  }, []);

  const calculateMetrics = (symbol: string): LiquidityMetrics | null => {
    const q = quotes[symbol];
    const d = depths[symbol];
    const avgVol = historicalCache[symbol];
    if (!q) return null;

    const bid = parseFloat(d?.best_bid_price || q.best_bid_price || 0);
    const ask = parseFloat(d?.best_offer_price || q.best_offer_price || 0);
    const bidQty = parseFloat(d?.best_bid_quantity || q.best_bid_quantity || 0);
    const askQty = parseFloat(d?.best_offer_quantity || q.best_offer_quantity || 0);
    const mid = (bid + ask) / 2;
    
    const spread_pct = mid > 0 ? ((ask - bid) / mid) * 100 : null;
    const depth_ratio = (bidQty + 1) / (askQty + 1);
    const vol_today = parseFloat(q.total_quantity_traded || q.volume || 0);
    const vol_ratio = avgVol ? vol_today / avgVol : null;

    const close = parseFloat(q.last_traded_price || q.ltp || 0);
    const high = parseFloat(q.high || 0);
    const low = parseFloat(q.low || 0);
    const open = parseFloat(q.open || 0);
    const range = Math.max(high - low, 0.01);

    const wick_ratio = (high - Math.max(open, close)) / range;
    const close_pos = (close - low) / range;
    
    let regime: 'BREAKOUT' | 'DISTRIBUTION' | 'NEUTRAL' = 'NEUTRAL';
    if (wick_ratio > 0.55 && close_pos < 0.35 && vol_ratio && vol_ratio > 2.5) {
        regime = 'DISTRIBUTION';
    } else if (close_pos > 0.70 && vol_ratio && vol_ratio > 2.0) {
        regime = 'BREAKOUT';
    }

    let exec: 'LIMIT ONLY' | 'OK FOR MARKET' | 'AVOID' = 'LIMIT ONLY';
    if (spread_pct === null) exec = 'LIMIT ONLY';
    else if (spread_pct > 0.50) exec = 'AVOID';
    else if (spread_pct < 0.15 && (vol_ratio === null || vol_ratio >= 1.2)) exec = 'OK FOR MARKET';

    return {
      spread_pct,
      depth_ratio,
      vol_ratio,
      regime,
      execution_style: exec,
      bid, ask, bidQty, askQty,
      avg_vol_20d: avgVol || null
    };
  };

  const getRecommendationHint = (metrics: LiquidityMetrics | null) => {
    const marketStatus = getMarketSessionStatus();
    if (!marketStatus.isOpen) return "Market Closed - Last Ledger Displayed";
    if (!metrics) return "Awaiting depth...";
    if (metrics.execution_style === 'AVOID') return "Avoid thin liquidity";
    if (metrics.regime === 'DISTRIBUTION') return "Sell-on-news risk; wait";
    if (metrics.regime === 'BREAKOUT') return "Momentum OK if volume holds";
    return "Watch confirmation";
  };

  const removeStock = async (symbol: string) => {
    const { error } = await supabase.from('priority_stocks').delete().eq('symbol', symbol);
    if (!error) {
      setPriorityStocks(prev => prev.filter(s => s.symbol !== symbol));
    }
  };

  useEffect(() => {
    // This effect handles the initial data load
    const init = async () => {
      const stocks = await fetchTrackedSymbols();
      if (stocks.length > 0) {
        updateQuotesBatch(stocks, true); // Run once to get initial data
        stocks.forEach(s => refreshHistoricalData(s.symbol));
      }
    };
    init();
  }, [updateQuotesBatch]);

  useEffect(() => {
    // This effect handles the real-time updates
    if (priorityStocks.length === 0) return;

    const socket = io("http://localhost:5000");

    socket.on('connect', () => {
        console.log('Socket connected');
        const proxy_key = localStorage.getItem('breeze_proxy_key') || '';
        socket.emit('subscribe_to_watchlist', {
            stocks: priorityStocks.map(s => s.symbol),
            proxy_key: proxy_key
        });
    });

    socket.on('watchlist_update', (data) => {
        setQuotes(prev => ({ ...prev, [data.symbol]: data }));
        // Also update the priorityStocks array to reflect the new price
        setPriorityStocks(prev => prev.map(stock => {
            if (stock.symbol === data.symbol) {
                return {
                    ...stock,
                    last_price: parseFloat(data.last_traded_price || data.ltp),
                    change_val: parseFloat(data.change),
                    change_percent: parseFloat(data.percent_change || data.ltp_percent_change),
                    last_updated: new Date().toISOString()
                };
            }
            return stock;
        }));
    });

    socket.on('disconnect', () => {
        console.log('Socket disconnected');
    });

    // Cleanup on component unmount
    return () => {
        socket.disconnect();
    };
  }, [priorityStocks]);


  const marketStatus = getMarketSessionStatus();

  return (
    <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-xl h-full flex flex-col group">
      <div className="flex justify-between items-start mb-4 relative z-10">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-emerald-100 bg-emerald-50">
            <div className={`w-1 h-1 rounded-full ${marketStatus.isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
            <span className={`text-[8px] font-black uppercase tracking-[0.2em] ${marketStatus.isOpen ? 'text-emerald-600' : 'text-slate-400'}`}>
              {marketStatus.isOpen ? 'LIQUIDITY TICKER' : 'LEDGER STANDBY'}
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
           <p className="text-[9px] font-black text-indigo-600 uppercase tracking-tight mt-1">
             {marketStatus.isOpen ? 'Stagger 300ms' : 'Polling Suspended'}
           </p>
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
            const isPositive = parseFloat(quote?.change || 0) >= 0;
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
                      {error && <AlertCircle className="w-3 h-3 text-red-500" title={error} />}
                    </div>
                    <span className="text-[7px] font-bold text-slate-400 uppercase truncate max-w-[100px]">{stock.company_name}</span>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    {quote ? (
                      <div className="text-right">
                        <p className="text-xs font-black text-slate-900 tabular-nums">
                          {parseFloat(quote.last_traded_price || quote.ltp).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </p>
                        <div className={`flex items-center justify-end gap-1 text-[8px] font-black ${isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {isPositive ? <ArrowUp className="w-2 h-2" /> : <ArrowDown className="w-2 h-2" />}
                          <span className="tabular-nums">{Math.abs(parseFloat(quote.percent_change || quote.ltp_percent_change)).toFixed(2)}%</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-right">
                         <p className="text-xs font-black text-slate-300 tabular-nums">0.00</p>
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
                            <div className="grid grid-cols-3 gap-4">
                              <div className="flex flex-col gap-1.5">
                                <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Best Bid</p>
                                <p className="text-[10px] font-black text-slate-900 tabular-nums">
                                  ₹{metrics?.bid?.toLocaleString() || '—'} <span className="text-slate-400 text-[8px]">({metrics?.bidQty || 0})</span>
                                </p>
                              </div>
                              <div className="flex flex-col gap-1.5">
                                <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Best Ask</p>
                                <p className="text-[10px] font-black text-slate-900 tabular-nums">
                                  ₹{metrics?.ask?.toLocaleString() || '—'} <span className="text-slate-400 text-[8px]">({metrics?.askQty || 0})</span>
                                </p>
                              </div>
                              <div className="flex flex-col gap-1.5 text-right">
                                <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Spread %</p>
                                <div>
                                  <span className={`px-2 py-1 rounded text-[10px] font-black tabular-nums border inline-block ${
                                    !metrics || metrics.spread_pct === null ? 'bg-slate-50 text-slate-400 border-slate-100' :
                                    metrics.spread_pct < 0.15 ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 
                                    metrics.spread_pct < 0.50 ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-rose-50 text-rose-600 border-rose-100'
                                  }`}>
                                    {metrics?.spread_pct !== null && metrics?.spread_pct !== undefined ? metrics.spread_pct.toFixed(3) + '%' : '—'}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="grid grid-cols-4 gap-4 pt-4 border-t border-slate-50">
                              <div className="flex flex-col gap-1.5">
                                <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Vol Today</p>
                                <p className="text-[9px] font-black text-slate-900">{(quote?.total_quantity_traded ? (parseFloat(quote.total_quantity_traded) / 1000000).toFixed(2) : '—')}M</p>
                              </div>
                              <div className="flex flex-col gap-1.5 text-center">
                                <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Vol Ratio</p>
                                <p className={`text-[9px] font-black ${metrics?.vol_ratio ? (metrics.vol_ratio > 2 ? 'text-emerald-600' : metrics.vol_ratio < 1 ? 'text-rose-500' : 'text-slate-900') : 'text-slate-400'}`}>
                                  {metrics?.vol_ratio?.toFixed(2) || '0.00'}x
                                </p>
                              </div>
                              <div className="flex flex-col gap-1.5 text-center">
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
                              <div className="flex flex-col gap-1.5 text-right">
                                <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Exec Style</p>
                                <div>
                                  <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest border inline-block ${
                                    metrics?.execution_style === 'OK FOR MARKET' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                                    metrics?.execution_style === 'AVOID' ? 'bg-rose-50 text-rose-600 border-rose-100' :
                                    'bg-amber-50 text-amber-600 border-amber-100'
                                  }`}>
                                    {metrics?.execution_style || '—'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="flex items-center justify-between gap-4 pt-4 border-t border-slate-50">
                           <div className="flex items-center gap-2">
                             <div className={`w-1.5 h-1.5 rounded-full ${metrics?.execution_style === 'OK FOR MARKET' ? 'bg-emerald-500' : metrics?.execution_style === 'AVOID' ? 'bg-rose-500' : 'bg-amber-500'}`} />
                             <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
                               {getRecommendationHint(metrics)}
                             </p>
                           </div>
                           <div className="flex items-baseline gap-1">
                              <span className="text-[7px] font-black text-slate-400 uppercase">Avg Vol (20D):</span>
                              <span className="text-[8px] font-bold text-slate-600">{metrics?.avg_vol_20d ? (metrics.avg_vol_20d / 1000000).toFixed(1) : '—'}M</span>
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
          {marketStatus.isOpen ? 'Microstructure Audit Active. Staggered 300ms polling enabled.' : 'Market Closed. Displaying last known ledger values from persistence layer.'}
        </p>
      </div>
    </div>
  );
};