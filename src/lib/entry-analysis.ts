import { getRepositoryFileByUrl } from "@/lib/github";
import type {
  EntryFileReview,
  EntryFileReviewDebug,
  ProjectAIAnalysis,
  ProjectEntryAnalysisResult,
} from "@/types/analysis";

const ENTRY_ANALYSIS_MODEL = process.env.GEMINI_MODEL ?? "gemini-3-flash-preview";
const MAX_DIRECT_LINES = 4000;
const HEAD_TAIL_LINES = 2000;

const ENTRY_ANALYSIS_JSON_TEMPLATE = {
  isEntry: true,
  confidence: 0.92,
  reason: "This file boots the application and wires runtime initialization.",
  evidence: [
    "Contains the process startup routine.",
    "Imports root app module and starts the server.",
  ],
};

function getEntryAnalysisJsonTemplate(): string {
  return JSON.stringify(ENTRY_ANALYSIS_JSON_TEMPLATE, null, 2);
}

function selectContentForReview(content: string): {
  content: string;
  totalLines: number;
  sentLines: number;
  mode: "full" | "head_tail";
} {
  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;

  if (totalLines <= MAX_DIRECT_LINES) {
    return {
      content,
      totalLines,
      sentLines: totalLines,
      mode: "full",
    };
  }

  const head = lines.slice(0, HEAD_TAIL_LINES);
  const tail = lines.slice(-HEAD_TAIL_LINES);

  return {
    content: [
      head.join("\n"),
      "",
      `... middle ${Math.max(0, totalLines - HEAD_TAIL_LINES * 2)} lines omitted ...`,
      "",
      tail.join("\n"),
    ].join("\n"),
    totalLines,
    sentLines: head.length + tail.length,
    mode: "head_tail",
  };
}

function clampConfidence(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, numeric));
}

function sanitizeEntryReview(value: unknown, fallback: EntryFileReview): EntryFileReview {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const obj = value as Record<string, unknown>;
  const evidenceRaw = Array.isArray(obj.evidence)
    ? obj.evidence.map((item) => String(item).trim()).filter(Boolean).slice(0, 6)
    : [];

  return {
    ...fallback,
    isEntry: typeof obj.isEntry === "boolean" ? obj.isEntry : fallback.isEntry,
    confidence: clampConfidence(obj.confidence),
    reason: String(obj.reason ?? fallback.reason).trim() || fallback.reason,
    evidence: evidenceRaw.length ? evidenceRaw : fallback.evidence,
  };
}

function buildFallbackReview(params: {
  path: string;
  contentStrategy: EntryFileReview["contentStrategy"];
  model: string;
  readError?: string;
}): EntryFileReview {
  const lowerPath = params.path.toLowerCase();
  const likely =
    /(^|\/)main\./.test(lowerPath) ||
    /(^|\/)src\/main\./.test(lowerPath) ||
    /(^|\/)src\/index\./.test(lowerPath);

  return {
    path: params.path,
    isEntry: likely,
    confidence: likely ? 0.68 : 0.32,
    reason: params.readError
      ? `候选文件读取失败（${params.readError}），当前仅能基于文件命名规则做保守判断。`
      : likely
        ? "基于文件命名规则与常见项目结构，本地规则判断它很可能承担启动入口职责。"
        : "基于文件命名规则，本地规则没有发现足够证据证明它是主入口文件。",
    evidence: likely
      ? ["文件路径符合 main/index 等常见入口命名模式。"]
      : ["文件路径不符合常见入口命名模式，且未调用在线模型复核。"],
    contentStrategy: params.contentStrategy,
    model: params.model,
  };
}

async function callGeminiEntryReview(params: {
  repoUrl: string;
  projectSummary: string;
  mainLanguages: ProjectAIAnalysis["mainLanguages"];
  candidatePath: string;
  contentForReview: string;
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const prompt = [
    "你是资深软件架构分析助手。",
    "任务：判断给定文件是否是真实项目入口文件。",
    "入口文件的含义：程序启动时首先运行，或者承担应用主初始化、主路由装配、服务启动、CLI 启动、主函数启动等职责。",
    "请只输出 JSON，不要输出 markdown 或额外解释。",
    "必须遵循以下 JSON 模板：",
    getEntryAnalysisJsonTemplate(),
    `项目 GitHub 链接: ${params.repoUrl}`,
    `项目简介: ${params.projectSummary}`,
    `项目主要编程语言: ${params.mainLanguages.map((item) => item.language).join(", ") || "未知"}`,
    `待研判文件: ${params.candidatePath}`,
    "文件内容如下：",
    params.contentForReview,
  ].join("\n\n");

  const requestPayload = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${ENTRY_ANALYSIS_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestPayload),
      cache: "no-store",
    },
  );

  return { response, requestPayload };
}

export async function analyzeProjectEntryFiles(params: {
  repoUrl: string;
  branch: string;
  projectSummary: string;
  mainLanguages: ProjectAIAnalysis["mainLanguages"];
  possibleEntryFiles: ProjectAIAnalysis["possibleEntryFiles"];
}): Promise<ProjectEntryAnalysisResult> {
  const reviewedCandidates: EntryFileReview[] = [];
  const debugLogs: EntryFileReviewDebug[] = [];

  if (!params.possibleEntryFiles.length) {
    return {
      analysis: {
        confirmedEntryFile: null,
        reviewedCandidates,
        stoppedEarly: false,
        summary: "没有候选入口文件，未执行逐文件研判。",
        model: ENTRY_ANALYSIS_MODEL,
      },
      debug: debugLogs,
    };
  }

  for (const candidate of params.possibleEntryFiles) {
    let contentStrategy: EntryFileReview["contentStrategy"] = {
      totalLines: 0,
      sentLines: 0,
      mode: "full",
    };
    let contentForReview = "";
    let readError = "";

    try {
      const file = await getRepositoryFileByUrl({
        repoUrl: params.repoUrl,
        filePath: candidate.path,
        branch: params.branch,
      });
      const selected = selectContentForReview(file.content);
      contentStrategy = {
        totalLines: selected.totalLines,
        sentLines: selected.sentLines,
        mode: selected.mode,
      };
      contentForReview = selected.content;
    } catch (error) {
      readError = error instanceof Error ? error.message : "file_read_exception";
    }

    const fallback = buildFallbackReview({
      path: candidate.path,
      contentStrategy,
      model: ENTRY_ANALYSIS_MODEL,
      readError: readError || undefined,
    });

    if (readError) {
      reviewedCandidates.push(fallback);
      debugLogs.push({
        enabled: false,
        usedFallback: true,
        reason: `file_read_failed:${readError}`,
        request: {
          candidatePath: candidate.path,
        },
        response: null,
      });
      if (fallback.isEntry) {
        return {
          analysis: {
            confirmedEntryFile: fallback,
            reviewedCandidates,
            stoppedEarly: true,
            summary: `候选文件读取失败，但本地规则仍判断 ${fallback.path} 很可能是项目入口文件。`,
            model: ENTRY_ANALYSIS_MODEL,
          },
          debug: debugLogs,
        };
      }
      continue;
    }

    try {
      const geminiCall = await callGeminiEntryReview({
        repoUrl: params.repoUrl,
        projectSummary: params.projectSummary,
        mainLanguages: params.mainLanguages,
        candidatePath: candidate.path,
        contentForReview,
      });

      if (!geminiCall) {
        reviewedCandidates.push(fallback);
        debugLogs.push({
          enabled: false,
          usedFallback: true,
          reason: "missing_gemini_api_key",
          request: null,
          response: null,
        });
        if (fallback.isEntry) {
          return {
            analysis: {
              confirmedEntryFile: fallback,
              reviewedCandidates,
              stoppedEarly: true,
              summary: `本地规则确认 ${fallback.path} 很可能是项目入口文件。`,
              model: ENTRY_ANALYSIS_MODEL,
            },
            debug: debugLogs,
          };
        }
        continue;
      }

      const { response, requestPayload } = geminiCall;
      if (!response.ok) {
        reviewedCandidates.push(fallback);
        debugLogs.push({
          enabled: true,
          usedFallback: true,
          reason: `gemini_http_${response.status}`,
          request: requestPayload,
          response: { status: response.status },
        });
        if (fallback.isEntry) {
          return {
            analysis: {
              confirmedEntryFile: fallback,
              reviewedCandidates,
              stoppedEarly: true,
              summary: `在线模型不可用，已由本地规则确认 ${fallback.path} 很可能是项目入口文件。`,
              model: ENTRY_ANALYSIS_MODEL,
            },
            debug: debugLogs,
          };
        }
        continue;
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        reviewedCandidates.push(fallback);
        debugLogs.push({
          enabled: true,
          usedFallback: true,
          reason: "gemini_empty_content",
          request: requestPayload,
          response: data,
        });
        if (fallback.isEntry) {
          return {
            analysis: {
              confirmedEntryFile: fallback,
              reviewedCandidates,
              stoppedEarly: true,
              summary: `在线模型未返回可解析内容，已由本地规则确认 ${fallback.path} 很可能是项目入口文件。`,
              model: ENTRY_ANALYSIS_MODEL,
            },
            debug: debugLogs,
          };
        }
        continue;
      }

      const parsed = JSON.parse(rawText) as unknown;
      const review = sanitizeEntryReview(parsed, fallback);
      reviewedCandidates.push(review);
      debugLogs.push({
        enabled: true,
        usedFallback: false,
        reason: "ok",
        request: requestPayload,
        response: { raw: parsed },
      });

      if (review.isEntry) {
        return {
          analysis: {
            confirmedEntryFile: review,
            reviewedCandidates,
            stoppedEarly: true,
            summary: `已确认 ${review.path} 是项目入口文件。理由：${review.reason}`,
            model: ENTRY_ANALYSIS_MODEL,
          },
          debug: debugLogs,
        };
      }
    } catch (error) {
      reviewedCandidates.push(fallback);
      debugLogs.push({
        enabled: true,
        usedFallback: true,
        reason: error instanceof Error ? error.message : "entry_analysis_exception",
        request: {
          candidatePath: candidate.path,
          contentStrategy: fallback.contentStrategy,
        },
        response: null,
      });

      if (fallback.isEntry) {
        return {
          analysis: {
            confirmedEntryFile: fallback,
            reviewedCandidates,
            stoppedEarly: true,
            summary: `逐文件研判时发生异常，已由本地规则确认 ${fallback.path} 很可能是项目入口文件。`,
            model: ENTRY_ANALYSIS_MODEL,
          },
          debug: debugLogs,
        };
      }
    }
  }

  return {
    analysis: {
      confirmedEntryFile: null,
      reviewedCandidates,
      stoppedEarly: false,
      summary: reviewedCandidates.length
        ? "已完成全部候选文件研判，但暂未确认真实入口文件。"
        : "没有完成任何候选文件研判。",
      model: ENTRY_ANALYSIS_MODEL,
    },
    debug: debugLogs,
  };
}
