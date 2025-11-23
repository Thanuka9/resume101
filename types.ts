import { Modality } from "@google/genai";

export enum ActiveTab {
  RESUME = 'RESUME',
  INTERVIEW = 'INTERVIEW',
  MARKET = 'MARKET',
  PORTFOLIO = 'PORTFOLIO',
}

export type InterviewStatus = 'idle' | 'connecting' | 'active' | 'error';
export type InterviewPersona = 'Junior Peer' | 'Senior Engineer' | 'Staff Architect';

// --- Agent Schemas ---

export interface ResumeImprovement {
  action: string;
  priority: 'High' | 'Medium' | 'Low';
  example: string;
}

export interface ResumeAnalysis {
  candidateName: string;
  currentTitle: string;
  executiveSummary: string;
  detectedTechStack: string[];
  scores: {
    atsCompatibility: number;
    engineeringImpact: number;
    techStackRelevance: number;
  };
  criticalGaps: string[];
  improvementPlan: ResumeImprovement[]; // Updated to structured object
  rewrites: {
    original: string;
    improved: string;
    rationale: string;
  }[];
  marketLevel: string;
}

export type SkillRating = Record<string, number>;

export interface GroundingSource {
  uri: string;
  title: string;
}

export interface MarketReport {
  roleOverview: string;
  compensationBreakdown: {
    baseSalary: number; // Changed to number for charts
    equity: number;     // Changed to number for charts
    signOnBonus: number; // Changed to number for charts
    totalComp: number;   // Changed to number for charts
    currency: string;
  };
  negotiationPoints: string[];
  hiringTrends: string[];
  topTechHubs: string[];
  sources: GroundingSource[];
}

export interface PortfolioProject {
  projectName: string;
  impactScore: number;
  codeQualityScore: number;
  techStack: string[];
  critique: string;
  improvement: string;
  codeSnippet: string; // New: Code example or Pseudocode
}

export interface PortfolioAnalysis {
  overallGrade: string;
  hiringDecision: string;
  technicalSuperpower: string;
  projects: PortfolioProject[];
  missingEngineeringPractices: string[];
  holisticAdvice: string[];
}