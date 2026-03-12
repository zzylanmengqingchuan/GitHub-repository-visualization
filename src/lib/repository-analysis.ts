import type { ProjectAIAnalysis } from "@/types/analysis";
import type { FileTreeNode } from "@/types/repository";
import type { EntryFileInsight, LanguageInsight } from "@/types/analysis";

const CODE_FILE_EXTENSIONS = new Set([
  "c",
  "cc",
  "cpp",
  "cxx",
  "h",
  "hpp",
  "java",
  "kt",
  "scala",
  "go",
  "rs",
  "py",
  "rb",
  "php",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "vue",
  "svelte",
  "swift",
  "cs",
  "fs",
  "dart",
  "lua",
  "r",
  "sql",
  "sh",
  "bash",
  "zsh",
  "ps1",
  "yaml",
  "yml",
  "json",
  "toml",
  "xml",
  "html",
  "css",
  "scss",
  "less",
]);

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  c: "C",
  cc: "C++",
  cpp: "C++",
  cxx: "C++",
  h: "C/C++",
  hpp: "C++",
  java: "Java",
  kt: "Kotlin",
  scala: "Scala",
  go: "Go",
  rs: "Rust",
  py: "Python",
  rb: "Ruby",
  php: "PHP",
  js: "JavaScript",
  jsx: "JavaScript (React)",
  mjs: "JavaScript",
  cjs: "JavaScript",
  ts: "TypeScript",
  tsx: "TypeScript (React)",
  vue: "Vue",
  svelte: "Svelte",
  swift: "Swift",
  cs: "C#",
  fs: "F#",
  dart: "Dart",
  lua: "Lua",
  r: "R",
  sql: "SQL",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  ps1: "PowerShell",
  yaml: "YAML",
  yml: "YAML",
  json: "JSON",
  toml: "TOML",
  xml: "XML",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  less: "LESS",
};

const JSON_TEMPLATE = {
  mainLanguages: [
    {
      language: "TypeScript",
      confidence: 0.9,
      evidence: ["src/app/page.tsx", "src/lib/utils.ts"],
    },
  ],
  techStackTags: ["Next.js", "React", "Tailwind CSS"],
  possibleEntryFiles: [
    {
      path: "src/main.ts",
      reason: "Contains app bootstrap logic",
      confidence: 0.88,
    },
  ],
  analysisBasis: {
    totalCodeFiles: 120,
    sampledCodeFiles: 120,
  },
  summary: "Brief project stack summary.",
};

export function getAIAnalysisJsonTemplate(): string {
  return JSON.stringify(JSON_TEMPLATE, null, 2);
}

export function extractCodeFilePaths(tree: FileTreeNode[]): string[] {
  const paths: string[] = [];

  function walk(nodes: FileTreeNode[]) {
    for (const node of nodes) {
      if (node.type === "file") {
        const ext = node.path.split(".").pop()?.toLowerCase() ?? "";
        if (CODE_FILE_EXTENSIONS.has(ext)) {
          paths.push(node.path);
        }
        continue;
      }

      if (node.children?.length) {
        walk(node.children);
      }
    }
  }

  walk(tree);
  return paths;
}

function clampConfidence(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, numeric));
}

function sanitizeAIResult(value: unknown, fallback: ProjectAIAnalysis): ProjectAIAnalysis {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const obj = value as Record<string, unknown>;

  const mainLanguages: LanguageInsight[] = Array.isArray(obj.mainLanguages)
    ? obj.mainLanguages
        .map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }
          const language = String((item as Record<string, unknown>).language ?? "").trim();
          const evidenceRaw = (item as Record<string, unknown>).evidence;
          const evidence = Array.isArray(evidenceRaw)
            ? evidenceRaw.map((entry) => String(entry)).filter(Boolean).slice(0, 6)
            : [];
          if (!language) {
            return null;
          }
          return {
            language,
            confidence: clampConfidence((item as Record<string, unknown>).confidence),
            evidence,
          };
        })
        .filter((item): item is LanguageInsight => item !== null)
    : [];

  const techStackTags = Array.isArray(obj.techStackTags)
    ? obj.techStackTags.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 12)
    : [];

  const possibleEntryFiles: EntryFileInsight[] = Array.isArray(obj.possibleEntryFiles)
    ? obj.possibleEntryFiles
        .map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }
          const path = String((item as Record<string, unknown>).path ?? "").trim();
          const reason = String((item as Record<string, unknown>).reason ?? "").trim();
          if (!path || !reason) {
            return null;
          }
          return {
            path,
            reason,
            confidence: clampConfidence((item as Record<string, unknown>).confidence),
          };
        })
        .filter((item): item is EntryFileInsight => item !== null)
        .slice(0, 8)
    : [];

  const summary = String(obj.summary ?? "").trim();

  return {
    mainLanguages: mainLanguages.length ? mainLanguages : fallback.mainLanguages,
    techStackTags: techStackTags.length ? techStackTags : fallback.techStackTags,
    possibleEntryFiles: possibleEntryFiles.length
      ? possibleEntryFiles
      : fallback.possibleEntryFiles,
    analysisBasis: fallback.analysisBasis,
    summary: summary || fallback.summary,
    model: fallback.model,
  };
}

function buildHeuristicAnalysis(codeFiles: string[]): ProjectAIAnalysis {
  const extensionCount = new Map<string, number>();
  for (const path of codeFiles) {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    if (!ext) {
      continue;
    }
    extensionCount.set(ext, (extensionCount.get(ext) ?? 0) + 1);
  }

  const sortedExtensions = [...extensionCount.entries()].sort((a, b) => b[1] - a[1]);
  const total = Math.max(1, codeFiles.length);

  const mainLanguages = sortedExtensions.slice(0, 3).map(([ext, count]) => ({
    language: EXTENSION_LANGUAGE_MAP[ext] ?? ext.toUpperCase(),
    confidence: Number((count / total).toFixed(2)),
    evidence: codeFiles.filter((path) => path.toLowerCase().endsWith(`.${ext}`)).slice(0, 4),
  }));

  const allPathsLower = codeFiles.map((path) => path.toLowerCase());
  const techStackTags = new Set<string>();

  if (allPathsLower.some((path) => path.includes("next.config."))) techStackTags.add("Next.js");
  if (allPathsLower.some((path) => path.endsWith(".tsx") || path.endsWith(".jsx")))
    techStackTags.add("React");
  if (allPathsLower.some((path) => path.includes("tailwind"))) techStackTags.add("Tailwind CSS");
  if (allPathsLower.some((path) => path.endsWith(".vue"))) techStackTags.add("Vue");
  if (allPathsLower.some((path) => path.endsWith(".go"))) techStackTags.add("Go");
  if (allPathsLower.some((path) => path.endsWith(".rs"))) techStackTags.add("Rust");
  if (allPathsLower.some((path) => path.endsWith(".java"))) techStackTags.add("Java");
  if (allPathsLower.some((path) => path.endsWith(".py"))) techStackTags.add("Python");
  if (allPathsLower.some((path) => path.endsWith(".c") || path.endsWith(".cpp")))
    techStackTags.add("C/C++");

  const entryCandidates = [
    { test: /(^|\/)main\.(c|cc|cpp|cxx|go|rs|java|kt|py|js|ts)$/i, reason: "文件名为 main，常见程序入口。" },
    { test: /(^|\/)src\/main\.(ts|js|tsx|jsx|go|rs|java|kt)$/i, reason: "位于 src/main，常见应用启动入口。" },
    { test: /(^|\/)src\/index\.(ts|js|tsx|jsx)$/i, reason: "位于 src/index，常见前端或库入口。" },
    { test: /(^|\/)app\/page\.tsx$/i, reason: "Next.js App Router 首页入口。" },
    { test: /(^|\/)pages\/index\.(tsx|jsx|ts|js)$/i, reason: "Next.js Pages Router 首页入口。" },
  ];

  const possibleEntryFiles = codeFiles
    .flatMap((path) =>
      entryCandidates
        .filter((rule) => rule.test.test(path))
        .map((rule) => ({
          path,
          reason: rule.reason,
          confidence: 0.72,
        })),
    )
    .slice(0, 6);

  return {
    mainLanguages,
    techStackTags: [...techStackTags],
    possibleEntryFiles,
    analysisBasis: {
      totalCodeFiles: codeFiles.length,
      sampledCodeFiles: codeFiles.length,
    },
    summary: "基于文件扩展名与路径规则完成初步分析（未启用 AI 或 AI 不可用）。",
    model: "heuristic-fallback",
  };
}

export async function analyzeProjectFromFileList(
  repoUrl: string,
  codeFiles: string[],
): Promise<ProjectAIAnalysis> {
  const fallback = buildHeuristicAnalysis(codeFiles);

  if (!codeFiles.length) {
    return {
      ...fallback,
      summary: "仓库中未检测到可分析的代码文件。",
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return fallback;
  }

  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const sampledFiles = codeFiles.slice(0, 500);

  const prompt = [
    "你是资深代码架构分析助手。",
    "请根据给定仓库代码文件列表，分析主要编程语言、技术栈标签、可能的主入口文件。",
    "仅输出 JSON，不要输出 markdown 或额外文本。",
    "必须遵循以下 JSON 模板字段与类型：",
    getAIAnalysisJsonTemplate(),
    `仓库地址: ${repoUrl}`,
    `代码文件总量: ${codeFiles.length}`,
    "代码文件列表如下：",
    sampledFiles.join("\n"),
  ].join("\n\n");

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a precise software architecture analyst. Return strict JSON only.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      return fallback;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return fallback;
    }

    const parsed = JSON.parse(content) as unknown;
    const sanitized = sanitizeAIResult(parsed, {
      ...fallback,
      analysisBasis: {
        totalCodeFiles: codeFiles.length,
        sampledCodeFiles: sampledFiles.length,
      },
      model,
    });

    return sanitized;
  } catch {
    return fallback;
  }
}
