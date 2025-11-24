

import { Modality } from "@google/genai";

export enum ActiveTab {
  RESUME = 'RESUME',
  INTERVIEW = 'INTERVIEW',
  MARKET = 'MARKET',
  PORTFOLIO = 'PORTFOLIO',
}

export type InterviewStatus = 'idle' | 'mic-check' | 'connecting' | 'active' | 'error' | 'finished';
export type InterviewPersona = 'Junior Peer' | 'Senior Engineer' | 'Staff Architect' | 'Tech Lead' | 'Hiring Manager';

// --- Agent Schemas ---

export interface ResumeImprovement {
  action: string;
  priority: 'High' | 'Medium' | 'Low';
  example: string;
}

export interface DetectedSkill {
  name: string;
  importance: string;
}

export interface ResumeAnalysis {
  candidateName: string;
  currentTitle: string;
  executiveSummary: string;
  detectedTechStack: DetectedSkill[];
  hiringVerdict: "Strong No Hire" | "No Hire" | "Leaning No Hire" | "Leaning Hire" | "Hire" | "Strong Hire";
  rawText?: string;
  scores: {
    atsCompatibility: number;
    engineeringImpact: number;
    techStackRelevance: number;
  };
  greenFlags: string[];
  criticalGaps: string[];
  improvementPlan: ResumeImprovement[];
  rewrites: {
    section: string;
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

export interface JobListing {
  title: string;
  company: string;
  location: string;
  description: string;
}

export interface MarketReport {
  roleOverview: string;
  compensationBreakdown: {
    baseSalary: number;
    equity: number;
    signOnBonus: number;
    totalComp: number;
    currency: string;
  };
  salaryPercentile: number; // 0-100
  costOfLivingAnalysis: string; // "High", "Medium", "Low" context
  negotiationScript: string;
  negotiationPoints: string[];
  hiringTrends: { trend: string; demandScore: number }[];
  jobListings: JobListing[];
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
  codeSnippet: string;
}

export interface PortfolioAnalysis {
  overallGrade: string;
  hiringDecision: string;
  technicalSuperpower: string;
  brandAnalysis: {
    careerNarrativeScore: number;
    visualStorytellingScore: number;
    experiencePresentation: string;
    personalBrandCritique: string;
    educationCritique: string;
  };
  missingEngineeringPractices: string[];
  holisticAdvice: string[];
  skillRadar: {
    architecture: number;
    codeStyle: number;
    testing: number;
    documentation: number;
    innovation: number;
  };
  projects: PortfolioProject[];
}

export interface TranscriptItem {
  speaker: 'user' | 'ai' | 'system';
  text: string;
  timestamp: string;
  isComplete?: boolean;
}

export interface InterviewFeedbackDetail {
  category: 'Strength' | 'Improvement';
  observation: string;
  quote: string;
}

export interface InterviewFeedback {
  overallScore: number;
  technicalAccuracy: string;
  technicalAccuracyScore: number;
  communicationClarity: string;
  communicationClarityScore: number;
  keyStrengths: string[];
  areasForImprovement: string[];
  detailedFeedback: InterviewFeedbackDetail[];
  hiringRecommendation: "Strong No Hire" | "No Hire" | "Leaning No Hire" | "Leaning Hire" | "Hire" | "Strong Hire";
}