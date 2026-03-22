import { 
  EventCandidate, 
  Reg30Report, 
  Reg30Source, 
  Reg30EventFamily, 
  Sentiment, 
  ActionRecommendation,
  Reg30Analysis
} from "../types";
import { analyzeReg30Event, analyzeEventNarrative } from "./reg30GeminiService";
import { supabase } from "../lib/supabase";

/** Call proxy to generate elaborate tactical narrative (no API key in frontend). */
async function analyzeEventNarrativeViaProxy(inputs: {
  symbol: string;
  company_name?: string;
  event_family: string;
  stage?: string;
  order_value_cr?: number;
  customer?: string;
  summary?: string;
  impact_score: number;
  institutional_risk?: string;
  policy_bias?: string;
  tactical_plan?: string;
  trigger_text?: string;
}): Promise<{ event_analysis_text: string; tone: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(resolveBreezeUrl('/api/gemini/reg30-narrative'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inputs),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && typeof data.event_analysis_text === 'string') return data;
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Call proxy to run Reg30 Gemini analysis (no API key needed in frontend).
 *  Proxy now handles PDF fetching, extraction, validation, and scoring server-side
 *  (ported from Bulk_reg30_processor.py). Frontend just sends the PDF URL + metadata. */
async function analyzeReg30EventViaProxy(candidate: EventCandidate): Promise<Reg30Analysis | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch(resolveBreezeUrl('/api/gemini/reg30-analyze'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidate: {
          company_name:    candidate.company_name,
          symbol:          candidate.symbol,
          source:          candidate.source,
          raw_text:        candidate.raw_text,        // StockInsights summary — fallback if PDF fails
          attachment_link: candidate.attachment_link, // proxy fetches PDF bytes directly
          source_link:     candidate.link,
          event_date:      candidate.event_date,
          published_date:  candidate.event_date,
        },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || res.statusText);
    }
    const data = await res.json();
    if (!data || typeof data.summary !== 'string') return null;
    const extracted = data.extracted && typeof data.extracted === 'object' ? data.extracted : {};
    return {
      summary:       data.summary,
      // Proxy returns full scoring when _proxy_scored=true
      impact_score:  typeof data.impact_score === 'number' ? data.impact_score : 0,
      recommendation: (data.action_recommendation || data.recommendation || 'TRACK') as Reg30Analysis['recommendation'],
      confidence:    typeof data.confidence === 'number' ? data.confidence : 0,
      missing_fields: Array.isArray(data.missing_fields) ? data.missing_fields : [],
      evidence_spans: Array.isArray(data.evidence_spans) ? data.evidence_spans : [],
      extracted,
      // Extra proxy-computed fields used directly in the pipeline
      _proxy_scored:         data._proxy_scored === true,
      _event_family:         data.event_family,
      _direction:            data.direction,
      _scoring_factors:      data.scoring_factors,
      _conversion_bonus:     data.conversion_bonus,
      _execution_months:     data.execution_months,
      _order_type:           data.order_type,
      _event_date:           data.event_date,
      _event_datetime:       data.event_datetime,
      _validation_issues:    data._validation_issues,
      _resolved_symbol:      data.symbol,
      _resolved_company:     data.company_name,
    } as Reg30Analysis & Record<string, any>;
  } catch (e) {
    console.error('Reg30 proxy analysis failed:', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * PROXY RESOLUTION
 */
const DEFAULT_BREEZE_PROXY = "https://maia-breeze-proxy-service-919207294606.us-central1.run.app";

const resolveBreezeUrl = (endpoint: string) => {
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  let base = localStorage.getItem('breeze_proxy_url') || DEFAULT_BREEZE_PROXY;
  base = base.trim().replace(/\/$/, "");
  if (!base.startsWith('http')) base = `https://${base}`;
  return `${base}${path}`;
};

/**
 * UTILS
 */
const s = (v: any) => (v === null || v === undefined ? "" : String(v)).trim();
const lower = (v: any) => s(v).toLowerCase();

const getStringHash = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
};

/**
 * CLIENT-SIDE IXBRL TEXT HELPERS
 * These run in the browser on the raw text returned by /api/attachment/parse.
 * They act as a fallback when the proxy server's iXBRL stripping or Gemini extraction
 * misses the symbol/company (e.g. because the ix:header metadata prefix is still present
 * and pushes the "General Information" table past the 30k-char Gemini window).
 */

/**
 * Strip XBRL metadata prefix from plain text.
 * When the proxy hasn't stripped <ix:header>/<ix:hidden> server-side, the extracted plain text
 * begins with a large block of XBRL context/unit definitions before the actual filing content.
 * We detect this by finding the first recognisable NSE filing label and discard everything before it.
 */
const cleanAttachmentText = (text: string): string => {
  if (!text || text.length < 500) return text;
  const CONTENT_MARKERS = [
    /NSE\s+Symbol/i,
    /Name\s+of\s+the\s+Company/i,
    /SECURITIES\s+AND\s+EXCHANGE\s+BOARD/i,
    /General\s+Information/i,
  ];
  let earliest = -1;
  for (const marker of CONTENT_MARKERS) {
    const idx = text.search(marker);
    if (idx !== -1 && (earliest === -1 || idx < earliest)) earliest = idx;
  }
  // Only trim when the marker is well past the start — indicating a metadata prefix is present.
  return earliest > 1000 ? text.substring(earliest) : text;
};

/** Search the full attachment text for "NSE Symbol * VALUE" and return the symbol. */
const extractNseSymbolFromText = (text: string): string => {
  if (!text) return '';
  const m = text.match(/NSE\s+Symbol\s*\*?\s*[:\s|]+([A-Z][A-Z0-9]{1,19})/i);
  return m ? m[1].trim().toUpperCase() : '';
};

/** Search the full attachment text for "Name of the Company * VALUE" and return the name.
 *
 * The proxy's /api/attachment/parse endpoint strips all HTML tags and collapses whitespace
 * to a single space, producing one long line with NO newlines or pipe characters:
 *   "...Name of the Company* Niraj Cement Structurals Limited BSE Scrip Code* 532986..."
 *
 * The original regex used (?:\s*[\n|]|$) as a terminator which never matched because:
 *   (a) there are no \n or | separators in the space-collapsed text, and
 *   (b) $ (end of text) is thousands of chars away — beyond the {3,100} capture limit.
 *
 * Fix: use a lookahead on the known field labels that immediately follow in the NSE form
 * (BSE Scrip Code, MSEI Symbol, ISIN, Date of, etc.) so the regex stops at the right place.
 * Separator changed from [:\s|]+ to [:\s|]* (zero-or-more) because \s* before \*? may
 * already consume the only space between the asterisk and the company name value.
 *
 * The lookahead also includes 'Name of the Company' itself — intentionally — so that if
 * the same field label appears again in a different table section the capture stops there
 * rather than running into the next occurrence.
 */
// Fields that always immediately follow "Name of the Company*" in the NSE General Information
// table, plus structural separators for pipe/newline-delimited document variants.
const COMPANY_NAME_LOOKAHEAD =
  /(?:BSE|MSEI|ISIN\b|CIN\b|Compliance|SEBI|Registered|Date\s+of|Whether|Regulation|NSE\s+Symbol|Type\s+of|Time\s+of|Remarks|Name\s+of\s+the\s+Company|[\n|])/;

const extractCompanyNameFromText = (text: string): string => {
  if (!text) return '';
  const m = text.match(
    new RegExp(
      `Name\\s+of\\s+the\\s+Company\\s*\\*?\\s*[:\\s|]*([^\\n|]{3,100}?)(?=\\s*${COMPANY_NAME_LOOKAHEAD.source}|$)`,
      'im'
    )
  );
  if (!m) return '';
  const name = m[1].trim().replace(/\s+/g, ' ');
  return ['N/A', 'NA', 'NOT LISTED', 'NIL', 'UNKNOWN'].includes(name.toUpperCase()) ? '' : name;
};

/** Normalise a symbol value: treat 'N/A'/null/'' as absent (returns ''). */
const normalizeSymbol = (v: string | null | undefined): string =>
  (!v || v === 'N/A') ? '' : v.trim();

/** Normalise a company name: treat 'Unknown'/null/'' as absent (returns ''). */
const normalizeCompany = (v: string | null | undefined): string =>
  (!v || v === 'Unknown') ? '' : v.trim();


/** StockInsights PDFs are image-scanned (binary JPX); pypdf returns empty text. Skip parse entirely. */
const isImagePdfUrl = (url: string) =>
  url.includes('stockinsights-ai.s3') || url.includes('stockinsights-ai.s3.amazonaws.com');

export const fetchAttachmentText = async (url: string): Promise<string> => {
  if (!url || isImagePdfUrl(url)) return "";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const parserEndpoint = resolveBreezeUrl('/api/attachment/parse');
    const response = await fetch(parserEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: ctrl.signal,
    });
    if (!response.ok) return "";
    const data = await response.json();
    return data.text || "";
  } catch (err) {
    return "";
  } finally {
    clearTimeout(timer);
  }
};

const inferExecutionMonths = (eventDate: string, endDate: string | null): number | null => {
  if (!eventDate || !endDate) return null;
  try {
    const start = new Date(eventDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.round(diffDays / 30.44); // Approx months
  } catch (e) {
    return null;
  }
};

const calculateScoreAndRecommendation = (
  family: Reg30EventFamily,
  extracted: any,
  confidence: number,
  eventDate: string
): {
  impact_score: number;
  direction: Sentiment;
  recommendation: ActionRecommendation;
  factors: string[];
  conversion_bonus: number;
  final_execution_months: number | null;
  order_type: string;
} => {
  let impact_score = 0;
  let direction: Sentiment = 'NEUTRAL';
  const factors: string[] = [];
  let conversion_bonus = 0;
  let final_execution_months: number | null =
    extracted.execution_months ||
    (extracted.execution_years ? extracted.execution_years * 12 : null);
  const order_type = (extracted.order_type || 'UNKNOWN').toUpperCase();

  const addFactor = (pts: number, msg: string) => {
    impact_score += pts;
    factors.push(`${pts >= 0 ? '+' : ''}${pts}: ${msg}`);
  };

  switch (family) {
    case 'ORDER_CONTRACT':
    case 'ORDER_PIPELINE': {
      direction = 'POSITIVE';
      addFactor(
        family === 'ORDER_CONTRACT' ? 20 : 15,
        `Base weight for ${family.replace('_', ' ')}`
      );

      const orderCr = extracted.order_value_cr;
      const marketCapCr = extracted.market_cap_cr;
      if (orderCr != null && orderCr > 0) {
        if (marketCapCr != null && marketCapCr > 0) {
          const ratio = orderCr / marketCapCr;
          const ratioBonus =
            ratio >= 0.15 ? 25 :
            ratio >= 0.08 ? 18 :
            ratio >= 0.03 ? 12 :
            ratio >= 0.01 ? 6 : 2;
          addFactor(ratioBonus, `Order vs market cap ${(ratio * 100).toFixed(2)}% (₹${orderCr} Cr / ₹${marketCapCr} Cr)`);
        } else {
          const absoluteBonus =
            orderCr >= 1000 ? 30 :
            orderCr >= 500  ? 20 :
            orderCr >= 100  ? 10 : 5;
          addFactor(absoluteBonus, `Value bonus (₹${orderCr} Cr)`);
        }
      } else {
        addFactor(-10, 'Order value missing');
      }

      // FIX: WO → 20 (was 18), NTP → 18 (was 15); WO can now reach ACTIONABLE_BULLISH (max 75)
      const stageBonus: Record<string, number> = { LOA: 20, WO: 20, NTP: 18, L1: 12 };
      addFactor(
        stageBonus[extracted.stage] ?? 5,
        `Stage: ${extracted.stage || 'General'}`
      );

      // Resolve execution months — prefer construction_period_months for HAM contracts
      const contractMode = (extracted.contract_mode || '').toUpperCase();
      if (contractMode === 'HAM') {
        final_execution_months =
          extracted.construction_period_months || extracted.execution_months || null;
      }
      if (final_execution_months === null) {
        final_execution_months =
          extracted.execution_months ||
          (extracted.execution_years ? extracted.execution_years * 12 : null);
      }
      if (final_execution_months === null && extracted.end_date) {
        final_execution_months = inferExecutionMonths(eventDate, extracted.end_date);
      }

      if (final_execution_months !== null) {
        const em = Math.floor(final_execution_months);
        conversion_bonus =
          em <= 6  ? 10 :
          em <= 12 ? 6  :
          em <= 24 ? 2  : 0;
        // FIX: type adjustment only fires when execution duration is known
        if (order_type === 'SUPPLY')    conversion_bonus += 2;
        else if (order_type === 'SERVICES') conversion_bonus += 1;
        conversion_bonus = Math.min(conversion_bonus, 10);
        if (conversion_bonus > 0) {
          addFactor(conversion_bonus, `Conversion bonus (~${em}m, ${order_type})`);
        }
      }

      // Subsidiary discount
      if (extracted.is_subsidiary_win) {
        addFactor(-8, `Subsidiary win (${extracted.subsidiary_name || 'WOS'})`);
      }
      break;
    }
    case 'CREDIT_RATING': {
      const action = (extracted.rating_action || '').toLowerCase();
      const isUpgrade = action.includes('upgrade');
      const isDowngrade = action.includes('downgrade');
      direction = isUpgrade ? 'POSITIVE' : (isDowngrade ? 'NEGATIVE' : 'NEUTRAL');
      addFactor(
        isUpgrade ? 40 : (isDowngrade ? 50 : 10),
        `Rating: ${extracted.rating_action || 'Review'}`
      );
      break;
    }
    case 'LITIGATION_REGULATORY':
      direction = 'NEGATIVE';
      addFactor(40, 'Litigation risk');
      break;
    default:
      addFactor(10, `Standard event: ${family}`);
  }

  impact_score = Math.min(Math.max(impact_score, 0), 100);

  // FIX: validation issues + low confidence → NEEDS_MANUAL_REVIEW
  const hasValidationIssues = Array.isArray(extracted?._validation_issues) &&
    extracted._validation_issues.length > 0;
  let recommendation: ActionRecommendation = 'TRACK';
  if ((hasValidationIssues && confidence < 0.7) || confidence < 0.65) {
    recommendation = 'NEEDS_MANUAL_REVIEW';
  } else if (impact_score >= 75) {
    recommendation = direction === 'POSITIVE' ? 'ACTIONABLE_BULLISH' : 'ACTIONABLE_BEARISH_RISK';
  } else if (impact_score >= 55) {
    recommendation = 'HIGH_PRIORITY_WATCH';
  }

  return { impact_score, direction, recommendation, factors, conversion_bonus, final_execution_months, order_type };
};

const getDeterministicAnalysis = (report: Partial<Reg30Report>) => {
  const ext = report.extracted_data || {};
  const stage = ext.stage;
  const cond = ext.conditionality;
  const months = ext.execution_months || (ext.execution_years ? ext.execution_years * 12 : null);
  const customer = lower(ext.customer || "");
  const impact = report.impact_score || 0;

  let risk: 'LOW' | 'MED' | 'HIGH' = 'LOW';
  if (stage === 'L1' || cond === 'HIGH') risk = 'HIGH';
  else if ((months && months > 36) || stage === 'OTHER') risk = 'MED';
  else if (['LOA', 'WO', 'NTP'].includes(stage || "") && cond !== 'HIGH') risk = 'LOW';

  const isGovtSecure = /cpwd|nhai|metro|railways|govt|ministry/.test(customer);
  if (isGovtSecure) {
    if (risk === 'HIGH') risk = 'MED';
    else if (risk === 'MED') risk = 'LOW';
  }

  let pBias: 'TAILWIND' | 'HEADWIND' | 'NEUTRAL' = 'NEUTRAL';
  let pEvent: string | null = null;
  const evDate = new Date(report.event_date || "");
  const month = evDate.getMonth();
  const day = evDate.getDate();
  const isBudgetWindow = (month === 0 && day >= 15) || (month === 1 && day <= 15);
  const summary = lower(report.summary || "");
  const isInfraSector = /infra|epc|construction|building|road|bridge|power|hydro|railway|water/.test(summary);
  
  if (isInfraSector && isBudgetWindow) {
    pBias = 'TAILWIND';
    pEvent = "Union Budget capex focus";
  }

  let tPlan: 'BUY_DIP' | 'WAIT_CONFIRMATION' | 'MOMENTUM_OK' | 'AVOID_CHASE' = 'MOMENTUM_OK';
  if (stage === 'L1') tPlan = 'WAIT_CONFIRMATION';
  else if (risk === 'HIGH') tPlan = 'AVOID_CHASE';
  else if (impact >= 75) tPlan = 'BUY_DIP';
  else tPlan = 'MOMENTUM_OK';

  const triggers = {
    BUY_DIP: "Prefer pullback entry; watch VWAP reclaim / retest of D0 low.",
    WAIT_CONFIRMATION: "Wait for LOA/WO/NTP confirmation before entry.",
    AVOID_CHASE: "High shakeout risk; avoid chasing gaps; wait 1–3 sessions.",
    MOMENTUM_OK: "OK to watch breakout confirmation; avoid thin volume."
  };

  return {
    institutional_risk: risk,
    policy_bias: pBias,
    policy_event: pEvent,
    tactical_plan: tPlan,
    trigger_text: triggers[tPlan],
    execution_realism: months ? (months <= 12 ? "fast-cycle" : months <= 24 ? "normal-cycle" : months <= 36 ? "slow-cycle" : "very long-cycle") : "duration unknown"
  };
};

/** Map a raw Supabase analyzed_events row to a typed Reg30Report. Used by both
 *  fetchAnalyzedEvents and runReg30Analysis so that rows added to component state
 *  immediately after an upsert have the same field names as rows fetched later. */
const mapDbRowToReport = (item: any): Reg30Report => ({
  id: item.id,
  event_date: item.event_date || '',
  symbol: item.symbol || 'N/A',
  company_name: item.company_name || 'Unknown',
  source: (item.source as Reg30Source) || 'XBRL',
  event_family: (item.event_family as Reg30EventFamily) || 'OTHER',
  stage: item.stage || '',
  summary: item.summary || '',
  impact_score: item.impact_score || 0,
  direction: (item.direction as Sentiment) || 'NEUTRAL',
  confidence: item.confidence || 0,
  recommendation: (item.action_recommendation as ActionRecommendation) || 'TRACK',
  link: item.source_link || '',
  attachment_link: item.attachment_link || '',
  attachment_text: item.attachment_text || '',
  extracted_data: item.extracted_json || {},
  evidence_spans: item.evidence_spans || [],
  missing_fields: item.missing_fields || [],
  scoring_factors: item.scoring_factors || [],
  raw_text: item.summary || '',
  order_value_cr: item.extracted_json?.order_value_cr || 0,
  market_cap_cr: item.market_cap_cr || null,
  order_type: item.order_type || item.extracted_json?.order_type || null,
  event_analysis_text: item.event_analysis_text || '',
  institutional_risk: item.institutional_risk || 'LOW',
  policy_bias: item.policy_bias || 'NEUTRAL',
  policy_event: item.policy_event || null,
  tactical_plan: item.tactical_plan || 'MOMENTUM_OK',
  trigger_text: item.trigger_text || ''
});

export const fetchAnalyzedEvents = async (limit = 1000): Promise<Reg30Report[]> => {
  try {
    const { data, error } = await supabase
      .from('analyzed_events')
      .select('*')
      .order('event_date', { ascending: false })
      .limit(limit);
    
    if (error) return [];
    return (data || []).map(mapDbRowToReport);
  } catch (e) {
    return [];
  }
};

export const runReg30Analysis = async (
  candidates: EventCandidate[], 
  onRowProgress: (id: string, step: 'FETCHING' | 'AI_ANALYZING' | 'SAVING' | 'COMPLETED' | 'FAILED') => void
): Promise<Reg30Report[]> => {
  const reports: Reg30Report[] = [];
  
  const delayMs = 800;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (i > 0) await new Promise(r => setTimeout(r, delayMs));
    try {
      onRowProgress(c.id, 'AI_ANALYZING');

      // Proxy now handles PDF fetching + Gemini extraction + validation + scoring server-side.
      // We just send the candidate with attachment_link; no local fetchAttachmentText needed.
      const cacheKey = getStringHash(`v4|${c.company_name}|${c.attachment_link || c.id}`);
      let aiResult: any = null;
      try {
        const { data: cached } = await supabase.from('gemini_cache').select('response_json').eq('cache_key', cacheKey).maybeSingle();
        aiResult = cached?.response_json;
      } catch (e) {}

      if (!aiResult) {
        try {
          aiResult = await analyzeReg30EventViaProxy(c);
        } catch (_) {
          aiResult = null;
        }
        if (aiResult) {
          try {
            await supabase.from('gemini_cache').upsert({ cache_key: cacheKey, response_json: aiResult });
          } catch (e) {}
        }
      }

      if (aiResult) {
        onRowProgress(c.id, 'SAVING');
        const ext = aiResult.extracted || {};

        // Use proxy-resolved symbol/company/date when available (_proxy_scored=true)
        const resolvedSymbol  = (aiResult._resolved_symbol  || ext.nse_symbol || ext.symbol || normalizeSymbol(c.symbol) || '').toUpperCase();
        const resolvedCompany = normalizeCompany(aiResult._resolved_company || ext.company_name || c.company_name) || 'Unknown';
        const resolvedEventDate = aiResult._event_date || c.event_date;

        // Use proxy scoring if available; fall back to local calculateScoreAndRecommendation
        const familyForScoring = (aiResult._event_family || (
          c.event_family === 'OTHER' && (ext.order_value_cr != null || ['LOA','WO','NTP','L1'].includes(ext.stage || ''))
            ? 'ORDER_CONTRACT' : c.event_family
        )) as Reg30EventFamily;

        const scoring = aiResult._proxy_scored ? {
          impact_score:       aiResult.impact_score || 0,
          direction:          aiResult._direction   || 'NEUTRAL',
          recommendation:     aiResult.recommendation as ActionRecommendation || 'TRACK',
          factors:            aiResult._scoring_factors || [],
          conversion_bonus:   aiResult._conversion_bonus || 0,
          final_execution_months: aiResult._execution_months ?? null,
          order_type:         aiResult._order_type || null,
        } : calculateScoreAndRecommendation(familyForScoring, ext, aiResult.confidence, resolvedEventDate);

        let analysisPayload: any = {};
        if (scoring.impact_score >= 50) {
          const det = getDeterministicAnalysis({
            event_date:     resolvedEventDate,
            summary:        aiResult.summary,
            impact_score:   scoring.impact_score,
            extracted_data: ext,
          });
          const narrativeCacheKey = getStringHash(`narrative_v3|${resolvedSymbol}|${resolvedCompany}|${resolvedEventDate}|${det.tactical_plan}|${c.attachment_link || c.id}`);
          let narrativeData: any = null;
          try {
            const { data: nc } = await supabase.from('gemini_cache').select('response_json').eq('cache_key', narrativeCacheKey).maybeSingle();
            narrativeData = nc?.response_json;
          } catch (e) {}
          if (!narrativeData) {
            narrativeData = await analyzeEventNarrativeViaProxy({
              symbol: resolvedSymbol, company_name: resolvedCompany,
              event_family: familyForScoring, stage: ext.stage,
              order_value_cr: ext.order_value_cr, customer: ext.customer,
              summary: aiResult.summary, impact_score: scoring.impact_score,
              institutional_risk: det.institutional_risk, policy_bias: det.policy_bias,
              tactical_plan: det.tactical_plan, trigger_text: det.trigger_text,
            });
            if (narrativeData) {
              try { await supabase.from('gemini_cache').upsert({ cache_key: narrativeCacheKey, response_json: narrativeData }); } catch (e) {}
            }
          }
          analysisPayload = {
            event_analysis_text: narrativeData?.event_analysis_text || '',
            analysis_updated_at: new Date().toISOString(),
            institutional_risk: det.institutional_risk, policy_bias: det.policy_bias,
            policy_event: det.policy_event, tactical_plan: det.tactical_plan,
            trigger_text: det.trigger_text,
          };
        }

        const fingerprint = getStringHash(`${resolvedSymbol}|${resolvedCompany}|${resolvedEventDate}|${aiResult.summary.substring(0, 30)}|${c.id}`);
        // Only include columns that exist on analyzed_events to avoid Supabase 400 (PGRST102)
        const payload: Record<string, unknown> = {
          event_date:            resolvedEventDate || null,
          symbol:                String(resolvedSymbol ?? ''),
          company_name:          String(resolvedCompany ?? 'Unknown'),
          source:                c.source || 'XBRL',
          event_family:          familyForScoring,
          summary:               String(aiResult.summary || ''),
          impact_score:          Number(scoring.impact_score) || 0,
          action_recommendation: scoring.recommendation || 'TRACK',
          extracted_json:        typeof ext === 'object' ? ext : {},
          attachment_link:       c.attachment_link ?? null,
          source_link:           c.link ?? null,
          event_fingerprint:     fingerprint,
          confidence:            Number(aiResult.confidence) || 0,
          direction:             scoring.direction || 'NEUTRAL',
          stage:                 ext.stage ?? null,
          evidence_spans:        Array.isArray(aiResult.evidence_spans) ? aiResult.evidence_spans : [],
          missing_fields:        Array.isArray(aiResult.missing_fields) ? aiResult.missing_fields : [],
          scoring_factors:       Array.isArray(scoring.factors) ? scoring.factors : [],
          order_type:            (scoring.order_type && scoring.order_type !== 'UNKNOWN') ? scoring.order_type : (ext.order_type || null),
          market_cap_cr:         ext.market_cap_cr ?? null,
          conversion_bonus:      scoring.conversion_bonus || 0,
          execution_months:      scoring.final_execution_months ?? null,
          ...analysisPayload,
        };
        const cleanPayload: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(payload)) {
          if (v === undefined) continue;
          // PostgreSQL rejects \u0000 null bytes in text fields
          cleanPayload[k] = typeof v === 'string' ? v.replace(/\u0000/g, '') : v;
        }

        const { data: report, error: upsertError } = await supabase.from('analyzed_events').upsert(cleanPayload, { onConflict: 'event_fingerprint' }).select().single();
        if (upsertError) {
          console.error('[Reg30] Supabase upsert failed:', upsertError.message, upsertError.details, upsertError.hint);
          onRowProgress(c.id, 'FAILED');
        } else {
          if (report) reports.push(mapDbRowToReport(report));
          onRowProgress(c.id, 'COMPLETED');
        }
      } else {
        onRowProgress(c.id, 'FAILED');
      }
    } catch (err) {
      onRowProgress(c.id, 'FAILED');
    }
  }
  return reports;
};

export const reAnalyzeSingleEvent = async (report: Reg30Report): Promise<Reg30Report | null> => {
  const candidate: EventCandidate = {
    id: report.id, source: report.source, event_date: report.event_date,
    symbol: normalizeSymbol(report.symbol) || null,
    company_name: normalizeCompany(report.company_name) || 'Unknown',
    category: report.event_family,
    raw_text: report.summary,
    link: report.link,
    attachment_link: report.attachment_link,
    event_family: report.event_family,
  };
  const aiResult: any = await analyzeReg30EventViaProxy(candidate);
  if (aiResult) {
    const ext = aiResult.extracted || {};
    const resolvedSymbol  = (aiResult._resolved_symbol  || ext.nse_symbol || ext.symbol || normalizeSymbol(report.symbol) || '').toUpperCase();
    const resolvedCompany = normalizeCompany(aiResult._resolved_company || ext.company_name || report.company_name) || 'Unknown';
    const familyForScoring = (aiResult._event_family || (
      report.event_family === 'OTHER' && (ext.order_value_cr != null || ['LOA','WO','NTP','L1'].includes(ext.stage || ''))
        ? 'ORDER_CONTRACT' : report.event_family
    )) as Reg30EventFamily;
    const scoring = aiResult._proxy_scored ? {
      impact_score:       aiResult.impact_score || 0,
      direction:          aiResult._direction || 'NEUTRAL',
      recommendation:     (aiResult.recommendation || 'TRACK') as ActionRecommendation,
      factors:            aiResult._scoring_factors || [],
      conversion_bonus:   aiResult._conversion_bonus || 0,
      final_execution_months: aiResult._execution_months ?? null,
      order_type:         aiResult._order_type || null,
    } : calculateScoreAndRecommendation(familyForScoring, ext, aiResult.confidence, report.event_date);
    
    let analysisPayload: any = {};
    if (scoring.impact_score >= 50) {
      const det = getDeterministicAnalysis({
        event_date: report.event_date,
        summary: aiResult.summary,
        impact_score: scoring.impact_score,
        extracted_data: aiResult.extracted
      });
      const narrativeData = await analyzeEventNarrativeViaProxy({
        symbol: resolvedSymbol,
        company_name: resolvedCompany,
        event_family: report.event_family,
        stage: aiResult.extracted?.stage,
        order_value_cr: aiResult.extracted?.order_value_cr,
        customer: aiResult.extracted?.customer,
        summary: aiResult.summary,
        impact_score: scoring.impact_score,
        institutional_risk: det.institutional_risk,
        policy_bias: det.policy_bias,
        tactical_plan: det.tactical_plan,
        trigger_text: det.trigger_text
      }) ?? await analyzeEventNarrative({
        symbol: resolvedSymbol,
        event_family: report.event_family,
        stage: aiResult.extracted.stage,
        order_value_cr: aiResult.extracted.order_value_cr,
        customer: aiResult.extracted.customer,
        ...det
      });
      analysisPayload = { 
        ...det, 
        event_analysis_text: narrativeData?.event_analysis_text || "Analysis updated.",
        analysis_updated_at: new Date().toISOString()
      };
    }

    const { data: updated } = await supabase.from('analyzed_events').update({
      symbol: resolvedSymbol,
      company_name: resolvedCompany,
      summary: aiResult.summary, impact_score: scoring.impact_score, action_recommendation: scoring.recommendation,
      extracted_json: aiResult.extracted, attachment_text: cleanedText || attachment_text, confidence: aiResult.confidence,
      direction: scoring.direction, stage: aiResult.extracted.stage, evidence_spans: aiResult.evidence_spans,
      missing_fields: aiResult.missing_fields, scoring_factors: scoring.factors, 
      conversion_bonus: scoring.conversion_bonus,
      execution_months: scoring.final_execution_months,
      order_type: scoring.order_type,
      ...analysisPayload
    }).eq('id', report.id).select().single();
    return updated ? mapDbRowToReport(updated) : null;
  }
  return null;
};

/**
 * Specifically regenerates the narrative only (to save costs on re-extracting everything).
 */
export const regenerateNarrativeOnly = async (report: Reg30Report): Promise<Reg30Report | null> => {
  if (report.impact_score < 50) return null;

  const det = getDeterministicAnalysis({
    event_date: report.event_date,
    summary: report.summary,
    impact_score: report.impact_score,
    extracted_data: report.extracted_data
  });
  const narrativeData = await analyzeEventNarrative({
    symbol: report.symbol,
    event_family: report.event_family,
    stage: report.stage,
    order_value_cr: report.order_value_cr,
    customer: report.extracted_data?.customer,
    ...det
  });

  if (narrativeData) {
    const { data: updated } = await supabase.from('analyzed_events').update({
      event_analysis_text: narrativeData.event_analysis_text,
      institutional_risk: det.institutional_risk,
      policy_bias: det.policy_bias,
      tactical_plan: det.tactical_plan,
      trigger_text: det.trigger_text,
      analysis_updated_at: new Date().toISOString()
    }).eq('id', report.id).select().single();
    return updated ? mapDbRowToReport(updated) : null;
  }
  return null;
};

export const toggleBookmark = async (symbol: string, companyName: string): Promise<boolean> => {
  try {
    const { data: existing } = await supabase.from('priority_stocks').select('id').eq('symbol', symbol).maybeSingle();
    if (existing) {
      await supabase.from('priority_stocks').delete().eq('symbol', symbol);
      return false;
    } else {
      await supabase.from('priority_stocks').insert({ symbol, company_name: companyName });
      return true;
    }
  } catch (e) {
    console.error("Bookmark toggle failed:", e);
    return false;
  }
};

export const fetchBookmarkedSymbols = async (): Promise<{symbol: string, company_name: string}[]> => {
  try {
    const { data, error } = await supabase.from('priority_stocks').select('symbol, company_name');
    if (error) return [];
    return data || [];
  } catch (e) {
    return [];
  }
};

export const removeBookmark = async (symbol: string) => {
  await supabase.from('priority_stocks').delete().eq('symbol', symbol);
};

/** Returns the most recent event_date stored in analyzed_events, or null if empty. */
export const fetchLatestEventDate = async (): Promise<string | null> => {
  try {
    const { data, error } = await supabase
      .from('analyzed_events')
      .select('event_date')
      .order('event_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data.event_date as string;
  } catch {
    return null;
  }
};

/**
 * Fetches new NSE Reg30 announcements from the proxy (StockInsights API)
 * since `fromDate` (YYYY-MM-DD) and runs them through the analysis pipeline.
 * Emits progress via `onProgress(message)`.
 */
export const syncNseEvents = async (
  fromDate: string,
  onProgress: (msg: string) => void,
  onRowProgress: (id: string, step: 'FETCHING' | 'AI_ANALYZING' | 'SAVING' | 'COMPLETED' | 'FAILED') => void
): Promise<Reg30Report[]> => {
  onProgress(`Fetching NSE announcements since ${fromDate}…`);
  try {
    const res = await fetch(resolveBreezeUrl('/api/nse/announcements'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_date: fromDate }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || `Proxy returned ${res.status}`);
    }
    const data = await res.json();
    const rows: Array<{ company_name: string; nse_ticker: string; published_date: string; source_link: string }> =
      data.announcements || [];
    if (rows.length === 0) {
      onProgress('No new announcements found.');
      return [];
    }
    onProgress(`Found ${rows.length} new announcement(s). Processing…`);
    const candidates: EventCandidate[] = rows.map((r: any, i: number) => ({
      id: s(`${r.nse_ticker}-${r.published_date}-${i}`),
      source: 'XBRL' as Reg30Source,
      event_date: r.published_date.split('T')[0],
      symbol: r.nse_ticker,
      company_name: r.company_name,
      category: 'NSE Announcement',
      // summary_text from StockInsights AI — used as fallback if PDF/attachment parse fails
      raw_text: r.summary_text || `${r.company_name} | ${r.published_date}`,
      attachment_link: r.source_link,
      // StockInsights announcement_type_id='8' = Order/Contract Awards — treat as ORDER_CONTRACT from the start
      // so scoring never falls to the default OTHER=10, even when PDF parse fails.
      event_family: 'ORDER_CONTRACT' as Reg30EventFamily,
      link: r.source_link,
    }));
    return await runReg30Analysis(candidates, onRowProgress);
  } catch (e: any) {
    onProgress(`Sync failed: ${e?.message || 'Unknown error'}`);
    return [];
  }
};

export const clearReg30History = async () => {
  try {
    await supabase.from('analyzed_events').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  } catch (e) {}
};

const normalizeLink = (raw: string, source: Reg30Source): string => {
  const link = s(raw);
  if (!link || link === "null") return "";
  if (link.startsWith('http')) return link;
  if (link.endsWith('.xml') || source === 'XBRL' || source === 'CreditRating') {
    return `https://nsearchives.nseindia.com/corporate/xbrl/${link}`;
  }
  return `https://nsearchives.nseindia.com/corporate/ixbrl/${link}`;
};

const normalizeDate = (raw: string): string => {
  const clean = s(raw).split(' ')[0].toUpperCase();
  if (!clean) return new Date().toISOString().split('T')[0];
  if (clean.includes('-') && isNaN(Number(clean.charAt(0)))) {
    const months: any = { JAN:'01', FEB:'02', MAR:'03', APR:'04', MAY:'05', JUN:'06', JUL:'07', AUG:'08', SEP:'09', OCT:'10', NOV:'11', DEC:'12' };
    const parts = clean.split('-');
    if (parts.length === 3) return `${parts[2]}-${months[parts[1]] || '01'}-${parts[0].padStart(2, '0')}`;
  }
  const separator = clean.includes('-') ? '-' : (clean.includes('/') ? '/' : null);
  if (separator) {
    const p = clean.split(separator);
    if (p.length === 3) {
      if (p[2].length === 4) return `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
      if (p[0].length === 4) return `${p[0]}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`;
    }
  }
  return clean; 
};

const findColumn = (headers: string[], keys: string[]) => {
  const norm = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
  const searchKeys = keys.map(norm);
  return headers.findIndex(h => searchKeys.some(sk => norm(h).includes(sk)));
};

const splitCsvLine = (line: string): string[] => {
  const result: string[] = [];
  let currentField = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') inQuotes = !inQuotes;
    else if (char === ',' && !inQuotes) {
      result.push(currentField.trim().replace(/^"+|"+$/g, ''));
      currentField = '';
    } else currentField += char;
  }
  result.push(currentField.trim().replace(/^"+|"+$/g, ''));
  return result;
};

/** Build EventCandidate[] from XBRL/iXBRL URLs (one per row). Used by the XBRL links modal. */
export const candidatesFromXbrlUrls = (urlLines: string[]): EventCandidate[] => {
  const today = new Date().toISOString().split('T')[0];
  return urlLines
    .map(l => l.trim())
    .filter(l => l.length > 0 && (l.startsWith('http://') || l.startsWith('https://')))
    .map((url, i) => {
      // NSE XBRL/iXBRL URLs embed the date in the filename as _DDMMYYYYHHMMSS_
      // e.g. ANN_AWARD_BAGGING_144841_05032026193733_iXBRL_WEB.html → 2026-03-05
      const urlDateMatch = url.match(/_(\d{2})(\d{2})(\d{4})\d{6}_/);
      const event_date = urlDateMatch
        ? `${urlDateMatch[3]}-${urlDateMatch[2]}-${urlDateMatch[1]}`
        : today;
      return {
        id: getStringHash(`xbrl-url-${url}-${i}`),
        source: 'XBRL' as Reg30Source,
        event_date,
        symbol: null,
        company_name: 'Unknown',
        category: 'XBRL',
        raw_text: `XBRL link: ${url}`,
        attachment_link: url,
        event_family: 'OTHER' as Reg30EventFamily,
        link: url,
      };
    });
};

export const parseNseCsv = (text: string, source: Reg30Source): EventCandidate[] => {
  const cleanText = text.replace(/^﻿/, '').replace(/\r/g, '');
  const lines = cleanText.split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  const idxSymbol = findColumn(headers, ['symbol', 'sym']);
  const idxCompany = findColumn(headers, ['companyname', 'issuer', 'name']);
  const idxSubject = findColumn(headers, ['subject', 'purpose', 'eventsubject', 'category', 'subject']);
  const idxDetails = findColumn(headers, ['details', 'description', 'brief', 'narration', 'descriptionofevent', 'typeofsubmission']);
  const idxDate = findColumn(headers, ['date', 'timestamp', 'createdatetime', 'reportingdate', 'exdate', 'broadcastdate']);
  const idxAttachment = findColumn(headers, ['attachment', 'link', 'document', 'xbrlfilename', 'attachmentlink', 'attachment']);
  const idxRatingAction = findColumn(headers, ['ratingaction']);
  const candidates: EventCandidate[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]);
    if (values.length < 2) continue;
    const company_name = idxCompany !== -1 ? values[idxCompany] : "Unknown";
    const category = idxSubject !== -1 ? values[idxSubject] : "";
    const details = idxDetails !== -1 ? values[idxDetails] : "";
    const attachment_link = normalizeLink(idxAttachment !== -1 ? values[idxAttachment] : "", source);
    const event_date = normalizeDate(idxDate !== -1 ? values[idxDate] : "");
    const symbol = idxSymbol !== -1 ? values[idxSymbol] : null;
    let family: Reg30EventFamily = 'GOVERNANCE_MANAGEMENT';
    const sub = lower(category + " " + details + " " + (idxRatingAction !== -1 ? values[idxRatingAction] : ""));
    const isServiceContract = /investor relations|ir agency|public relations|pr agency|adfactors|communication agency|branding|media relations|media company|advertising|marketing|social media/i.test(sub);
    const looksLikeOrderWin = /awarding|bagging|work order|letter of award|\bloa\b|l1 bidder|lowest bidder|notice to proceed|\bntp\b|purchase order|\bpo\b/i.test(sub);
    if (looksLikeOrderWin && !isServiceContract) family = 'ORDER_CONTRACT';
    else if (sub.includes('issuance') || sub.includes('allotment') || sub.includes('equity') || sub.includes('rights issue')) family = 'DILUTION_CAPITAL';
    else if (sub.includes('dividend') || sub.includes('buyback') || sub.includes('bonus') || sub.includes('stock split')) family = 'SHAREHOLDER_RETURNS';
    else if (sub.includes('rating') || source === 'CreditRating') family = 'CREDIT_RATING';
    else if (sub.includes('litigation') || sub.includes('fine') || sub.includes('court') || sub.includes('penalty')) family = 'LITIGATION_REGULATORY';
    candidates.push({
      id: getStringHash(`${company_name}-${event_date}-${i}-${source}`),
      source, event_date, symbol, company_name, category,
      raw_text: `${category} | Details: ${details} | Company: ${company_name}`,
      attachment_link, event_family: family, link: attachment_link
    });
  }
  return candidates;
};
