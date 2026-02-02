
export interface MarketLog {
  id: string;
  log_date: string;
  ltp: number;
  points_change: number;
  change_percent: number;
  day_high: number;
  day_low: number;
  volume: number;
  source: string;
  is_live: boolean;
  niftyClose: number;
  niftyChange: number;
  niftyChangePercent: number;
  date: string;
}

export interface NewsAttribution {
  headline: string;
  narrative: string;
  category: string;
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'BULLISH' | 'BEARISH' | 'BUY' | 'SELL' | 'HOLD';
  impact_score: number;
  sources?: { uri: string; title: string }[];
  affected_stocks: string[];
  affected_sectors: string[];
  analyst_calls?: { source: string; rating: string; target: string }[];
  swing_recommendation?: string;
}

export interface LiquidityMetrics {
  spread_pct: number | null;
  depth_ratio: number;
  vol_ratio: number | null;
  regime: 'BREAKOUT' | 'DISTRIBUTION' | 'NEUTRAL';
  execution_style: 'LIMIT ONLY' | 'OK FOR MARKET' | 'AVOID';
  bid: number;
  ask: number;
  bidQty: number;
  askQty: number;
  avg_vol_20d: number | null;
}

export interface ResearchTask {
  id: string;
  date: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  result?: string;
}

export type Reg30Source = 'XBRL' | 'CorpAction' | 'CreditRating' | 'RSS';
export type Reg30EventFamily = 
  | 'ORDER_CONTRACT' 
  | 'ORDER_PIPELINE' 
  | 'GOVERNANCE_MANAGEMENT' 
  | 'DILUTION_CAPITAL' 
  | 'SHAREHOLDER_RETURNS' 
  | 'CREDIT_RATING' 
  | 'LITIGATION_REGULATORY' 
  | 'OTHER';

export type Sentiment = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
export type ActionRecommendation = 'ACTIONABLE_BULLISH' | 'ACTIONABLE_BEARISH_RISK' | 'HIGH_PRIORITY_WATCH' | 'TRACK' | 'NEEDS_MANUAL_REVIEW' | 'IGNORE';

export interface EventCandidate {
  id: string;
  source: Reg30Source;
  event_date: string;
  symbol: string | null;
  company_name: string;
  category: string;
  raw_text: string;
  attachment_link?: string;
  attachment_text?: string;
  event_family?: Reg30EventFamily;
  link?: string;
}

export interface Reg30Report {
  id: string;
  event_date: string;
  symbol: string;
  company_name: string;
  source: Reg30Source;
  event_family: Reg30EventFamily;
  stage?: string;
  summary: string;
  impact_score: number;
  direction: Sentiment;
  confidence: number;
  recommendation: ActionRecommendation;
  link?: string;
  attachment_link?: string;
  attachment_text?: string;
  extracted_data?: any;
  evidence_spans?: string[];
  missing_fields?: string[];
  scoring_factors?: string[];
  raw_text?: string;
  order_value_cr?: number;
  event_analysis_text?: string;
  institutional_risk?: 'LOW' | 'MED' | 'HIGH';
  policy_bias?: 'TAILWIND' | 'HEADWIND' | 'NEUTRAL';
  policy_event?: string | null;
  tactical_plan?: 'BUY_DIP' | 'WAIT_CONFIRMATION' | 'MOMENTUM_OK' | 'AVOID_CHASE';
  trigger_text?: string;
  conversion_bonus?: number;
  execution_months?: number | null;
  order_type?: string;
  customer?: string;
}

export interface Reg30Analysis {
  summary: string;
  impact_score: number;
  recommendation: ActionRecommendation;
  confidence: number;
  missing_fields?: string[];
  evidence_spans?: string[];
  extracted_data?: any;
  extracted?: any;
}
