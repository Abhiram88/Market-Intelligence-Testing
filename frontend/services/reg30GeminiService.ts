import { EventCandidate, Reg30Analysis } from "../types";

const MODEL_NAME = "gemini-2.5-flash";

export const analyzeReg30Event = async (candidate: EventCandidate): Promise<Reg30Analysis | null> => {
  const apiKey = process.env.API_KEY || '';
  if (!apiKey) {
    console.error("API Key missing");
    return null;
  }
  
  const ai = new GoogleGenAI({ apiKey, vertexai: true });

  const documentBody = candidate.attachment_text ? candidate.attachment_text.substring(0, 30000) : "";

  const systemInstruction = `
    You are an expert Indian equity events analyst focused on NSE Regulation 30–style disclosures and order-pipeline events.
    You ONLY summarize and extract structured data from provided text. You do NOT browse the web.

    HARD RULES:
    1) NEVER fabricate numbers or facts. If not present, output null and add the field name to missing_fields.
    2) Use only provided raw_text/attachment_text. No external sources.
    3) Provide evidence_spans (<=160 chars each) for key extractions/classifications.
    4) CURRENCY: Convert raw INR to Crore (CR). 1 CR = 10,000,000 INR.
    5) STAGE: Must be one of: "L1" | "LOA" | "WO" | "NTP" | "MOU" | "OTHER".
    6) Output MUST be STRICT JSON only.
  `;

  const prompt = `Perform a forensic extraction on this NSE disclosure:
    Company: ${candidate.company_name}
    Symbol: ${candidate.symbol}
    Source: ${candidate.source}
    Context: ${candidate.raw_text}
    
    Document Text: ${documentBody}`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction,
        // thinkingConfig: { thinkingBudget: 4000 }, // Use if available on the model
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            impact_score: { type: Type.INTEGER },
            recommendation: { type: Type.STRING, enum: ['ACTIONABLE_BULLISH', 'ACTIONABLE_BEARISH_RISK', 'HIGH_PRIORITY_WATCH', 'TRACK', 'NEEDS_MANUAL_REVIEW', 'IGNORE'] },
            confidence: { type: Type.NUMBER },
            missing_fields: { type: Type.ARRAY, items: { type: Type.STRING } },
            evidence_spans: { type: Type.ARRAY, items: { type: Type.STRING } },
            extracted: {
              type: Type.OBJECT,
              properties: {
                order_value_cr: { type: Type.NUMBER },
                stage: { type: Type.STRING },
                international: { type: Type.BOOLEAN },
                new_customer: { type: Type.BOOLEAN },
                execution_months: { type: Type.NUMBER, description: "Time period for execution in months" },
                execution_years: { type: Type.NUMBER, description: "Time period for execution in years" },
                order_type: { type: Type.STRING, enum: ["SUPPLY", "EPC", "SERVICES", "MAINTENANCE", "MIXED", "UNKNOWN"] },
                end_date: { type: Type.STRING, description: "The completion/end date mentioned (YYYY-MM-DD)" },
                conditionality: { type: Type.STRING, enum: ["HIGH", "MEDIUM", "LOW"] },
                rating_action: { type: Type.STRING },
                notches: { type: Type.NUMBER },
                outlook_change: { type: Type.STRING },
                amount_cr: { type: Type.NUMBER },
                stage_legal: { type: Type.STRING },
                ops_impact: { type: Type.STRING },
                customer: { type: Type.STRING }
              }
            }
          },
          required: ["summary", "confidence", "extracted", "evidence_spans", "missing_fields"]
        }
      }
    });

    const text = response.text;
    if (!text) return null;
    return JSON.parse(text) as Reg30Analysis;
  } catch (error) {
    console.error("Reg30 Gemini Analysis Error:", error);
    return null;
  }
};

/**
 * Generates a tactical narrative for high-impact events.
 */
export const analyzeEventNarrative = async (inputs: any): Promise<{ event_analysis_text: string; tone: string } | null> => {
  const apiKey = process.env.API_KEY || '';
  if (!apiKey) return null;
  
  const ai = new GoogleGenAI({ apiKey, vertexai: true });

  const systemInstruction = `
    You are a Senior Tactical Analyst for Indian Equities.
    Generate a 4-8 line narrative explaining execution risk and tactical outlook.
    Use professional neutral tone. Focus on institutional shakeout risk and near-term triggers.
    Output MUST be STRICT JSON only.
  `;

  const prompt = `
    Analyze this corporate event for tactical traders.
    
    EVENT DATA:
    Symbol: ${inputs.symbol}
    Family: ${inputs.event_family}
    Stage: ${inputs.stage}
    Value: ₹${inputs.order_value_cr} Cr
    Customer: ${inputs.customer}
    Risk Level: ${inputs.institutional_risk}
    Policy Bias: ${inputs.policy_bias}
    Tactical Plan: ${inputs.tactical_plan}
    
    TASK: Write a 4-8 line narrative (as a single paragraph or bullet-like sentences) synthesizing these factors into a cohesive tactical outlook. Do not invent prices.
  `;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            event_analysis_text: { type: Type.STRING, description: "4-8 lines max tactical narrative" },
            tone: { type: Type.STRING }
          },
          required: ["event_analysis_text", "tone"]
        }
      }
    });

    const text = response.text;
    if (!text) return null;
    return JSON.parse(text);
  } catch (error) {
    console.error("Narrative Generation Failure:", error);
    return null;
  }
};
