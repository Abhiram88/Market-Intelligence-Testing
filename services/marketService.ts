
export const getMarketSessionStatus = () => {
  const now = new Date();
  // Convert to IST (UTC+5:30)
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffset);
  
  const day = istDate.getUTCDay();
  const hours = istDate.getUTCHours();
  const minutes = istDate.getUTCMinutes();
  const time = hours * 100 + minutes;

  // NSE Market Hours: 9:00 AM (Pre-market) to 3:30 PM IST
  const isWeekday = day >= 1 && day <= 5;
  const isMarketHours = time >= 900 && time <= 1530;

  return {
    isOpen: isWeekday && isMarketHours,
    status: isWeekday && isMarketHours ? 'Live Trading Session' : 'Market Closed',
    isPreMarket: time >= 900 && time < 915
  };
};
