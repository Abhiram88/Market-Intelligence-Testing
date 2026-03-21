import { BreezeQuote } from './breezeService';

export interface MarketTelemetry extends BreezeQuote {
  dataSource: 'Breeze Direct' | 'Cache';
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

  // Pre-market starts at 9:00 AM IST; market closes at 3:30 PM IST
  const isWeekday = day >= 1 && day <= 5;
  const isMarketHours = time >= 900 && time <= 1530;

  return {
    isOpen: isWeekday && isMarketHours,
    status: isWeekday && isMarketHours ? 'Live Trading Session' : 'Market Closed',
  };
};
