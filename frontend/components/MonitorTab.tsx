
import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from './ui/Card';
import { analyzeMarketRadar, analyzeStockDeepDive, fetchNiftyRealtime, fetchQuote, fetchDepth } from '../services/apiService';
import { getMarketSessionStatus } from '../services/marketService';
import { NewsAttribution, MarketLog, LiquidityMetrics } from '../types';
import { Activity, Search, Zap, Loader2, RefreshCw, Info, AlertCircle } from 'lucide-react';
import { PriorityStocksCard } from './PriorityStocksCard';

const MonitorTab: React.FC = () => {
  const [niftyData, setNiftyData] = useState<any>(null);
  const [isLoadingNifty, setIsLoadingNifty] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Intelligence Section State
  const [activeIntelTab, setActiveIntelTab] = useState<'radar' | 'deepdive'>('radar');
  const [attribution, setAttribution] = useState<NewsAttribution | null>(null);
  const [isAnalyzingMarket, setIsAnalyzingMarket] = useState(false);
  
  const [stockSymbol, setStockSymbol] = useState('');
  const [stockAnalysis, setStockAnalysis] = useState<NewsAttribution | null>(null);
  const [stockMetrics, setStockMetrics] = useState<LiquidityMetrics | null>(null);
  const [isAnalyzingStock, setIsAnalyzingStock] = useState(false);
  const [intelError, setIntelError] = useState<string | null>(null);

  const marketStatus = getMarketSessionStatus();

  const loadNiftyData = useCallback(async () => {
    const currentStatus = getMarketSessionStatus();
    if (!currentStatus.isOpen && niftyData) return;

    setIsLoadingNifty(true);
    try {
      const data = await fetchNiftyRealtime();
      setNiftyData(data);
      setLastUpdated(new Date());
      setError(null);
    } catch (e: any) {
      setError(e.message || "Feed Disconnected");
    } finally {
      setIsLoadingNifty(false);
    }
  }, [niftyData]);

  useEffect(() => {
    loadNiftyData();
    const interval = setInterval(loadNiftyData, 5000); // 5s refresh
    return () => clearInterval(interval);
  }, [loadNiftyData]);

  const handleMarketAnalysis = async () => {
    if (!niftyData) return;
    setIsAnalyzingMarket(true);
    setIntelError(null);
    const log: MarketLog = {
      id: `log-${Date.now()}`,
      log_date: new Date().toISOString().split('T')[0],
      ltp: parseFloat(niftyData.last_traded_price || 0),
      points_change: parseFloat(niftyData.change || 0),
      change_percent: parseFloat(niftyData.percent_change || 0),
      day_high: parseFloat(niftyData.high || 0),
      day_low: parseFloat(niftyData.low || 0),
      volume: parseFloat(niftyData.volume || 0),
      source: 'Breeze Direct',
      is_live: marketStatus.isOpen,
      niftyClose: parseFloat(niftyData.last_traded_price || 0),
      niftyChange: parseFloat(niftyData.change || 0),
      niftyChangePercent: parseFloat(niftyData.percent_change || 0),
      date: new Date().toISOString().split('T')[0]
    };
    try {
      const result = await analyzeMarketRadar(log);
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

      const bid = parseFloat(depth.best_bid_price || quote.best_bid_price || 0);
      const ask = parseFloat(depth.best_offer_price || quote.best_offer_price || 0);
      const mid = (bid + ask) / 2;
      const spread = mid > 0 ? ((ask - bid) / mid) * 100 : null;
      
      setStockMetrics({
        spread_pct: spread,
        depth_ratio: (parseFloat(depth.best_bid_quantity || 0) + 1) / (parseFloat(depth.best_offer_quantity || 0) + 1),
        vol_ratio: null,
        regime: 'NEUTRAL',
        execution_style: spread && spread < 0.15 ? 'OK FOR MARKET' : 'LIMIT ONLY',
        bid, ask, 
        bidQty: parseFloat(depth.best_bid_quantity || 0), 
        askQty: parseFloat(depth.best_offer_quantity || 0),
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
      {error && (
        <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-center gap-3 text-red-600 animate-in fade-in slide-in-from-top-2">
          <AlertCircle className="w-5 h-5" />
          <span className="text-xs font-bold uppercase tracking-widest">System Error: {error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Nifty Card */}
        <div className="lg:col-span-1 rounded-3xl bg-[#0a0a12] text-white shadow-2xl overflow-hidden relative border border-slate-800">
          <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
            <Activity className="w-32 h-32" />
          </div>
          <div className="p-8 relative z-10">
            <div className="flex justify-between items-start mb-8">
              <div className={`flex items-center space-x-2 border rounded-full px-3 py-1 ${
                marketStatus.isOpen ? 'bg-green-900/30 border-green-800/50' : 'bg-slate-800/30 border-slate-700/50'
              }`}>
                <span className="flex h-2 w-2 relative">
                  {marketStatus.isOpen && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-green-400"></span>
                  )}
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${
                    error ? 'bg-red-500' : (marketStatus.isOpen ? 'bg-green-500' : 'bg-slate-500')
                  }`}></span>
                </span>
                <span className={`text-[10px] font-bold tracking-widest uppercase ${
                  marketStatus.isOpen ? 'text-green-400' : 'text-slate-400'
                }`}>
                  {marketStatus.isOpen ? 'Real-Time Feed' : 'Ledger Standby'}
                </span>
              </div>
              <div className="text-[10px] text-slate-500 font-mono text-right">
                SOURCE<br/>
                <span className="text-indigo-400 font-bold uppercase tracking-widest">Breeze Direct</span>
              </div>
            </div>
            <h2 className="text-xl font-bold text-slate-200 mb-1 tracking-tight">NIFTY 50</h2>
            {niftyData ? (
              <>
                <div className="flex flex-col mb-10">
                  <span className="text-6xl font-light tracking-tighter text-white">
                    {parseFloat(niftyData.last_traded_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                  <div className="flex items-center mt-3 space-x-4">
                    <span className={`text-2xl font-bold ${parseFloat(niftyData.change || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {parseFloat(niftyData.change || 0) > 0 ? '+' : ''}{parseFloat(niftyData.change || 0).toFixed(2)}
                    </span>
                    <span className={`text-base font-medium px-2.5 py-0.5 rounded-lg ${parseFloat(niftyData.percent_change || 0) >= 0 ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
                      {parseFloat(niftyData.percent_change || 0).toFixed(2)}%
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-6 pt-6 border-t border-slate-800/50">
                  <div className="bg-slate-900/50 p-3 rounded-2xl border border-slate-800">
                    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Session H/L</p>
                    <p className="font-mono text-sm text-slate-300">{parseFloat(niftyData.high || 0).toLocaleString()} / {parseFloat(niftyData.low || 0).toLocaleString()}</p>
                  </div>
                  <div className="bg-slate-900/50 p-3 rounded-2xl border border-slate-800">
                    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Vol (M)</p>
                    <p className="font-mono text-sm text-slate-300">{(parseFloat(niftyData.volume || 0) / 1000000).toFixed(2)}M</p>
                  </div>
                </div>
                <div className="mt-6 text-[10px] text-slate-600 flex justify-between items-center font-mono uppercase tracking-wider">
                   <span>{marketStatus.isOpen ? 'Last Updated' : 'Last Known'}: {lastUpdated?.toLocaleTimeString()}</span>
                   {marketStatus.isOpen && (
                     <button onClick={loadNiftyData} disabled={isLoadingNifty} className="hover:text-white transition-colors">
                       <RefreshCw className={`w-3 h-3 ${isLoadingNifty ? 'animate-spin' : ''}`} />
                     </button>
                   )}
                </div>
              </>
            ) : (
              <div className="h-48 flex flex-col items-center justify-center text-slate-500">
                {isLoadingNifty ? <Loader2 className="w-10 h-10 animate-spin mb-4" /> : <span className="text-xs uppercase tracking-widest">No Data Available</span>}
              </div>
            )}
          </div>
        </div>

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
