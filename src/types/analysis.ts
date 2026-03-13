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

export type EntryFileReview = {
  path: string;
  isEntry: boolean;
  confidence: number;
  reason: string;
  evidence: string[];
  contentStrategy: {
    totalLines: number;
    sentLines: number;
    mode: "full" | "head_tail";
  };
  model: string;
};

export type EntryFileReviewDebug = {
  enabled: boolean;
  usedFallback: boolean;
  reason: string;
  request: unknown | null;
  response: unknown | null;
};

export type ProjectEntryAnalysis = {
  confirmedEntryFile: EntryFileReview | null;
  reviewedCandidates: EntryFileReview[];
  stoppedEarly: boolean;
  summary: string;
  model: string;
};

export type ProjectEntryAnalysisResult = {
  analysis: ProjectEntryAnalysis;
  debug: EntryFileReviewDebug[];
};

export type FunctionDiveDecision = -1 | 0 | 1;

export type FunctionCallNode = {
  functionName: string;
  filePath: string;
  summary: string;
  diveRecommendation: FunctionDiveDecision;
  reason: string;
  confidence: number;
  evidence: string[];
};

export type FunctionCallAnalysis = {
  rootFunctionName: string;
  rootFilePath: string;
  rootSummary: string;
  childFunctions: FunctionCallNode[];
  reservedForRecursion: {
    maxDepth: number;
    nextSuggestedFunctions: string[];
  };
  summary: string;
  model: string;
};

export type FunctionCallAnalysisDebug = {
  enabled: boolean;
  usedFallback: boolean;
  reason: string;
  request: unknown | null;
  response: unknown | null;
};

export type FunctionCallAnalysisResult = {
  analysis: FunctionCallAnalysis | null;
  debug: FunctionCallAnalysisDebug;
};
