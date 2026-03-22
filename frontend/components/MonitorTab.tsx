
import React, { useState, useCallback } from 'react';
import { Card, CardContent } from './ui/Card';
import { summarizeMarketOutlook, analyzeStockDeepDive, fetchQuote, fetchDepth } from '../services/apiService';
import { getMarketSessionStatus, MarketTelemetry } from '../services/marketService';
import { normalizeBreezeQuoteFromRow } from '../services/breezeService';
import { NewsAttribution, MarketLog, LiquidityMetrics } from '../types';
import { Search, Zap, Loader2, Info, AlertCircle } from 'lucide-react';
import { PriorityStocksCard } from './PriorityStocksCard';
import { NiftyRealtimeCard } from './NiftyRealtimeCard';

const MonitorTab: React.FC = () => {
  const [activeIntelTab, setActiveIntelTab] = useState<'radar' | 'deepdive'>('radar');
  const [attribution, setAttribution] = useState<NewsAttribution | null>(null);
  const [isAnalyzingMarket, setIsAnalyzingMarket] = useState(false);

  const [stockSymbol, setStockSymbol] = useState('');
  const [stockAnalysis, setStockAnalysis] = useState<NewsAttribution | null>(null);
  const [stockMetrics, setStockMetrics] = useState<LiquidityMetrics | null>(null);
  const [isAnalyzingStock, setIsAnalyzingStock] = useState(false);
  const [intelError, setIntelError] = useState<string | null>(null);

  const [telemetry, setTelemetry] = useState<MarketTelemetry | null>(null);

  const marketStatus = getMarketSessionStatus();

  // Called by PriorityStocksCard when a NIFTY tick arrives on the shared socket.
  const onNiftyTick = useCallback((data: Record<string, unknown>) => {
    const normalized = normalizeBreezeQuoteFromRow(data, 'NIFTY');
    setTelemetry(prev => ({
      // Keep mandatory identity fields from the new tick.
      ...normalized,
      dataSource: 'Breeze Direct' as const,
      errorType: 'none',
      // Preserve the session high/low from previous ticks if the new tick delivers zeros.
      // Breeze WebSocket ticks include H/L only when they change, so a 0 means "no update".
      high: normalized.high !== 0 ? normalized.high : (prev?.high ?? 0),
      low:  normalized.low  !== 0 ? normalized.low  : (prev?.low  ?? 0),
      // Preserve previous_close if missing from the tick — needed for correct % change calc.
      previous_close: normalized.previous_close !== 0
        ? normalized.previous_close
        : (prev?.previous_close ?? 0),
    }));
  }, []);

  // Market Radar — works independently of Breeze session.
  // Uses Google Gemini + Google Search grounding, so no live Nifty data is required.
  const handleMarketAnalysis = async () => {
    setIsAnalyzingMarket(true);
    setIntelError(null);

    const today = new Date().toISOString().split('T')[0];
    // Pass whatever telemetry we have; the proxy handles null/zero values via Google Search.
    const log: MarketLog = {
      id: `log-${Date.now()}`,
      log_date: today,
      ltp: telemetry?.last_traded_price ?? 0,
      points_change: telemetry?.change ?? 0,
      change_percent: telemetry?.percent_change ?? 0,
      day_high: telemetry?.high ?? 0,
      day_low: telemetry?.low ?? 0,
      volume: telemetry?.volume ?? 0,
      source: telemetry?.dataSource ?? 'Google Search',
      is_live: marketStatus.isOpen,
      niftyClose: telemetry?.last_traded_price ?? 0,
      niftyChange: telemetry?.change ?? 0,
      niftyChangePercent: telemetry?.percent_change ?? 0,
      date: today,
    };

    try {
      const result = await summarizeMarketOutlook(log);
      setAttribution(result);
    } catch (e: any) {
      setIntelError(e.message || 'Failed to synthesize market intelligence.');
    } finally {
      setIsAnalyzingMarket(false);
    }
  };

  const handleStockAnalysis = async () => {
    const symbol = (stockSymbol || '').trim().toUpperCase();
    if (!symbol) return;
    setIsAnalyzingStock(true);
    setIntelError(null);
    setStockAnalysis(null);
    setStockMetrics(null);

    try {
      try {
        const [quote, depth] = await Promise.all([
          fetchQuote(symbol),
          fetchDepth(symbol)
        ]);
        const bid = depth.best_bid_price || quote.best_bid_price || 0;
        const ask = depth.best_offer_price || quote.best_offer_price || 0;
        const mid = (bid + ask) / 2;
        const spread = mid > 0 ? ((ask - bid) / mid) * 100 : null;
        const bidQty = depth.best_bid_quantity || 0;
        const askQty = depth.best_offer_quantity || 0;
        const spreadStatus = (() => {
          if (!spread || spread >= 0.50) return 'AVOID' as const;
          if (spread < 0.05) return 'EXCELLENT' as const;
          if (spread < 0.15) return 'GOOD' as const;
          if (spread < 0.30) return 'ACCEPTABLE' as const;
          return 'POOR' as const;
        })();
        setStockMetrics({
          spread_pct: spread,
          depth_ratio: (bidQty + 1) / (askQty + 1),
          vol_ratio: null,
          regime: 'NEUTRAL',
          execution_style: spread && spread < 0.15 ? 'OK FOR MARKET' : 'LIMIT ONLY',
          bid, ask, bidQty, askQty,
          avg_vol_20d: null,
          liquidity_quality_score: 50,
          liquidity_grade: 'C',
          is_tradeable: true,
          risk_level: 'MEDIUM',
          spread_status: spreadStatus,
          volume_status: 'NORMAL',
          depth_status: 'BALANCED',
          time_regime: 'NORMAL',
          execution_hint: spread && spread < 0.15 ? 'Good liquidity' : 'Use limit orders',
        });
      } catch (quoteErr: any) {
        setStockMetrics({
          spread_pct: null,
          depth_ratio: null,
          vol_ratio: null,
          regime: 'NEUTRAL',
          execution_style: 'MARKET CLOSED',
          bid: 0, ask: 0, bidQty: 0, askQty: 0,
          avg_vol_20d: null,
          liquidity_quality_score: 0,
          liquidity_grade: 'F',
          is_tradeable: false,
          risk_level: 'EXTREME',
          spread_status: 'AVOID',
          volume_status: 'LOW',
          depth_status: 'BALANCED',
          time_regime: 'AFTER_HOURS',
          execution_hint: 'Quote fetch failed',
        });
      }

      const result = await analyzeStockDeepDive(symbol);
      setStockAnalysis(result);
    } catch (e: any) {
      const msg = e?.message || 'Failed to perform deep dive.';
      setIntelError(msg);
    } finally {
      setIsAnalyzingStock(false);
    }
  };

  return (
    <div className="space-y-8 w-full">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <NiftyRealtimeCard telemetry={telemetry} />
        <div className="lg:col-span-2">
          {/* PriorityStocksCard manages the single shared socket for both NIFTY and watchlist stocks */}
          <PriorityStocksCard onNiftyTick={onNiftyTick} />
        </div>
      </div>

      {/* Unified Intelligence Container */}
      <Card className="rounded-2xl border-gray-200 shadow-sm overflow-hidden bg-white min-h-[400px] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row justify-between items-center gap-3">
          <div className="flex bg-gray-100 p-1 rounded-xl">
            <button onClick={() => setActiveIntelTab('radar')} className={`px-5 py-1.5 rounded-lg text-xs font-semibold transition-all ${activeIntelTab === 'radar' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Market Radar</button>
            <button onClick={() => setActiveIntelTab('deepdive')} className={`px-5 py-1.5 rounded-lg text-xs font-semibold transition-all ${activeIntelTab === 'deepdive' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Equity Deep Dive</button>
          </div>
          <div className="flex items-center gap-3">
            {activeIntelTab === 'deepdive' && (
              <input
                type="text"
                placeholder="NSE Symbol"
                value={stockSymbol}
                onChange={(e) => setStockSymbol(e.target.value.toUpperCase())}
                className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500 w-36"
              />
            )}
            <button
              onClick={activeIntelTab === 'radar' ? handleMarketAnalysis : handleStockAnalysis}
              disabled={isAnalyzingMarket || isAnalyzingStock || (activeIntelTab === 'deepdive' && !stockSymbol)}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm"
            >
              {(isAnalyzingMarket || isAnalyzingStock) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              {activeIntelTab === 'radar' ? (attribution ? 'Refresh' : 'Synthesize Intelligence') : 'Analyze'}
            </button>
          </div>
        </div>

        <CardContent className="flex-1 p-6">
          {intelError && (
            <div className="mb-6 p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm">{intelError}</span>
            </div>
          )}

          {activeIntelTab === 'radar' ? (
            attribution ? (
              <div className="max-w-4xl mx-auto">
                <div className="flex items-center gap-2.5 mb-5">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${attribution.sentiment === 'POSITIVE' || attribution.sentiment === 'BULLISH' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>{attribution.sentiment}</span>
                  <span className="text-xs text-gray-400">Impact: {attribution.impact_score}/100</span>
                </div>
                <h2 className="text-2xl font-bold text-gray-900 leading-snug mb-5">{attribution.headline}</h2>
                <div className="space-y-4">
                  {attribution.narrative.split('\n\n').map((para, i) => (
                    <p key={i} className="text-gray-600 text-sm leading-relaxed">{para}</p>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center py-16">
                <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mb-4 border border-gray-100">
                  <Zap className="w-7 h-7 text-gray-300" />
                </div>
                <h3 className="text-base font-semibold text-gray-700 mb-2">Market Intelligence Standby</h3>
                <p className="text-gray-400 max-w-sm text-sm">Synthesis is manual to optimize API usage. Click 'Synthesize Intelligence' to run analysis on today's session.</p>
              </div>
            )
          ) : (
            stockAnalysis ? (
              <div className="max-w-4xl mx-auto">
                <div className="flex items-center gap-2.5 mb-5">
                  <span className="px-2.5 py-1 bg-indigo-600 text-white rounded-full text-xs font-semibold">{stockSymbol}</span>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${stockAnalysis.sentiment === 'POSITIVE' || stockAnalysis.sentiment === 'BULLISH' || stockAnalysis.sentiment === 'BUY' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>{stockAnalysis.sentiment}</span>
                </div>
                <h2 className="text-2xl font-bold text-gray-900 leading-snug mb-5">{stockAnalysis.headline}</h2>
                <div className="space-y-4 mb-8">
                  {(typeof stockAnalysis.narrative === 'string' ? stockAnalysis.narrative : '').split('\n\n').filter(Boolean).map((para, i) => (
                    <p key={i} className="text-gray-600 text-sm leading-relaxed">{para}</p>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Liquidity Profile</p>
                    <div className="space-y-2.5">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-gray-500">Spread %</span>
                        <span className={`text-sm font-semibold font-mono ${stockMetrics?.spread_pct && stockMetrics.spread_pct < 0.15 ? 'text-emerald-600' : 'text-amber-600'}`}>{stockMetrics?.spread_pct?.toFixed(3) || '--'}%</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-gray-500">Depth Ratio</span>
                        <span className="text-sm font-semibold font-mono text-gray-900">{stockMetrics?.depth_ratio?.toFixed(2) || '--'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-gray-500">Exec Style</span>
                        <span className="text-xs font-semibold text-indigo-600">{stockMetrics?.execution_style || '--'}</span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100 md:col-span-2">
                    <div className="flex items-center gap-2 mb-3">
                      <Info className="w-3.5 h-3.5 text-indigo-600" />
                      <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">Swing Recommendation (1D–1M)</p>
                    </div>
                    <div className="flex items-start gap-4">
                      <div className={`text-xl font-bold ${stockAnalysis.sentiment === 'BUY' || stockAnalysis.sentiment === 'POSITIVE' ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {stockAnalysis.sentiment === 'BUY' || stockAnalysis.sentiment === 'POSITIVE' ? 'Accumulate' : 'Avoid / Sell'}
                      </div>
                      <p className="text-sm text-gray-600 leading-relaxed">
                        {typeof stockAnalysis.swing_recommendation === 'string' && stockAnalysis.swing_recommendation && !stockAnalysis.swing_recommendation.startsWith('[')
                          ? stockAnalysis.swing_recommendation
                          : `Based on current market conditions and ${stockSymbol}'s microstructure, the tactical outlook suggests ${stockAnalysis.sentiment.toLowerCase()} positioning.`}
                      </p>
                    </div>
                  </div>
                </div>
                {(stockAnalysis.analyst_calls || []).length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {(stockAnalysis.analyst_calls || []).map((call, idx) => {
                      const source = typeof call.source === 'string' ? call.source : String(call.source ?? '');
                      const rating = typeof call.rating === 'string' ? call.rating : String(call.rating ?? '');
                      const target = typeof call.target === 'string' ? call.target : String(call.target ?? '');
                      const duration = call.duration && typeof call.duration === 'string' ? call.duration : '';
                      return (
                        <div key={idx} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                          <p className="text-xs text-gray-400 mb-2 truncate">{source}</p>
                          <div className={`text-base font-bold ${rating.toUpperCase().includes('BUY') ? 'text-emerald-600' : 'text-gray-900'}`}>{rating}</div>
                          <p className="text-xs text-gray-400 mt-1">Target: <span className="text-indigo-600 font-medium">₹{target}</span></p>
                          {duration && <p className="text-xs text-gray-400 mt-0.5">Horizon: <span className="text-gray-600">{duration}</span></p>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center py-16">
                <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mb-4 border border-gray-100">
                  <Search className="w-7 h-7 text-gray-300" />
                </div>
                <h3 className="text-base font-semibold text-gray-700 mb-2">Equity Deep Dive</h3>
                <p className="text-gray-400 max-w-sm text-sm">Enter an NSE symbol and click 'Analyze' to run a forensic audit and microstructure check.</p>
              </div>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default MonitorTab;
