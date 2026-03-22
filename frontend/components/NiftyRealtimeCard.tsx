import React from 'react';
import { MarketTelemetry, getMarketSessionStatus } from '../services/marketService';
import { TrendingUp, TrendingDown, Activity, AlertTriangle, WifiOff } from 'lucide-react';

interface NiftyRealtimeCardProps {
  telemetry: MarketTelemetry | null;
}

const formatVolume = (vol: number) => {
  if (!vol) return '—';
  return `${(vol / 1000000).toFixed(2)}M`;
};

export const NiftyRealtimeCard: React.FC<NiftyRealtimeCardProps> = ({ telemetry }) => {
  const isPositive = telemetry ? telemetry.change >= 0 : true;
  const sign = isPositive ? '+' : '';
  const marketOpen = getMarketSessionStatus().isOpen;

  const StatusBadge = () => {
    if (telemetry?.errorType === 'token') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-600 border border-amber-200">
          <AlertTriangle className="w-3 h-3" />
          Gateway Error
        </span>
      );
    }
    if (telemetry?.dataSource === 'Breeze Direct') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          Live Feed
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-500 border border-gray-200">
        <WifiOff className="w-3 h-3 animate-pulse" />
        Connecting…
      </span>
    );
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden h-full flex flex-col">
      {/* Colored top stripe */}
      <div className={`h-1 w-full ${telemetry ? (isPositive ? 'bg-emerald-500' : 'bg-rose-500') : 'bg-gray-200'}`} />

      <div className="flex flex-col flex-1 p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Index</p>
            <h2 className="text-lg font-bold text-gray-900 mt-0.5">NIFTY 50</h2>
          </div>
          <StatusBadge />
        </div>

        {/* Price */}
        {telemetry ? (
          <div className="flex-1 flex flex-col justify-center">
            <div className="mb-1">
              <span className="text-5xl font-light text-gray-900 tracking-tight tabular-nums">
                {telemetry.last_traded_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className={`flex items-center gap-1.5 mb-6 ${isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
              {isPositive
                ? <TrendingUp className="w-4 h-4" />
                : <TrendingDown className="w-4 h-4" />}
              <span className="text-base font-semibold tabular-nums">
                {sign}{telemetry.change.toFixed(2)}
              </span>
              <span className="text-sm font-medium opacity-80 tabular-nums">
                ({sign}{telemetry.percent_change.toFixed(2)}%)
              </span>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'High', value: telemetry.high > 0 ? telemetry.high.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—', color: 'text-emerald-600' },
                { label: 'Low', value: telemetry.low > 0 ? telemetry.low.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—', color: 'text-rose-600' },
                { label: 'Volume', value: formatVolume(telemetry.volume), color: 'text-gray-700' },
              ].map(stat => (
                <div key={stat.label} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{stat.label}</p>
                  <p className={`text-xs font-bold tabular-nums ${stat.color}`}>{stat.value}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
            <Activity className="w-10 h-10 text-gray-200 mb-3" />
            <p className="text-sm font-medium text-gray-400">
              {!marketOpen ? 'Market closed' : 'Waiting for live data…'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
