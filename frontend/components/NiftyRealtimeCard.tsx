
import React from 'react';
import { MarketTelemetry, getMarketSessionStatus } from '../services/marketService';
import { Activity, Zap, AlertTriangle } from 'lucide-react';

interface NiftyRealtimeCardProps {
  telemetry: MarketTelemetry | null;
  isLoading: boolean;
}

const formatVolume = (vol: number) => {
  if (!vol) return '--';
  return `${(vol / 1000000).toFixed(2)}M`;
};

export const NiftyRealtimeCard: React.FC<NiftyRealtimeCardProps> = ({ telemetry, isLoading }) => {
  

  const isPositive = telemetry ? telemetry.change >= 0 : false;

  const trendGlowClass = (() => {
    if (!telemetry || !getMarketSessionStatus().isOpen) return '';
    if (isPositive) return 'shadow-[0_0_30px_5px_rgba(34,197,94,0.3)]';
    return 'shadow-[0_0_30px_5px_rgba(239,68,68,0.3)]';
  })();

  const getStatusIndicator = () => {
    if (telemetry?.errorType === 'token') {
      return (
        <div className="flex items-center space-x-2 border rounded-full px-3 py-1 bg-amber-900/30 border-amber-800/50">
          <AlertTriangle className="w-3 h-3 text-amber-400" />
          <span className="text-[10px] font-bold tracking-widest uppercase text-amber-400">GATEWAY ERROR</span>
        </div>
      );
    }
    if (telemetry?.dataSource === 'Breeze Direct') {
        return (
            <div className="flex items-center space-x-2 border rounded-full px-3 py-1 bg-green-900/30 border-green-800/50">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-green-400"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              <span className="text-[10px] font-bold tracking-widest uppercase text-green-400">REAL-TIME FEED</span>
            </div>
        );
    }
    if (telemetry?.dataSource === 'Cache' || telemetry?.dataSource === 'Offline') {
      return (
        <div className="flex items-center space-x-2 border rounded-full px-3 py-1 bg-slate-800/30 border-slate-700/50">
            <span className="flex h-2 w-2 relative">
                <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-500"></span>
            </span>
            <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400">OFFLINE</span>
        </div>
      )
    }

    return (
        <div className="flex items-center space-x-2 border rounded-full px-3 py-1 bg-slate-800/30 border-slate-700/50">
          <Zap className="w-3 h-3 text-slate-400 animate-pulse" />
          <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400">ESTABLISHING LINK</span>
        </div>
    );
  };

  return (
    <div className={`lg:col-span-1 rounded-3xl bg-[#0a0a12] text-white shadow-2xl overflow-hidden relative border border-slate-800 transition-shadow duration-500 ${trendGlowClass}`}>
      <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
        <Activity className="w-32 h-32" />
      </div>
      <div className="p-8 relative z-10">
        <div className="flex justify-between items-start mb-8">
          {getStatusIndicator()}
          <div className="text-[10px] text-slate-500 font-mono text-right">
            SOURCE<br/>
            <span className="text-indigo-400 font-bold uppercase tracking-widest">{telemetry?.dataSource || '--'}</span>
          </div>
        </div>
        <h2 className="text-xl font-bold text-slate-200 mb-1 tracking-tight">NIFTY 50</h2>
        {telemetry ? (
          <>
            <div className="flex flex-col mb-10">
              <span className="text-6xl font-light tracking-tighter text-white">
                {telemetry.last_traded_price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
              <div className="flex items-center mt-3 space-x-4">
                <span className={`text-2xl font-bold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                  {isPositive ? '+' : ''}{telemetry.change.toFixed(2)}
                </span>
                <span className={`text-base font-medium px-2.5 py-0.5 rounded-lg ${isPositive ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
                  {telemetry.percent_change.toFixed(2)}%
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-6 pt-6 border-t border-slate-800/50">
              <div className="bg-slate-900/50 p-3 rounded-2xl border border-slate-800">
                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Session H/L</p>
                <p className="font-mono text-sm text-slate-300">{telemetry.high.toLocaleString()} / {telemetry.low.toLocaleString()}</p>
              </div>
              <div className="bg-slate-900/50 p-3 rounded-2xl border border-slate-800">
                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Vol (M)</p>
                <p className="font-mono text-sm text-slate-300">{formatVolume(telemetry.volume)}</p>
              </div>
            </div>
          </>
        ) : (
          <div className="h-48 flex items-center justify-center text-slate-500">
            <p>{isLoading ? 'Loading...' : 'No data available'}</p>
          </div>
        )}
      </div>
    </div>
  );
};
