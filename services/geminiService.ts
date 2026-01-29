
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { ResumeAnalysis, MarketReport, GroundingSource, PortfolioAnalysis, TranscriptItem, InterviewFeedback, CodeEvaluation } from "../types";

const cleanAndParseJSON = (text: string) => {
  try {
    let cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
    // Remove any text before the first '{' and after the last '}'
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
       cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("JSON Parse Error", e);
    throw new Error("Failed to parse JSON response from AI");
  }
};

export const analyzeResumeDeep = async (
  input: { base64Data?: string; mimeType?: string; text?: string },
  targetRole: string,
  useEconomyMode: boolean = true
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
          { text: "Transcribe the text from this document exactly. Do not summarize." }
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
      executiveSummary: { type: Type.STRING },
      detectedTechStack: { 
        type: Type.ARRAY, 
        items: { 
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            importance: { type: Type.STRING }
          }
        } 
      },
      hiringVerdict: { type: Type.STRING, enum: ["Strong No Hire", "No Hire", "Leaning No Hire", "Leaning Hire", "Hire", "Strong Hire"] },
      scores: {
        type: Type.OBJECT,
        properties: {
          atsCompatibility: { type: Type.NUMBER },
          engineeringImpact: { type: Type.NUMBER },
          techStackRelevance: { type: Type.NUMBER },
        },
        required: ["atsCompatibility", "engineeringImpact", "techStackRelevance"]
      },
      greenFlags: { type: Type.ARRAY, items: { type: Type.STRING } },
      criticalGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
      improvementPlan: { 
        type: Type.ARRAY, 
        items: { 
          type: Type.OBJECT,
          properties: {
            action: { type: Type.STRING },
            priority: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
            example: { type: Type.STRING }
          }
        }
      },
      rewrites: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            section: { type: Type.STRING },
            original: { type: Type.STRING },
            improved: { type: Type.STRING },
            rationale: { type: Type.STRING },
          }
        }
      },
      marketLevel: { type: Type.STRING }
    },
    required: ["candidateName", "currentTitle", "executiveSummary", "detectedTechStack", "hiringVerdict", "scores", "greenFlags", "criticalGaps", "improvementPlan", "rewrites", "marketLevel"]
  };

  const model = useEconomyMode ? "gemini-2.5-flash" : "gemini-3-pro-preview";
  const config: any = {
    responseMimeType: "application/json",
    responseSchema: analysisSchema,
  };

  // Enable Thinking Config for both.
  // Economy: 4096 (Free limit friendly). Pro: 8192 (Deep thought).
  config.thinkingConfig = { thinkingBudget: useEconomyMode ? 4096 : 8192 };

  const response = await ai.models.generateContent({
    model: model,
    contents: `
      You are Agent Alpha, a Senior Technical Recruiter.
      Target Role: ${targetRole}
      Resume Text: ${rawResumeData}
      
      Task:
      1. Provide a hiring verdict.
      2. Rewrite weak bullet points to be "Action + Metric + Result".
      3. Identify critical gaps for the role.
      4. Create a strategic improvement plan.
      5. Identify tech stack and explain why each skill is important for this role.
    `,
    config: config
  });

  if (!response.text) throw new Error("Agent Alpha failed.");
  const result = cleanAndParseJSON(response.text) as ResumeAnalysis;
  result.rawText = rawResumeData;
  return result;
};

export const scoutMarket = async (
  query: string,
  location: string,
  useEconomyMode: boolean = true
): Promise<MarketReport> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const model = useEconomyMode ? "gemini-2.5-flash" : "gemini-3-pro-preview";
  
  // Economy mode uses internal knowledge instead of live search to save money
  const tools = useEconomyMode ? undefined : [{ googleSearch: {} }];
  
  const prompt = useEconomyMode 
    ? `You are Agent Bravo, a Tech Compensation Analyst. 
       Estimate market data based on your internal knowledge (acting as a cached database) for: "${query}" in "${location}".
       Do NOT search the web. Use your training data as the source of truth.`
    : `You are Agent Bravo, a Tech Compensation Analyst.
       Research live market data for: "${query}" in "${location}".`;

  const config: any = { tools };
  // Enable thinking for better estimation in economy mode too
  config.thinkingConfig = { thinkingBudget: useEconomyMode ? 2048 : 8192 };

  const response = await ai.models.generateContent({
    model: model,
    contents: `
      ${prompt}
      
      Output strict JSON (no markdown) matching this structure:
      {
        "roleOverview": "string (brief market summary)",
        "compensationBreakdown": {
          "baseSalary": number (Median Annual Base Salary),
          "equity": number (Median Annual Equity Value, 0 if not common),
          "signOnBonus": number (Median Sign-on, 0 if not common),
          "totalComp": number (Total Annual Compensation),
          "currency": "string (e.g. USD, GBP, LKR, etc.)"
        },
        "salaryPercentile": number (0-100, where this totalComp falls in market),
        "costOfLivingAnalysis": "string (1 sentence context: e.g. 'Comfortable for single, tight for family')",
        "negotiationScript": "string (A specific 2-3 sentence email script to ask for more money based on this data)",
        "negotiationPoints": ["string (leverage points)"],
        "hiringTrends": [{ "trend": "string", "demandScore": number (1-10) }],
        "jobListings": [{ "title": "string", "company": "string", "location": "string", "description": "string" }],
        "topTechHubs": ["string (Cities/Regions with high demand for this role)"]
      }
    `,
    config: config
  });

  const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
    ?.map((c: any) => c.web)
    .filter((w: any) => w && w.uri && w.title) as GroundingSource[] || [];

  const data = cleanAndParseJSON(response.text || "{}");
  return { ...data, sources };
};

export const analyzePortfolio = async (
  url: string,
  description: string,
  targetRole: string,
  useEconomyMode: boolean = true
): Promise<PortfolioAnalysis> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const model = useEconomyMode ? "gemini-2.5-flash" : "gemini-3-pro-preview";
  // Disable search in economy to save cost
  const tools = useEconomyMode ? undefined : [{ googleSearch: {} }];
  const config: any = { tools };
  
  // Keep thinking active in Economy mode for better analysis of the provided text
  config.thinkingConfig = { thinkingBudget: useEconomyMode ? 4096 : 8192 };

  const prompt = useEconomyMode 
    ? `You are Agent Delta, a Principal Engineer & Hiring Manager.
       Role Context: ${targetRole}
       URL Provided: ${url} (Note: You cannot browse this URL in Economy Mode. Rely ONLY on the User Context below).
       User Context: ${description}
       
       TASK: Perform a HOLISTIC Audit based on the description provided. Assume the description accurately reflects the portfolio.`
    : `You are Agent Delta, a Principal Engineer & Hiring Manager.
       Role Context: ${targetRole}
       URL: ${url}
       Context: ${description}
       
       TASK: Perform a HOLISTIC Audit of this Candidate.
       Usage of Google Search is MANDATORY. Do not just look at the landing page.`;

  const response = await ai.models.generateContent({
    model: model,
    contents: `
      ${prompt}
      
      CRITIQUE ALL ASPECTS:
      1. ENGINEERING (Code): Code quality, architecture, testing, CI/CD, documentation.
      2. WORK EXPERIENCE: How is their history presented? Is it impact-driven or just a list of duties?
      3. EDUCATION: How is their academic background leveraged? (Degrees, Certs, Research).
      4. PERSONAL BRAND: Bio quality, contact info clarity, professional narrative.
      
      Output strict JSON (no markdown) with this structure:
      {
        "overallGrade": "string (A-F)",
        "hiringDecision": "string",
        "technicalSuperpower": "string",
        "brandAnalysis": {
            "careerNarrativeScore": number (0-100),
            "visualStorytellingScore": number (0-100),
            "experiencePresentation": "string",
            "personalBrandCritique": "string",
            "educationCritique": "string"
        },
        "missingEngineeringPractices": ["string"],
        "holisticAdvice": ["string"],
        "skillRadar": {
          "architecture": number (0-100),
          "codeStyle": number (0-100),
          "testing": number (0-100),
          "documentation": number (0-100),
          "innovation": number (0-100)
        },
        "projects": [{
            "projectName": "string",
            "impactScore": number,
            "codeQualityScore": number,
            "techStack": ["string"],
            "critique": "string (detailed)",
            "improvement": "string (actionable)",
            "codeSnippet": "string (pseudocode or specific fix)"
        }]
      }
    `,
    config: config
  });

  if (!response.text) throw new Error("Agent Delta failed.");
  return cleanAndParseJSON(response.text) as PortfolioAnalysis;
};

export const evaluateCodeSubmission = async (
  code: string, 
  challengeTitle: string, 
  challengeDesc: string
): Promise<CodeEvaluation> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // Detect if this is a custom/scratchpad submission
  const isCustom = challengeTitle.includes("Scratchpad") || challengeTitle.includes("Free Coding");
  
  const prompt = isCustom 
    ? `
      You are a Senior Technical Interviewer evaluating a candidate's ad-hoc code snippet.
      
      User Code:
      ${code}
      
      The user wrote this code in a "Scratchpad" during an interview. They might be answering a question you just asked, or demonstrating a concept.
      
      Task:
      1. Analyze the code for syntax errors, bugs, and best practices (Clean Code).
      2. Infer the likely intent (e.g., "Attempting to reverse a string", "Writing a SQL query").
      3. Evaluate efficiency (Time/Space) if applicable.
      
      Return strictly JSON.
    ` 
    : `
      You are a Strict Code Interviewer.
      Problem Context: ${challengeTitle}
      Description/Goal: ${challengeDesc}
      User Code:
      ${code}

      Task:
      Evaluate the code against the specific problem description.
      Evaluate for Correctness, Time Complexity, Space Complexity, and Style.
      Return strictly JSON.
    `;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          passed: { type: Type.BOOLEAN },
          correctness: { type: Type.STRING },
          timeComplexity: { type: Type.STRING },
          spaceComplexity: { type: Type.STRING },
          codeStyle: { type: Type.STRING }
        },
        required: ["passed", "correctness", "timeComplexity", "spaceComplexity", "codeStyle"]
      }
    }
  });
  
  if (!response.text) throw new Error("Code evaluation failed");
  return cleanAndParseJSON(response.text) as CodeEvaluation;
}

export const generateInterviewFeedback = async (
  transcript: TranscriptItem[],
  role: string,
  useEconomyMode: boolean = true
): Promise<InterviewFeedback> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const formattedTranscript = transcript.map(t => `${t.speaker.toUpperCase()}: ${t.text}`).join('\n');

  const model = useEconomyMode ? "gemini-2.5-flash" : "gemini-3-pro-preview";

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      overallScore: { type: Type.NUMBER },
      technicalAccuracy: { type: Type.STRING },
      technicalAccuracyScore: { type: Type.NUMBER },
      communicationClarity: { type: Type.STRING },
      communicationClarityScore: { type: Type.NUMBER },
      keyStrengths: { type: Type.ARRAY, items: { type: Type.STRING } },
      areasForImprovement: { type: Type.ARRAY, items: { type: Type.STRING } },
      detailedFeedback: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            category: { type: Type.STRING, enum: ["Strength", "Improvement"] },
            observation: { type: Type.STRING },
            quote: { type: Type.STRING }
          }
        }
      },
      hiringRecommendation: { type: Type.STRING, enum: ["Strong No Hire", "No Hire", "Leaning No Hire", "Leaning Hire", "Hire", "Strong Hire"] }
    },
    required: ["overallScore", "technicalAccuracy", "technicalAccuracyScore", "communicationClarity", "communicationClarityScore", "keyStrengths", "areasForImprovement", "detailedFeedback", "hiringRecommendation"]
  };
  
  const config: any = {
      responseMimeType: "application/json",
      responseSchema: schema,
  }

  // Thinking enabled for both modes to ensure high quality feedback
  config.thinkingConfig = { thinkingBudget: useEconomyMode ? 4096 : 8192 };

  const response = await ai.models.generateContent({
    model: model,
    contents: `
      Evaluate interview transcript for ${role}.
      Transcript: ${formattedTranscript}
      
      Score specifically on technical correctness and communication.
    `,
    config: config
  });

  if (!response.text) throw new Error("Feedback generation failed.");
  return cleanAndParseJSON(response.text) as InterviewFeedback;
};
