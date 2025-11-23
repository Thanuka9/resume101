import { GoogleGenAI, Type, Schema } from "@google/genai";
import { ResumeAnalysis, MarketReport, GroundingSource, PortfolioAnalysis } from "../types";

/**
 * Helper to extract JSON from markdown code blocks or raw text
 */
const cleanAndParseJSON = (text: string) => {
  try {
    // 1. Try removing markdown code blocks
    let cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    // 2. If that fails, try extracting the first { ... } object
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error("Failed to parse JSON response");
  }
};

/**
 * AGENT ALPHA: Technical Resume Architect
 */
export const analyzeResumeDeep = async (
  input: { base64Data?: string; mimeType?: string; text?: string },
  targetRole: string
): Promise<ResumeAnalysis> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  let rawResumeData = "";

  if (input.text) {
    rawResumeData = input.text;
  } else if (input.base64Data && input.mimeType) {
    const extractionResp = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [
          { inlineData: { mimeType: input.mimeType, data: input.base64Data } },
          { text: "Transcribe the text from this document exactly, maintaining the structure where possible. Do not summarize." }
        ]
      }
    });
    rawResumeData = extractionResp.text || "";
  }

  const analysisSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      candidateName: { type: Type.STRING },
      currentTitle: { type: Type.STRING },
      executiveSummary: { type: Type.STRING, description: "Detailed 3-4 sentence assessment of engineering capability and level." },
      detectedTechStack: { type: Type.ARRAY, items: { type: Type.STRING } },
      scores: {
        type: Type.OBJECT,
        properties: {
          atsCompatibility: { type: Type.NUMBER },
          engineeringImpact: { type: Type.NUMBER, description: "Score based on 'Action -> Metric -> Result' pattern." },
          techStackRelevance: { type: Type.NUMBER, description: "Match against modern industry standards for the role." },
        },
        required: ["atsCompatibility", "engineeringImpact", "techStackRelevance"]
      },
      criticalGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
      improvementPlan: { 
        type: Type.ARRAY, 
        items: { 
          type: Type.OBJECT,
          properties: {
            action: { type: Type.STRING, description: "The specific action to take." },
            priority: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
            example: { type: Type.STRING, description: "A concrete example of how to implement this." }
          }
        }, 
        description: "A comprehensive strategic plan." 
      },
      rewrites: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            original: { type: Type.STRING },
            improved: { type: Type.STRING },
            rationale: { type: Type.STRING },
          }
        }
      },
      marketLevel: { type: Type.STRING, description: "Junior, Mid-Level, Senior, Staff, Principal" }
    },
    required: ["candidateName", "currentTitle", "executiveSummary", "detectedTechStack", "scores", "criticalGaps", "improvementPlan", "rewrites", "marketLevel"]
  };

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: `
      You are Agent Alpha, a Technical Recruiter for a top-tier tech company.
      Target Role: ${targetRole}
      
      Resume Content:
      ${rawResumeData}

      Your Task:
      1. Evaluate this candidate specifically for a **Technical Role**. 
      2. Identify "Red Flags" and "Critical Gaps".
      3. Create a **Structured Improvement Plan**. For each item, assign a Priority and give a SPECIFIC Example (e.g., "Change 'Managed database' to 'Optimized PostgreSQL queries reducing latency by 40%'").
      4. Rewrite bullet points to emphasize **engineering impact**.
    `,
    config: {
      responseMimeType: "application/json",
      responseSchema: analysisSchema,
      thinkingConfig: { thinkingBudget: 4096 }
    }
  });

  if (!response.text) throw new Error("Agent Alpha failed.");
  return cleanAndParseJSON(response.text) as ResumeAnalysis;
};

/**
 * AGENT BRAVO: Tech Market Scout
 */
export const scoutMarket = async (
  query: string,
  location: string
): Promise<MarketReport> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: `
      You are Agent Bravo, a Tech Compensation Analyst.
      
      Task: Research the market for: "${query}" in "${location}".
      
      1. Use Google Search to find real-time data from sources like Levels.fyi, Glassdoor, LinkedIn.
      2. Find **Total Compensation (TC)** numbers. Return purely NUMERIC values for the salary fields (no currency symbols or commas in the numbers, just raw integers).
      
      Output JSON format:
      {
        "roleOverview": "string",
        "compensationBreakdown": { 
          "baseSalary": number (average annual base), 
          "equity": number (average annual equity value), 
          "signOnBonus": number (average sign on), 
          "totalComp": number (sum of above), 
          "currency": "string (e.g. USD, GBP, LKR)" 
        },
        "negotiationPoints": ["string"],
        "hiringTrends": ["string"],
        "topTechHubs": ["string"]
      }
    `,
    config: {
      tools: [{ googleSearch: {} }]
    }
  });

  const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
    ?.map((c: any) => c.web)
    .filter((w: any) => w && w.uri && w.title) as GroundingSource[] || [];

  const data = cleanAndParseJSON(response.text || "{}");
  return { ...data, sources };
};

/**
 * AGENT DELTA: Engineering Portfolio Auditor
 */
export const analyzePortfolio = async (
  url: string,
  description: string,
  targetRole: string
): Promise<PortfolioAnalysis> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      overallGrade: { type: Type.STRING },
      hiringDecision: { type: Type.STRING },
      technicalSuperpower: { type: Type.STRING },
      missingEngineeringPractices: { type: Type.ARRAY, items: { type: Type.STRING } },
      holisticAdvice: { type: Type.ARRAY, items: { type: Type.STRING } },
      projects: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            projectName: { type: Type.STRING },
            impactScore: { type: Type.NUMBER },
            codeQualityScore: { type: Type.NUMBER },
            techStack: { type: Type.ARRAY, items: { type: Type.STRING } },
            critique: { type: Type.STRING, description: "Detailed technical critique (4-5 sentences)." },
            improvement: { type: Type.STRING, description: "Specific technical instruction." },
            codeSnippet: { type: Type.STRING, description: "A code block illustrating the improvement or the correct pattern (e.g. correct usage of useEffect, or a Dockerfile snippet). Mark it with language like 'typescript' or 'python'." }
          }
        }
      }
    },
    required: ["overallGrade", "hiringDecision", "technicalSuperpower", "missingEngineeringPractices", "projects", "holisticAdvice"]
  };

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: `
      You are Agent Delta, a Principal Engineer.
      Target Role: ${targetRole}
      
      Input: 
      URL: ${url}
      Context: ${description}

      Your Task:
      1. Audit this portfolio for **Engineering Competence**.
      2. Provide **Extensive** feedback.
      3. For each project, provide a **Code Snippet** (pseudocode or actual code) that shows how to fix a flaw or implement a missing best practice (e.g. adding error handling, typing a response, optimizing a query).
    `,
    config: {
      responseMimeType: "application/json",
      responseSchema: schema,
      thinkingConfig: { thinkingBudget: 4096 }
    }
  });

  if (!response.text) throw new Error("Agent Delta failed.");
  return cleanAndParseJSON(response.text) as PortfolioAnalysis;
}