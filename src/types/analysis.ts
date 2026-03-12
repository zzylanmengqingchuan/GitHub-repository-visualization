export type LanguageInsight = {
  language: string;
  confidence: number;
  evidence: string[];
};

export type EntryFileInsight = {
  path: string;
  reason: string;
  confidence: number;
};

export type ProjectAIAnalysis = {
  mainLanguages: LanguageInsight[];
  techStackTags: string[];
  possibleEntryFiles: EntryFileInsight[];
  analysisBasis: {
    totalCodeFiles: number;
    sampledCodeFiles: number;
  };
  summary: string;
  model: string;
};

export type AIAnalysisDebug = {
  enabled: boolean;
  usedFallback: boolean;
  reason: string;
  request: unknown | null;
  response: unknown | null;
};

export type ProjectAIAnalysisResult = {
  analysis: ProjectAIAnalysis;
  debug: AIAnalysisDebug;
};
