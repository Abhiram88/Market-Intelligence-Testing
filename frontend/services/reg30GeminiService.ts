import { EventCandidate, Reg30Analysis } from "../types";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

const MODEL_NAME = "gemini-2.5-flash";

export const analyzeReg30Event = async (candidate: EventCandidate): Promise<Reg30Analysis | null> => {
  const apiKey = process.env.API_KEY || '';
  if (!apiKey) {
    console.error("API Key missing");
    return null;
  }
  
  const ai = new GoogleGenerativeAI(apiKey);

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
    const model = ai.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            summary: { type: SchemaType.STRING },
            impact_score: { type: SchemaType.INTEGER },
            recommendation: { type: SchemaType.STRING, format: "enum", enum: ['ACTIONABLE_BULLISH', 'ACTIONABLE_BEARISH_RISK', 'HIGH_PRIORITY_WATCH', 'TRACK', 'NEEDS_MANUAL_REVIEW', 'IGNORE'] },
            confidence: { type: SchemaType.NUMBER },
            missing_fields: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
            evidence_spans: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
            extracted: {
              type: SchemaType.OBJECT,
              properties: {
                order_value_cr: { type: SchemaType.NUMBER },
                stage: { type: SchemaType.STRING },
                international: { type: SchemaType.BOOLEAN },
                new_customer: { type: SchemaType.BOOLEAN },
                execution_months: { type: SchemaType.NUMBER, description: "Time period for execution in months" },
                execution_years: { type: SchemaType.NUMBER, description: "Time period for execution in years" },
                order_type: { type: SchemaType.STRING, format: "enum", enum: ["SUPPLY", "EPC", "SERVICES", "MAINTENANCE", "MIXED", "UNKNOWN"] },
                end_date: { type: SchemaType.STRING, description: "The completion/end date mentioned (YYYY-MM-DD)" },
                conditionality: { type: SchemaType.STRING, format: "enum", enum: ["HIGH", "MEDIUM", "LOW"] },
                rating_action: { type: SchemaType.STRING },
                notches: { type: SchemaType.NUMBER },
                outlook_change: { type: SchemaType.STRING },
                amount_cr: { type: SchemaType.NUMBER },
                stage_legal: { type: SchemaType.STRING },
                ops_impact: { type: SchemaType.STRING },
                customer: { type: SchemaType.STRING }
              }
            }
          },
          required: ["summary", "confidence", "extracted", "evidence_spans", "missing_fields"]
        }
      }
    });

    const response = await model.generateContent(prompt);

    const text = response.response.text();
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
  
  const ai = new GoogleGenerativeAI(apiKey);

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
    const model = ai.getGenerativeModel({
        model: MODEL_NAME,
        systemInstruction,
        generationConfig: {
            responseMimeType: "application/json",
                    responseSchema: {
                      type: SchemaType.OBJECT,
                      properties: {                event_analysis_text: { type: SchemaType.STRING, description: "4-8 lines max tactical narrative" },
                tone: { type: SchemaType.STRING }
              },
              required: ["event_analysis_text", "tone"]
            }
        }
    });

    const response = await model.generateContent(prompt);

    const text = response.response.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch (error) {
    console.error("Narrative Generation Failure:", error);
    return null;
  }
};
