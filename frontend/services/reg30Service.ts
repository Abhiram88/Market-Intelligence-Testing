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

/** Call proxy to run Reg30 Gemini analysis (no API key needed in frontend). */
async function analyzeReg30EventViaProxy(candidate: EventCandidate): Promise<Reg30Analysis | null> {
  try {
    const res = await fetch(resolveBreezeUrl('/api/gemini/reg30-analyze'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidate: {
          company_name: candidate.company_name,
          symbol: candidate.symbol,
          source: candidate.source,
          raw_text: candidate.raw_text,
        },
        attachment_text: candidate.attachment_text || '',
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || res.statusText);
    }
    const data = await res.json();
    if (!data || typeof data.summary !== 'string') return null;
    // #region agent log
    fetch('http://127.0.0.1:7668/ingest/97e7cb68-ab84-452b-a7a9-2d1b110002d3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'930199'},body:JSON.stringify({sessionId:'930199',location:'reg30Service.ts:proxyResponse',message:'Proxy reg30 response',data:{topLevelSymbol:data.symbol,topLevelCompany:data.company_name,extractedKeys:data.extracted?Object.keys(data.extracted):[],extractedSymbol:(data.extracted&&typeof data.extracted==='object')?data.extracted.symbol:undefined,extractedNseSymbol:(data.extracted&&typeof data.extracted==='object')?data.extracted.nse_symbol:undefined,extractedCompany:(data.extracted&&typeof data.extracted==='object')?data.extracted.company_name:undefined,order_value_cr:(data.extracted&&typeof data.extracted==='object')?data.extracted.order_value_cr:undefined},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    // Proxy returns extraction-only schema (summary, direction_hint, confidence, extracted, evidence_spans, missing_fields).
    // Impact and recommendation are computed by calculateScoreAndRecommendation in the pipeline.
    const extracted = data.extracted && typeof data.extracted === 'object' ? data.extracted : {};
    const mergedExtracted = { ...extracted };
    if (data.symbol != null && mergedExtracted.nse_symbol == null && mergedExtracted.symbol == null) mergedExtracted.nse_symbol = data.symbol;
    if (data.company_name != null && mergedExtracted.company_name == null) mergedExtracted.company_name = data.company_name;
    return {
      summary: data.summary,
      impact_score: typeof data.impact_score === 'number' ? data.impact_score : 0,
      recommendation: (data.recommendation as Reg30Analysis['recommendation']) || 'TRACK',
      confidence: typeof data.confidence === 'number' ? data.confidence : 0,
      missing_fields: Array.isArray(data.missing_fields) ? data.missing_fields : [],
      evidence_spans: Array.isArray(data.evidence_spans) ? data.evidence_spans : [],
      extracted: mergedExtracted,
    } as Reg30Analysis;
  } catch (e) {
    console.error('Reg30 proxy analysis failed:', e);
    return null;
  }
}

/**
 * PROXY RESOLUTION
 */
const DEFAULT_BREEZE_PROXY = "https://breeze-proxy-919207294606.us-west1.run.app";

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
 * ATTACHMENT PARSER
 */
export const fetchAttachmentText = async (url: string): Promise<string> => {
  if (!url) return "";
  try {
    const parserEndpoint = resolveBreezeUrl('/api/attachment/parse');
    const response = await fetch(parserEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    if (!response.ok) return "";
    const data = await response.json();
    return data.text || "";
  } catch (err) {
    return "";
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
  let final_execution_months: number | null = extracted.execution_months || (extracted.execution_years ? extracted.execution_years * 12 : null);
  const order_type = extracted.order_type || "UNKNOWN";

  const addFactor = (pts: number, msg: string) => {
    impact_score += pts;
    factors.push(`${pts >= 0 ? '+' : ''}${pts}: ${msg}`);
  };

  switch (family) {
    case 'ORDER_CONTRACT':
    case 'ORDER_PIPELINE': {
      direction = 'POSITIVE';
      addFactor(family === 'ORDER_CONTRACT' ? 20 : 15, `Base weight for ${family.replace('_', ' ')}`);
      
      const orderCr = extracted.order_value_cr;
      const marketCapCr = extracted.market_cap_cr;
      if (orderCr != null && orderCr > 0) {
        if (marketCapCr != null && marketCapCr > 0) {
          const ratio = orderCr / marketCapCr;
          const ratioBonus = ratio >= 0.15 ? 25 : ratio >= 0.08 ? 18 : ratio >= 0.03 ? 12 : ratio >= 0.01 ? 6 : 2;
          addFactor(ratioBonus, `Order vs market cap ${(ratio * 100).toFixed(2)}% (₹${orderCr} Cr / ₹${marketCapCr} Cr)`);
        } else {
          const absoluteBonus = orderCr >= 1000 ? 30 : orderCr >= 500 ? 20 : orderCr >= 100 ? 10 : 5;
          addFactor(absoluteBonus, `Value bonus (₹${orderCr} Cr)`);
        }
      } else {
        addFactor(-10, "Order value missing");
      }
      
      const stageBonus = extracted.stage === 'LOA' ? 20 : extracted.stage === 'WO' ? 18 : extracted.stage === 'NTP' ? 15 : extracted.stage === 'L1' ? 12 : 5;
      addFactor(stageBonus, `Stage: ${extracted.stage || 'General'}`);

      if (!final_execution_months && extracted.end_date) {
        final_execution_months = inferExecutionMonths(eventDate, extracted.end_date);
      }

      if (final_execution_months !== null) {
        if (final_execution_months <= 6) conversion_bonus = 10;
        else if (final_execution_months <= 12) conversion_bonus = 6;
        else if (final_execution_months <= 24) conversion_bonus = 2;
        else conversion_bonus = 0;
      }

      if (order_type === 'SUPPLY') conversion_bonus += 2;
      else if (order_type === 'SERVICES') conversion_bonus += 1;

      conversion_bonus = Math.min(conversion_bonus, 10);

      if (conversion_bonus > 0) {
        addFactor(conversion_bonus, `Conversion bonus (execution ~${final_execution_months || 'N/A'} months, type: ${order_type})`);
      }
      break;
    }
    case 'CREDIT_RATING': {
      const sub = lower(extracted.rating_action || "");
      const isUpgrade = sub.includes('upgrade');
      const isDowngrade = sub.includes('downgrade');
      direction = isUpgrade ? 'POSITIVE' : (isDowngrade ? 'NEGATIVE' : 'NEUTRAL');
      addFactor(isUpgrade ? 40 : (isDowngrade ? 50 : 10), `Rating: ${extracted.rating_action || 'Review'}`);
      break;
    }
    case 'LITIGATION_REGULATORY':
      direction = 'NEGATIVE';
      addFactor(40, "Litigation risk");
      break;
    default:
      addFactor(10, `Standard event: ${family}`);
  }

  impact_score = Math.min(Math.max(impact_score, 0), 100);
  let recommendation: ActionRecommendation = 'TRACK';
  if (confidence < 0.65) recommendation = 'NEEDS_MANUAL_REVIEW';
  else if (impact_score >= 75) recommendation = direction === 'POSITIVE' ? 'ACTIONABLE_BULLISH' : 'ACTIONABLE_BEARISH_RISK';
  else if (impact_score >= 55) recommendation = 'HIGH_PRIORITY_WATCH';

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

export const fetchAnalyzedEvents = async (limit = 1000): Promise<Reg30Report[]> => {
  try {
    const { data, error } = await supabase
      .from('analyzed_events')
      .select('*')
      .order('event_date', { ascending: false })
      .limit(limit);
    
    if (error) return [];
    
    return (data || []).map(item => ({
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
      event_analysis_text: item.event_analysis_text || '',
      institutional_risk: item.institutional_risk || 'LOW',
      policy_bias: item.policy_bias || 'NEUTRAL',
      policy_event: item.policy_event || null,
      tactical_plan: item.tactical_plan || 'MOMENTUM_OK',
      trigger_text: item.trigger_text || ''
    }));
  } catch (e) {
    return [];
  }
};

export const runReg30Analysis = async (
  candidates: EventCandidate[], 
  onRowProgress: (id: string, step: 'FETCHING' | 'AI_ANALYZING' | 'SAVING' | 'COMPLETED' | 'FAILED') => void
): Promise<Reg30Report[]> => {
  const reports: Reg30Report[] = [];
  
  for (const c of candidates) {
    try {
      onRowProgress(c.id, 'FETCHING');
      const cacheKey = getStringHash(`${c.event_family}|${c.company_name}|${c.attachment_link || c.id}`);
      
      let aiResult = null;
      try {
        const { data: cached } = await supabase.from('gemini_cache').select('response_json').eq('cache_key', cacheKey).maybeSingle();
        aiResult = cached?.response_json;
      } catch (e) {}
      
      let attachment_text = "";
      
      if (!aiResult) {
        attachment_text = await fetchAttachmentText(c.attachment_link || "");
        // #region agent log
        fetch('http://127.0.0.1:7668/ingest/97e7cb68-ab84-452b-a7a9-2d1b110002d3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'930199'},body:JSON.stringify({sessionId:'930199',location:'reg30Service.ts:attachmentText',message:'Attachment text for analysis',data:{len:attachment_text.length,snippet:attachment_text.substring(0,500),hasNseSymbol:attachment_text.includes('NSE Symbol')||attachment_text.includes('MCLOUD'),hasCompany:attachment_text.includes('Magellanic')||attachment_text.includes('Company')},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
        // #endregion
        onRowProgress(c.id, 'AI_ANALYZING');
        aiResult = await analyzeReg30EventViaProxy({ ...c, attachment_text }) ?? await analyzeReg30Event({ ...c, attachment_text });
        if (aiResult) {
          try {
            await supabase.from('gemini_cache').upsert({ cache_key: cacheKey, response_json: aiResult });
          } catch (e) {}
        }
      }

      if (aiResult) {
        onRowProgress(c.id, 'SAVING');
        const ext = aiResult.extracted || {};
        const resolvedSymbol = ext.nse_symbol ?? ext.symbol ?? c.symbol;
        const resolvedCompany = ext.company_name ?? c.company_name;
        const familyForScoring =
          c.event_family === 'OTHER' && (ext.order_value_cr != null || ['LOA', 'WO', 'NTP', 'L1'].includes(ext.stage || ''))
            ? 'ORDER_CONTRACT'
            : c.event_family!;
        const scoring = calculateScoreAndRecommendation(familyForScoring, aiResult.extracted, aiResult.confidence, c.event_date);
        // #region agent log
        fetch('http://127.0.0.1:7668/ingest/97e7cb68-ab84-452b-a7a9-2d1b110002d3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'930199'},body:JSON.stringify({sessionId:'930199',location:'reg30Service.ts:scoring',message:'Resolved symbol and scoring',data:{candidateEventFamily:c.event_family,familyForScoring,extNseSymbol:ext.nse_symbol,extSymbol:ext.symbol,extCompany:ext.company_name,resolvedSymbol,resolvedCompany,impact_score:scoring.impact_score,factors:scoring.factors,order_value_cr:ext.order_value_cr,stage:ext.stage},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
        // #endregion
        
        let analysisPayload: any = {};
        if (scoring.impact_score >= 50) {
          const det = getDeterministicAnalysis({
            event_date: c.event_date,
            summary: aiResult.summary,
            impact_score: scoring.impact_score,
            extracted_data: aiResult.extracted
          });
          
          const narrativeCacheKey = getStringHash(`narrative_v2|${resolvedSymbol}|${c.event_date}|${det.tactical_plan}`);
          let narrativeData = null;
          try {
            const { data: narrativeCached } = await supabase.from('gemini_cache').select('response_json').eq('cache_key', narrativeCacheKey).maybeSingle();
            narrativeData = narrativeCached?.response_json;
          } catch (e) {}
          
          if (!narrativeData) {
            narrativeData = await analyzeEventNarrative({
              symbol: resolvedSymbol,
              event_family: c.event_family,
              stage: aiResult.extracted.stage,
              order_value_cr: aiResult.extracted.order_value_cr,
              customer: aiResult.extracted.customer,
              ...det
            });
            if (narrativeData) {
              try {
                await supabase.from('gemini_cache').upsert({ cache_key: narrativeCacheKey, response_json: narrativeData });
              } catch (e) {}
            }
          }
          
          analysisPayload = {
            ...det,
            event_analysis_text: narrativeData?.event_analysis_text || "Tactical overview generated successfully.",
            analysis_updated_at: new Date().toISOString()
          };
        }

        const fingerprint = getStringHash(`${resolvedSymbol}|${resolvedCompany}|${c.event_date}|${aiResult.summary.substring(0, 30)}|${c.id}`);
        
        const payload = {
          event_date: c.event_date,
          symbol: resolvedSymbol,
          company_name: resolvedCompany,
          source: c.source,
          event_family: familyForScoring,
          summary: aiResult.summary,
          impact_score: scoring.impact_score,
          action_recommendation: scoring.recommendation,
          extracted_json: aiResult.extracted,
          attachment_link: c.attachment_link,
          attachment_text: attachment_text || "Content from Cache",
          event_fingerprint: fingerprint,
          confidence: aiResult.confidence,
          direction: scoring.direction,
          source_link: c.link,
          stage: aiResult.extracted.stage,
          evidence_spans: aiResult.evidence_spans,
          missing_fields: aiResult.missing_fields,
          scoring_factors: scoring.factors,
          conversion_bonus: scoring.conversion_bonus,
          execution_months: scoring.final_execution_months,
          order_type: scoring.order_type,
          ...analysisPayload
        };

        const { data: report, error: upsertError } = await supabase.from('analyzed_events').upsert(payload, { onConflict: 'event_fingerprint' }).select().single();
        if (upsertError) {
          onRowProgress(c.id, 'FAILED');
        } else {
          if (report) reports.push(report as any);
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
  const attachment_text = await fetchAttachmentText(report.attachment_link || "");
  const candidate: EventCandidate = {
    id: report.id, source: report.source, event_date: report.event_date,
    symbol: report.symbol, company_name: report.company_name, category: report.event_family,
    raw_text: report.summary, attachment_text: attachment_text, link: report.link,
    attachment_link: report.attachment_link, event_family: report.event_family
  };
  const aiResult = await analyzeReg30EventViaProxy(candidate) ?? await analyzeReg30Event(candidate);
  if (aiResult) {
    const ext = aiResult.extracted || {};
    const resolvedSymbol = ext.nse_symbol ?? ext.symbol ?? report.symbol;
    const resolvedCompany = ext.company_name ?? report.company_name;
    const scoring = calculateScoreAndRecommendation(report.event_family, aiResult.extracted, aiResult.confidence, report.event_date);
    
    let analysisPayload: any = {};
    if (scoring.impact_score >= 50) {
      const det = getDeterministicAnalysis({
        event_date: report.event_date,
        summary: aiResult.summary,
        impact_score: scoring.impact_score,
        extracted_data: aiResult.extracted
      });
      const narrativeData = await analyzeEventNarrative({
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
      extracted_json: aiResult.extracted, attachment_text: attachment_text, confidence: aiResult.confidence,
      direction: scoring.direction, stage: aiResult.extracted.stage, evidence_spans: aiResult.evidence_spans,
      missing_fields: aiResult.missing_fields, scoring_factors: scoring.factors, 
      conversion_bonus: scoring.conversion_bonus,
      execution_months: scoring.final_execution_months,
      order_type: scoring.order_type,
      ...analysisPayload
    }).eq('id', report.id).select().single();
    return updated as any;
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
    .map((url, i) => ({
      id: getStringHash(`xbrl-url-${url}-${i}`),
      source: 'XBRL' as Reg30Source,
      event_date: today,
      symbol: null,
      company_name: 'Unknown',
      category: 'XBRL',
      raw_text: `XBRL link: ${url}`,
      attachment_link: url,
      event_family: 'OTHER' as Reg30EventFamily,
      link: url,
    }));
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
