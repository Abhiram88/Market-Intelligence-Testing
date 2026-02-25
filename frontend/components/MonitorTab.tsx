
import React, { useState, useEffect } from 'react';
import { Card, CardContent } from './ui/Card';
import { summarizeMarketOutlook, analyzeStockDeepDive, fetchQuote, fetchDepth } from '../services/apiService';
import { getMarketSessionStatus, fetchRealtimeMarketTelemetry, MarketTelemetry } from '../services/marketService';
import { normalizeBreezeQuoteFromRow } from '../services/breezeService';
import { NewsAttribution, MarketLog, LiquidityMetrics } from '../types';
import { Search, Zap, Loader2, Info, AlertCircle } from 'lucide-react';
import { PriorityStocksCard } from './PriorityStocksCard';
import { NiftyRealtimeCard } from './NiftyRealtimeCard';
import { io } from 'socket.io-client';
import { getProxyBaseUrl } from '../services/breezeService';

const MonitorTab: React.FC = () => {
  // Intelligence Section State
  const [activeIntelTab, setActiveIntelTab] = useState<'radar' | 'deepdive'>('radar');
  const [attribution, setAttribution] = useState<NewsAttribution | null>(null);
  const [isAnalyzingMarket, setIsAnalyzingMarket] = useState(false);
  
  const [stockSymbol, setStockSymbol] = useState('');
  const [stockAnalysis, setStockAnalysis] = useState<NewsAttribution | null>(null);
  const [stockMetrics, setStockMetrics] = useState<LiquidityMetrics | null>(null);
  const [isAnalyzingStock, setIsAnalyzingStock] = useState(false);
  const [intelError, setIntelError] = useState<string | null>(null);

  const [telemetry, setTelemetry] = useState<MarketTelemetry | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const marketStatus = getMarketSessionStatus();

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      try {
        const data = await fetchRealtimeMarketTelemetry();
        if (isMounted) setTelemetry(data);
      } catch (e: any) {
        console.warn('Failed to refresh Nifty telemetry:', e?.message || e);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchData(); // Initial fetch
    const fallbackInterval = window.setInterval(fetchData, 15000);

    const socket = io(getProxyBaseUrl(), {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 10000
    });

    socket.on('connect', () => {
        console.log('Nifty socket connected');
        const proxy_key = localStorage.getItem('breeze_proxy_key') || '';
        socket.emit('subscribe_to_watchlist', {
            stocks: ['NIFTY'],
            proxy_key: proxy_key
        });
    });

    socket.on('watchlist_update', (data: Record<string, unknown>) => {
      const symbol = String(data.symbol || '').toUpperCase();
      if (symbol !== 'NIFTY' && symbol !== 'NIFTY 50') return;
      if (!getMarketSessionStatus().isOpen) return;
      const normalized = normalizeBreezeQuoteFromRow(data, 'NIFTY');
      setTelemetry({
        ...normalized,
        dataSource: 'Breeze Direct' as const,
        errorType: 'none'
      });
    });

    socket.on('connect_error', (err) => {
        console.log('Nifty socket connection error:', err);
    });

    socket.on('disconnect', () => {
        console.log('Nifty socket disconnected');
    });

    return () => {
      isMounted = false;
      window.clearInterval(fallbackInterval);
      socket.disconnect();
    };
  }, []);

  const handleMarketAnalysis = async () => {
    setIsAnalyzingMarket(true);
    setIntelError(null);
    if (!telemetry) {
      setIntelError("Market data is not available yet. Please try again in a moment.");
      setIsAnalyzingMarket(false);
      return;
    }
    const log: MarketLog = {
      id: `log-${Date.now()}`,
      log_date: new Date().toISOString().split('T')[0],
      ltp: telemetry.last_traded_price,
      points_change: telemetry.change,
      change_percent: telemetry.percent_change,
      day_high: telemetry.high,
      day_low: telemetry.low,
      volume: telemetry.volume,
      source: telemetry.dataSource as string,
      is_live: marketStatus.isOpen,
      niftyClose: telemetry.last_traded_price,
      niftyChange: telemetry.change,
      niftyChangePercent: telemetry.percent_change,
      date: new Date().toISOString().split('T')[0]
    };
    try {
      const result = await summarizeMarketOutlook(log);
      setAttribution(result);
    } catch (e: any) {
      setIntelError(e.message || "Failed to synthesize market intelligence.");
    } finally {
      setIsAnalyzingMarket(false);
    }
  };

  const handleStockAnalysis = async () => {
    if (!stockSymbol) return;
    setIsAnalyzingStock(true);
    setIntelError(null);
    setStockAnalysis(null);
    setStockMetrics(null);
    
    try {
      const [quote, depth] = await Promise.all([
        fetchQuote(stockSymbol),
        fetchDepth(stockSymbol)
      ]);

      const bid = depth.best_bid_price || quote.best_bid_price || 0;
      const ask = depth.best_offer_price || quote.best_offer_price || 0;
      const mid = (bid + ask) / 2;
      const spread = mid > 0 ? ((ask - bid) / mid) * 100 : null;
      
      setStockMetrics({
        spread_pct: spread,
        depth_ratio: (depth.best_bid_quantity || 0) + 1 / (depth.best_offer_quantity || 0) + 1,
        vol_ratio: null,
        regime: 'NEUTRAL',
        execution_style: spread && spread < 0.15 ? 'OK FOR MARKET' : 'LIMIT ONLY',
        bid, ask, 
        bidQty: depth.best_bid_quantity || 0, 
        askQty: depth.best_offer_quantity || 0,
        avg_vol_20d: null
      });

      const result = await analyzeStockDeepDive(stockSymbol);
      setStockAnalysis(result);
    } catch (e: any) {
      setIntelError(e.message || "Failed to perform deep dive.");
    } finally {
      setIsAnalyzingStock(false);
    }
  };

  return (
    <div className="space-y-8 w-full">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <NiftyRealtimeCard telemetry={telemetry} isLoading={isLoading} />
        <div className="lg:col-span-2">
          <PriorityStocksCard />
        </div>
      </div>

      {/* Unified Intelligence Container */}
      <Card className="rounded-[2.5rem] border-slate-200 shadow-2xl overflow-hidden bg-white min-h-[500px] flex flex-col">
        <div className="px-8 py-6 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
            <button onClick={() => setActiveIntelTab('radar')} className={`px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${activeIntelTab === 'radar' ? 'bg-white text-indigo-600 shadow-sm border border-slate-100' : 'text-slate-400 hover:text-slate-600'}`}>Market Radar</button>
            <button onClick={() => setActiveIntelTab('deepdive')} className={`px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${activeIntelTab === 'deepdive' ? 'bg-white text-indigo-600 shadow-sm border border-slate-100' : 'text-slate-400 hover:text-slate-600'}`}>Equity Deep Dive</button>
          </div>
          <div className="flex items-center gap-4">
            {activeIntelTab === 'deepdive' && <input type="text" placeholder="SYMBOL" value={stockSymbol} onChange={(e) => setStockSymbol(e.target.value.toUpperCase())} className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-indigo-500 w-40" />}
            <button onClick={activeIntelTab === 'radar' ? handleMarketAnalysis : handleStockAnalysis} disabled={isAnalyzingMarket || isAnalyzingStock || (activeIntelTab === 'deepdive' && !stockSymbol)} className="px-8 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all shadow-lg shadow-indigo-200 disabled:opacity-50 flex items-center gap-2">
              {(isAnalyzingMarket || isAnalyzingStock) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
              {activeIntelTab === 'radar' ? (attribution ? 'Refresh Intelligence' : 'Synthesize Intelligence') : 'Analyze'}
            </button>
          </div>
        </div>

        <CardContent className="flex-1 p-10">
          {intelError && (
            <div className="mb-8 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 animate-in fade-in slide-in-from-top-2">
              <AlertCircle className="w-5 h-5" />
              <span className="text-xs font-bold uppercase tracking-widest">{intelError}</span>
            </div>
          )}

          {activeIntelTab === 'radar' ? (
            attribution ? (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-5xl mx-auto">
                <div className="flex items-center gap-3 mb-6">
                  <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${attribution.sentiment === 'POSITIVE' || attribution.sentiment === 'BULLISH' ? 'bg-green-50 text-green-600 border-green-100' : 'bg-red-50 text-red-600 border-red-100'}`}>{attribution.sentiment} BIAS</span>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Impact Score: {attribution.impact_score}/100</span>
                </div>
                <h1 className="text-4xl font-black text-slate-900 leading-[1.1] mb-8 uppercase tracking-tighter">{attribution.headline}</h1>
                <div className="prose prose-slate max-w-none">
                  {attribution.narrative.split('\n\n').map((para, i) => <p key={i} className="text-slate-600 text-lg leading-relaxed mb-6 font-medium">{para}</p>)}
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center py-20 opacity-60">
                <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-6 border border-slate-100"><Zap className="w-8 h-8 text-slate-300" /></div>
                <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter mb-2">Causal Engine Standby</h3>
                <p className="text-slate-500 max-w-md text-sm font-medium">Intelligence synthesis is manual to optimize API consumption. Click 'Synthesize Intelligence' to run analysis on today's session.</p>
              </div>
            )
          ) : (
            stockAnalysis ? (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-5xl mx-auto">
                <div className="flex items-center gap-3 mb-6">
                  <span className="px-3 py-1 bg-indigo-600 text-white rounded-full text-[10px] font-black uppercase tracking-widest">{stockSymbol}</span>
                  <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${stockAnalysis.sentiment === 'POSITIVE' || stockAnalysis.sentiment === 'BULLISH' || stockAnalysis.sentiment === 'BUY' ? 'bg-green-50 text-green-600 border-green-100' : 'bg-red-50 text-red-600 border-red-100'}`}>{stockAnalysis.sentiment} BIAS</span>
                </div>
                <h1 className="text-4xl font-black text-slate-900 leading-[1.1] mb-8 uppercase tracking-tighter">FORENSIC AUDIT: {stockAnalysis.headline}</h1>
                <div className="prose prose-slate max-w-none mb-12">
                  {stockAnalysis.narrative.split('\n\n').map((para, i) => <p key={i} className="text-slate-600 text-lg leading-relaxed mb-6 font-medium">{para}</p>)}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                  <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Liquidity Profile</p>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center"><span className="text-xs font-bold text-slate-500">Spread %</span><span className={`text-sm font-black font-mono ${stockMetrics?.spread_pct && stockMetrics.spread_pct < 0.15 ? 'text-green-600' : 'text-amber-600'}`}>{stockMetrics?.spread_pct?.toFixed(3) || '--'}%</span></div>
                      <div className="flex justify-between items-center"><span className="text-xs font-bold text-slate-500">Depth Ratio</span><span className="text-sm font-black font-mono text-slate-900">{stockMetrics?.depth_ratio?.toFixed(2) || '--'}</span></div>
                      <div className="flex justify-between items-center"><span className="text-xs font-bold text-slate-500">Exec Style</span><span className="text-[10px] font-black text-indigo-600 uppercase">{stockMetrics?.execution_style || '--'}</span></div>
                    </div>
                  </div>
                  <div className="bg-indigo-50 p-6 rounded-3xl border border-indigo-100 md:col-span-2">
                    <div className="flex items-center gap-2 mb-4"><Info className="w-4 h-4 text-indigo-600" /><p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Swing Trading Recommendation (1D - 1M)</p></div>
                    <div className="flex items-start gap-6">
                      <div className={`text-3xl font-black uppercase tracking-tighter ${stockAnalysis.sentiment === 'BUY' || stockAnalysis.sentiment === 'POSITIVE' ? 'text-green-600' : 'text-red-600'}`}>{stockAnalysis.sentiment === 'BUY' || stockAnalysis.sentiment === 'POSITIVE' ? 'Accumulate' : 'Avoid/Sell'}</div>
                      <p className="text-sm font-medium text-slate-600 leading-relaxed">{stockAnalysis.swing_recommendation || `Based on current market volatility and ${stockSymbol}'s microstructure, the tactical outlook suggests ${stockAnalysis.sentiment.toLowerCase()} positioning.`}</p>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  {stockAnalysis.analyst_calls?.map((call, idx) => (
                    <div key={idx} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-all">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 truncate">{call.source}</p>
                      <div className={`text-xl font-black uppercase tracking-tighter ${call.rating.toUpperCase().includes('BUY') ? 'text-green-600' : 'text-slate-900'}`}>{call.rating}</div>
                      <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase">Target: <span className="text-indigo-600">₹{call.target}</span></p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center py-20 opacity-60">
                <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-6 border border-slate-100"><Search className="w-8 h-8 text-slate-300" /></div>
                <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter mb-2">Equity Audit Standby</h3>
                <p className="text-slate-500 max-w-md text-sm font-medium">Enter an NSE symbol and click 'Analyze' to perform a forensic audit and microstructure check.</p>
              </div>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default MonitorTab;
