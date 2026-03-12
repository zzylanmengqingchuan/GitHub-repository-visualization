"use client";

import { normalizeGitHubRepoInput } from "@/lib/github-url";
import type { AIAnalysisDebug, ProjectAIAnalysis } from "@/types/analysis";
import type { FileTreeNode } from "@/types/repository";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

type RepoAnalyzeResult = {
  owner: string;
  repo: string;
  defaultBranch: string;
  tree: FileTreeNode[];
  totalFilesCount: number;
  codeFilesCount: number;
  filteredOutCount: number;
  aiAnalysis: ProjectAIAnalysis;
  aiDebug: AIAnalysisDebug;
};

type WorkLog = {
  id: number;
  timestamp: string;
  title: string;
  message: string;
  level: "info" | "success" | "error";
  jsonData?: unknown;
};

type DetailPreviewProps = {
  logs: WorkLog[];
  aiAnalysis: ProjectAIAnalysis | null;
  totalFilesCount: number;
  codeFilesCount: number;
  filteredOutCount: number;
  onClose: () => void;
};

function detectLanguageByPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";

  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    css: "css",
    scss: "scss",
    html: "markup",
    md: "markdown",
    py: "python",
    java: "java",
    go: "go",
    rs: "rust",
    yml: "yaml",
    yaml: "yaml",
    sh: "bash",
    sql: "sql",
    xml: "xml",
    vue: "vue",
    php: "php",
    c: "c",
    cpp: "cpp",
    h: "c",
  };

  return map[extension] ?? "text";
}

function truncateJsonLongFields(value: unknown, maxChars = 500): unknown {
  if (typeof value === "string") {
    if (value.length <= maxChars) {
      return value;
    }
    const truncated = value.slice(0, maxChars);
    const remaining = value.slice(maxChars);
    const remainingBytes = new TextEncoder().encode(remaining).length;
    return `${truncated}···(后续还有${remainingBytes}字节)`;
  }

  if (Array.isArray(value)) {
    return value.map((item) => truncateJsonLongFields(item, maxChars));
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = truncateJsonLongFields(item, maxChars);
    }
    return output;
  }

  return value;
}

function buildAnalysisSummary(analysis: ProjectAIAnalysis): string {
  const langs = analysis.mainLanguages
    .slice(0, 3)
    .map((item) => `${item.language}(${Math.round(item.confidence * 100)}%)`)
    .join("、");
  const tags = analysis.techStackTags.slice(0, 5).join("、");
  const entries = analysis.possibleEntryFiles
    .slice(0, 3)
    .map((item) => item.path)
    .join("、");

  return [
    langs ? `主要语言：${langs}` : "主要语言：未识别",
    tags ? `技术栈：${tags}` : "技术栈：未识别",
    entries ? `候选入口：${entries}` : "候选入口：未识别",
  ].join("；");
}

function buildAIDetailMessage(debug: AIAnalysisDebug, analysis: ProjectAIAnalysis): string {
  if (!debug.enabled) {
    return "未调用在线 AI，使用本地规则分析（常见原因：未配置 OPENAI_API_KEY 或无可分析代码文件）。";
  }

  if (debug.usedFallback) {
    return `在线 AI 调用未得到可用结果，已自动切换到本地规则分析。原因码：${debug.reason}。分析输出为：${buildAnalysisSummary(analysis)}`;
  }

  return `在线 AI 调用成功。已输出结构化结论：${buildAnalysisSummary(analysis)}`;
}

type TreeNodeProps = {
  node: FileTreeNode;
  selectedPath: string;
  onSelectFile: (path: string) => void;
  level?: number;
};

function TreeNode({ node, selectedPath, onSelectFile, level = 0 }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(level < 1);
  const paddingLeft = `${level * 14 + 10}px`;

  if (node.type === "file") {
    return (
      <button
        type="button"
        onClick={() => onSelectFile(node.path)}
        className={`flex w-full cursor-pointer items-center rounded-md py-1 pr-2 text-left text-sm transition ${
          selectedPath === node.path
            ? "bg-sky-100 text-sky-900"
            : "text-slate-700 hover:bg-slate-100"
        }`}
        style={{ paddingLeft }}
      >
        <span className="mr-2 text-xs text-slate-400">F</span>
        <span className="truncate">{node.name}</span>
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full cursor-pointer items-center rounded-md py-1 pr-2 text-left text-sm text-slate-700 hover:bg-slate-100"
        style={{ paddingLeft }}
      >
        <span className="mr-2 text-xs text-slate-400">{expanded ? "▼" : "▶"}</span>
        <span className="mr-2 text-xs text-amber-500">D</span>
        <span className="truncate">{node.name}</span>
      </button>
      {expanded && node.children && node.children.length > 0 ? (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              level={level + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DetailPreviewModal({
  logs,
  aiAnalysis,
  totalFilesCount,
  codeFilesCount,
  filteredOutCount,
  onClose,
}: DetailPreviewProps) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 p-4 backdrop-blur md:p-8">
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col rounded-2xl border border-slate-700 bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3 md:px-6">
          <h2 className="text-lg font-semibold text-white">分析预览窗口（全屏）</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-cyan-500 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
          >
            缩小返回
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 md:grid-cols-[1.1fr_1fr] md:p-6">
          <section className="min-h-0 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">工作日志</h3>
              <span className="text-xs text-slate-500">{logs.length} 条</span>
            </div>
            <div className="mt-3 h-[calc(100%-2.5rem)] space-y-3 overflow-auto pr-1">
              {!logs.length ? (
                <p className="text-sm text-slate-500">暂无日志</p>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="rounded-md border border-slate-800 bg-slate-900 p-3">
                    <p className="text-xs text-slate-500">{log.timestamp}</p>
                    <p
                      className={`mt-1 text-sm ${
                        log.level === "error"
                          ? "text-rose-400"
                          : log.level === "success"
                            ? "text-emerald-400"
                            : "text-cyan-300"
                      }`}
                    >
                      {log.title}
                    </p>
                    <p className="mt-1 text-sm text-slate-300">{log.message}</p>
                    {log.jsonData ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-slate-400">
                          展开查看 JSON
                        </summary>
                        <pre className="mt-2 overflow-auto rounded-md border border-slate-800 bg-slate-950 p-3 text-xs leading-5 text-slate-300">
                          {JSON.stringify(truncateJsonLongFields(log.jsonData, 500), null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="min-h-0 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <h3 className="text-base font-semibold text-white">AI 分析详情</h3>
            {!aiAnalysis ? (
              <p className="mt-3 text-sm text-slate-500">暂无 AI 分析结果</p>
            ) : (
              <div className="mt-3 h-[calc(100%-2.5rem)] space-y-4 overflow-auto pr-1">
                <div className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm text-slate-300">
                  <p>文件总数: {totalFilesCount}</p>
                  <p>代码文件: {codeFilesCount}</p>
                  <p>过滤文件: {filteredOutCount}</p>
                  <p>模型: {aiAnalysis.model}</p>
                </div>
                <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
                  <p className="text-sm text-slate-400">主要语言</p>
                  <pre className="mt-2 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-300">
                    {JSON.stringify(aiAnalysis.mainLanguages, null, 2)}
                  </pre>
                </div>
                <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
                  <p className="text-sm text-slate-400">技术栈标签</p>
                  <pre className="mt-2 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-300">
                    {JSON.stringify(aiAnalysis.techStackTags, null, 2)}
                  </pre>
                </div>
                <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
                  <p className="text-sm text-slate-400">可能入口文件</p>
                  <pre className="mt-2 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-300">
                    {JSON.stringify(aiAnalysis.possibleEntryFiles, null, 2)}
                  </pre>
                </div>
                <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
                  <p className="text-sm text-slate-400">总结</p>
                  <p className="mt-2 text-sm text-slate-300">{aiAnalysis.summary}</p>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function AnalyzeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialRepo = searchParams.get("repo") ?? "";

  const [repoUrl, setRepoUrl] = useState(initialRepo);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [error, setError] = useState("");
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [branch, setBranch] = useState("");
  const [selectedPath, setSelectedPath] = useState("");
  const [code, setCode] = useState("");
  const [codeLoading, setCodeLoading] = useState(false);
  const [totalFilesCount, setTotalFilesCount] = useState(0);
  const [codeFilesCount, setCodeFilesCount] = useState(0);
  const [filteredOutCount, setFilteredOutCount] = useState(0);
  const [aiAnalysis, setAIAnalysis] = useState<ProjectAIAnalysis | null>(null);
  const [workLogs, setWorkLogs] = useState<WorkLog[]>([]);
  const [showDetailPreview, setShowDetailPreview] = useState(false);

  const hasTree = tree.length > 0;
  const selectedLanguage = useMemo(
    () => detectLanguageByPath(selectedPath),
    [selectedPath],
  );

  const addLog = useCallback(
    (entry: Omit<WorkLog, "id" | "timestamp">) => {
      setWorkLogs((prev) => [
        {
          ...entry,
          id: Date.now() + Math.floor(Math.random() * 100000),
          timestamp: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        },
        ...prev,
      ]);
    },
    [],
  );

  const handleAnalyze = useCallback(async () => {
    setError("");
    setWorkLogs([]);

    const normalizedRepo = normalizeGitHubRepoInput(repoUrl);
    if (!normalizedRepo) {
      addLog({
        level: "error",
        title: "GitHub 地址校验",
        message: "校验失败：输入不是合法仓库地址。",
        jsonData: { repoUrl, valid: false },
      });
      setError("请输入合法仓库地址，例如 owner/repo 或 https://github.com/owner/repo");
      return;
    }

    addLog({
      level: "success",
      title: "GitHub 地址校验",
      message: "校验通过，开始请求仓库文件列表。",
      jsonData: { repoUrl, normalizedRepo, valid: true },
    });

    setAnalyzeLoading(true);
    setTree([]);
    setTotalFilesCount(0);
    setCodeFilesCount(0);
    setFilteredOutCount(0);
    setAIAnalysis(null);
    setSelectedPath("");
    setCode("");

    try {
      const response = await fetch(
        `/api/repository?repoUrl=${encodeURIComponent(normalizedRepo)}`,
      );
      const result = (await response.json()) as RepoAnalyzeResult & { message?: string };

      if (!response.ok) {
        throw new Error(result.message ?? "仓库分析失败。");
      }

      setTree(result.tree);
      setTotalFilesCount(result.totalFilesCount);
      setBranch(result.defaultBranch);
      setCodeFilesCount(result.codeFilesCount);
      setFilteredOutCount(result.filteredOutCount);
      setAIAnalysis(result.aiAnalysis);
      addLog({
        level: "info",
        title: "文件列表统计",
        message: `仓库共 ${result.totalFilesCount} 个文件。`,
        jsonData: {
          totalFilesCount: result.totalFilesCount,
          branch: result.defaultBranch,
        },
      });
      addLog({
        level: "info",
        title: "代码文件过滤",
        message: `保留 ${result.codeFilesCount} 个代码文件，过滤 ${result.filteredOutCount} 个非代码文件。`,
        jsonData: {
          codeFilesCount: result.codeFilesCount,
          filteredOutCount: result.filteredOutCount,
        },
      });
      addLog({
        level: result.aiDebug.usedFallback ? "info" : "success",
        title: "AI 分析结果",
        message: buildAIDetailMessage(result.aiDebug, result.aiAnalysis),
        jsonData: {
          debug: result.aiDebug,
          result: result.aiAnalysis,
        },
      });
      addLog({
        level: "info",
        title: "AI 调用详情",
        message: `请求包含模型、指令、文件采样列表；响应包含结构化字段(mainLanguages/techStackTags/possibleEntryFiles/summary)。当前原因码：${result.aiDebug.reason}。`,
        jsonData: {
          explanation: {
            request:
              "请求中会包含：模型参数、系统指令、用户提示词、采样后的代码文件路径列表。",
            response:
              "响应中应包含：主要语言(mainLanguages)、技术栈标签(techStackTags)、可能入口文件(possibleEntryFiles)、总结(summary)。",
          },
          request: result.aiDebug.request,
          response: result.aiDebug.response,
        },
      });
      setRepoUrl(normalizedRepo);
      router.replace(`/analyze?repo=${encodeURIComponent(normalizedRepo)}`);
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message === "fetch failed"
            ? "请求失败：前端无法连接本地服务，请确认 `npm run dev` 正在运行。"
            : requestError.message
          : "仓库分析失败。";
      setError(message);
      addLog({
        level: "error",
        title: "仓库分析请求",
        message: `请求失败：${message}`,
      });
    } finally {
      setAnalyzeLoading(false);
    }
  }, [addLog, repoUrl, router]);

  const handleSelectFile = useCallback(
    async (path: string) => {
      if (!branch) {
        return;
      }

      setSelectedPath(path);
      setCodeLoading(true);
      setCode("");
      setError("");

      try {
        const response = await fetch(
          `/api/file?repoUrl=${encodeURIComponent(repoUrl)}&path=${encodeURIComponent(path)}&branch=${encodeURIComponent(branch)}`,
        );
        const result = (await response.json()) as { path: string; content: string; message?: string };

        if (!response.ok) {
          throw new Error(result.message ?? "文件加载失败。");
        }

        setCode(result.content);
      } catch (requestError) {
        const message =
          requestError instanceof Error
            ? requestError.message === "fetch failed"
              ? "文件请求失败：前端无法连接本地服务，请确认 `npm run dev` 正在运行。"
              : requestError.message
            : "文件加载失败。";
        setError(message);
      } finally {
        setCodeLoading(false);
      }
    },
    [branch, repoUrl],
  );

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100 md:p-6">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-[1800px] grid-cols-1 gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 backdrop-blur md:grid-cols-[280px_360px_1fr] md:gap-5 md:p-5">
        <aside className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
          <p className="text-xs uppercase tracking-[0.24em] text-cyan-400">Github Review</p>
          <h1 className="mt-3 text-xl font-semibold text-white">项目分析</h1>
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/70 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-400">工作日志</p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">{workLogs.length} 条</span>
                <button
                  type="button"
                  onClick={() => setShowDetailPreview(true)}
                  className="rounded-md border border-cyan-500/60 px-2 py-0.5 text-[11px] text-cyan-300 hover:bg-cyan-500/10"
                >
                  放大
                </button>
              </div>
            </div>
            <div className="mt-2 max-h-48 space-y-2 overflow-auto pr-1">
              {!workLogs.length ? (
                <p className="text-xs text-slate-500">暂无日志，执行分析后会记录关键操作。</p>
              ) : (
                workLogs.map((log) => (
                  <div key={log.id} className="rounded-md border border-slate-800 bg-slate-900 p-2">
                    <p className="text-[11px] text-slate-500">{log.timestamp}</p>
                    <p
                      className={`mt-1 text-xs ${
                        log.level === "error"
                          ? "text-rose-400"
                          : log.level === "success"
                            ? "text-emerald-400"
                            : "text-cyan-300"
                      }`}
                    >
                      {log.title}
                    </p>
                    <p className="mt-1 text-xs text-slate-300">{log.message}</p>
                    {log.jsonData ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] text-slate-400">
                          展开查看 JSON
                        </summary>
                        <pre className="mt-2 overflow-auto rounded-md border border-slate-800 bg-slate-950 p-2 text-[11px] leading-5 text-slate-300">
                          {JSON.stringify(truncateJsonLongFields(log.jsonData, 500), null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>

          <p className="mt-2 text-sm text-slate-400">
            输入 GitHub 仓库地址，解析文件结构并查看源码。
          </p>

          <div className="mt-5 space-y-3">
            <label className="block text-xs text-slate-400" htmlFor="repo-url">
              仓库地址
            </label>
            <input
              id="repo-url"
              type="text"
              value={repoUrl}
              onChange={(event) => setRepoUrl(event.target.value)}
              placeholder="owner/repo 或 https://github.com/owner/repo"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-500"
            />
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={analyzeLoading}
              className="w-full rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
            >
              {analyzeLoading ? "分析中..." : "开始分析"}
            </button>
          </div>

          <div className="mt-6 rounded-lg border border-dashed border-slate-700 p-3 text-xs text-slate-500">
            预留区域：后续可展示依赖信息、代码统计、风险提示等。
          </div>

          {aiAnalysis ? (
            <div className="mt-4 space-y-4 rounded-lg border border-slate-800 bg-slate-950/70 p-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-cyan-400">AI 分析结果</p>
                <p className="mt-1 text-xs text-slate-500">
                  文件总数: {totalFilesCount} | 代码文件: {codeFilesCount} | 过滤: {filteredOutCount}
                </p>
                <p className="text-xs text-slate-500">
                  模型: {aiAnalysis.model}
                </p>
              </div>

              <div>
                <p className="text-xs text-slate-400">主要语言</p>
                <div className="mt-1 space-y-1 text-sm">
                  {aiAnalysis.mainLanguages.length ? (
                    aiAnalysis.mainLanguages.map((item) => (
                      <p key={item.language} className="text-slate-200">
                        {item.language} ({Math.round(item.confidence * 100)}%)
                      </p>
                    ))
                  ) : (
                    <p className="text-slate-500">暂无</p>
                  )}
                </div>
              </div>

              <div>
                <p className="text-xs text-slate-400">技术栈标签</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {aiAnalysis.techStackTags.length ? (
                    aiAnalysis.techStackTags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-200"
                      >
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-slate-500">暂无</span>
                  )}
                </div>
              </div>

              <div>
                <p className="text-xs text-slate-400">可能入口文件</p>
                <div className="mt-1 space-y-2 text-xs">
                  {aiAnalysis.possibleEntryFiles.length ? (
                    aiAnalysis.possibleEntryFiles.map((item) => (
                      <div key={item.path} className="rounded-md border border-slate-800 bg-slate-900 p-2">
                        <p className="truncate text-slate-200">{item.path}</p>
                        <p className="mt-1 text-slate-500">{item.reason}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-slate-500">暂无</p>
                  )}
                </div>
              </div>

              <p className="text-xs leading-5 text-slate-400">{aiAnalysis.summary}</p>
            </div>
          ) : null}

          {error ? <p className="mt-4 text-sm text-rose-400">{error}</p> : null}
        </aside>

        <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">文件树</h2>
            {branch ? <span className="text-xs text-slate-400">分支: {branch}</span> : null}
          </div>

          <div className="mt-4 max-h-[calc(100vh-13rem)] overflow-auto pr-1">
            {!hasTree && !analyzeLoading ? (
              <p className="text-sm text-slate-500">暂无文件结构，先执行仓库分析。</p>
            ) : null}
            {hasTree
              ? tree.map((node) => (
                  <TreeNode
                    key={node.path}
                    node={node}
                    selectedPath={selectedPath}
                    onSelectFile={handleSelectFile}
                  />
                ))
              : null}
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">代码面板</h2>
            {selectedPath ? (
              <span className="max-w-[60%] truncate text-xs text-slate-400">{selectedPath}</span>
            ) : null}
          </div>

          <div className="mt-4 max-h-[calc(100vh-13rem)] overflow-auto rounded-lg border border-slate-800 bg-slate-950/80">
            {codeLoading ? (
              <p className="p-4 text-sm text-slate-400">正在加载代码...</p>
            ) : selectedPath && code ? (
              <SyntaxHighlighter
                language={selectedLanguage}
                style={oneDark}
                customStyle={{
                  margin: 0,
                  minHeight: "100%",
                  background: "transparent",
                  fontSize: "0.84rem",
                }}
                showLineNumbers
                wrapLongLines
              >
                {code}
              </SyntaxHighlighter>
            ) : (
              <p className="p-4 text-sm text-slate-500">点击左侧文件树中的文件后展示代码。</p>
            )}
          </div>
        </section>
      </div>
      {showDetailPreview ? (
        <DetailPreviewModal
          logs={workLogs}
          aiAnalysis={aiAnalysis}
          totalFilesCount={totalFilesCount}
          codeFilesCount={codeFilesCount}
          filteredOutCount={filteredOutCount}
          onClose={() => setShowDetailPreview(false)}
        />
      ) : null}
    </main>
  );
}

export default function AnalyzePage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-950 p-4 text-slate-100" />}>
      <AnalyzeContent />
    </Suspense>
  );
}
