
import { GoogleGenAI } from "@google/genai";
import { MarketLog, NewsAttribution } from "../types";
import { supabase } from "../lib/supabase";

const MODEL_NAME = "gemini-2.5-flash";

/**
 * Robust helper to extract JSON from a string that might contain markdown blocks or conversational filler.
 */
const extractJson = (text: string) => {
  try {
    // Look for the first '{' and the last '}'
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1) {
      const jsonString = text.substring(firstBrace, lastBrace + 1);
      return JSON.parse(jsonString);
    }
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse JSON from Gemini response. Raw text:", text);
    throw new Error("The AI engine returned an invalid data format. Please try again.");
  }
};

export const analyzeMarketLog = async (log: MarketLog): Promise<NewsAttribution> => {
  const apiKey = process.env.API_KEY || '';
  if (!apiKey) throw new Error("API Key missing");
  
  const ai = new GoogleGenAI({ apiKey, vertexai: true });

  const direction = log.niftyChange >= 0 ? "upward (BULLISH)" : "downward (BEARISH)";
  
  const systemInstruction = "You are a Senior Quantitative Market Strategist and Financial Journalist specializing in the Indian Equity Markets (NSE/BSE). Your goal is to perform a 'Forensic News Correlation.' You must identify the specific macro-economic or geopolitical events that caused the Nifty 50 index to move on a specific date. Do not provide generic market advice; provide specific, data-backed causal links.";

  const prompt = `Analyze the Nifty 50 market movement for ${log.log_date}.
TECHNICAL TELEMETRY:
Closing Price: ${log.niftyClose}
Point Change: ${log.niftyChange}
Percentage Change: ${log.niftyChangePercent}%
Session Trend: ${direction}

OBJECTIVES:
1. Use Google Search Grounding to find the top 3-5 high-impact financial news stories published specifically on this date.
2. Synthesize a 'Causal Narrative' (min 300 words) that explains how these news stories influenced institutional buying or selling pressure.
3. Categorize the move (e.g., Monetary Policy, Geopolitical, Earnings).
4. Identify the specific Affected Stocks and Affected Sectors that led the rally or decline.

OUTPUT RULES:
Return the response in STRICT JSON format with the following keys:
{
  "headline": "string",
  "narrative": "string (min 300 words)",
  "category": "string",
  "sentiment": "POSITIVE | NEGATIVE | NEUTRAL",
  "impact_score": number (0-100),
  "affected_stocks": ["string"],
  "affected_sectors": ["string"]
}`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction,
        tools: [{ googleSearch: {} }],
        // CRITICAL: responseMimeType and responseSchema are NOT allowed when using googleSearch tool
      }
    });

    const text = response.text;
    if (!text) throw new Error("AI analysis engine returned empty.");

    const result = extractJson(text);
    
    const attribution: NewsAttribution = {
      headline: result.headline,
      narrative: result.narrative,
      category: result.category,
      sentiment: result.sentiment,
      impact_score: result.impact_score || 95,
      affected_stocks: result.affected_stocks || [],
      affected_sectors: result.affected_sectors || []
    };

    // Save to Supabase
    try {
        const payload = {
          market_log_id: log.id,
          headline: attribution.headline,
          narrative: attribution.narrative,
          impact_score: attribution.impact_score,
          model: MODEL_NAME,
          impact_json: {
            stocks: attribution.affected_stocks,
            sectors: attribution.affected_sectors,
            category: attribution.category,
            sentiment: attribution.sentiment
          }
        };
        await supabase.from('news_attribution').upsert(payload, { onConflict: 'market_log_id' });
    } catch (dbError) {
      console.warn("Supabase persistence failed:", dbError);
    }

    return attribution;
  } catch (error: any) {
    console.error("Gemini Pipeline Failure:", error);
    throw error;
  }
};

export const analyzeStockIntelligence = async (symbol: string, date: string = new Date().toISOString().split('T')[0]): Promise<NewsAttribution> => {
  const apiKey = process.env.API_KEY || '';
  if (!apiKey) throw new Error("API Key missing");
  
  const ai = new GoogleGenAI({ apiKey, vertexai: true });

  const systemInstruction = "You are a Senior Equity Analyst specializing in Indian Equities. Perform a forensic audit of a specific stock based on recent news and market data.";

  const prompt = `As a Senior Equity Analyst, perform a FORENSIC AUDIT for the NSE stock symbol: ${symbol} for the date: ${date}.
    
OBJECTIVES:
1. Determine the price movement drivers for ${symbol} based on recent news.
2. Find specific reasons for recent moves (Earnings, Order Wins, Corporate Actions, Sectoral pressure, etc.).
3. Obtain at least 2-3 recent analyst recommendations (calls) from reputable financial sources (Brokerages like ICICI Securities, Kotak, Jefferies, etc.). Include Rating and Target Price.
4. Synthesize a 300+ word causal narrative explaining the outlook.
5. Provide a swing trading recommendation (1 day to 1 month) based on the current setup.
6. Provide a punchy headline and sentiment bias.

OUTPUT RULES:
Return the response in STRICT JSON format with the following keys:
{
  "headline": "string",
  "narrative": "string (min 300 words)",
  "category": "string",
  "sentiment": "BUY | SELL | HOLD",
  "impact_score": number (0-100),
  "swing_recommendation": "string",
  "affected_stocks": ["string"],
  "affected_sectors": ["string"],
  "analyst_calls": [
    { "source": "string", "rating": "string", "target": "string" }
  ]
}`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction,
        tools: [{ googleSearch: {} }],
        // CRITICAL: responseMimeType and responseSchema are NOT allowed when using googleSearch tool
      }
    });

    const text = response.text;
    if (!text) throw new Error("Stock AI engine returned empty.");

    const result = extractJson(text);
    
    return {
      headline: result.headline,
      narrative: result.narrative,
      category: result.category,
      sentiment: result.sentiment,
      impact_score: result.impact_score || 90,
      swing_recommendation: result.swing_recommendation,
      affected_stocks: [symbol],
      affected_sectors: result.affected_sectors || [],
      analyst_calls: result.analyst_calls || []
    };
  } catch (error: any) {
    console.error("Stock Intelligence Failure:", error);
    throw error;
  }
};
