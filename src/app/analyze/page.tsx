"use client";

import { isValidGitHubRepoUrl } from "@/lib/github-url";
import type { ProjectAIAnalysis } from "@/types/analysis";
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
  codeFilesCount: number;
  aiAnalysis: ProjectAIAnalysis;
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
  const [codeFilesCount, setCodeFilesCount] = useState(0);
  const [aiAnalysis, setAIAnalysis] = useState<ProjectAIAnalysis | null>(null);

  const hasTree = tree.length > 0;
  const selectedLanguage = useMemo(
    () => detectLanguageByPath(selectedPath),
    [selectedPath],
  );

  const handleAnalyze = useCallback(async () => {
    setError("");

    if (!isValidGitHubRepoUrl(repoUrl)) {
      setError("请输入合法的 GitHub 仓库地址，例如：https://github.com/vercel/next.js");
      return;
    }

    setAnalyzeLoading(true);
    setTree([]);
    setCodeFilesCount(0);
    setAIAnalysis(null);
    setSelectedPath("");
    setCode("");

    try {
      const response = await fetch(
        `/api/repository?repoUrl=${encodeURIComponent(repoUrl)}`,
      );
      const result = (await response.json()) as RepoAnalyzeResult & { message?: string };

      if (!response.ok) {
        throw new Error(result.message ?? "仓库分析失败。");
      }

      setTree(result.tree);
      setBranch(result.defaultBranch);
      setCodeFilesCount(result.codeFilesCount);
      setAIAnalysis(result.aiAnalysis);
      router.replace(`/analyze?repo=${encodeURIComponent(repoUrl)}`);
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : "仓库分析失败。";
      setError(message);
    } finally {
      setAnalyzeLoading(false);
    }
  }, [repoUrl, router]);

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
          requestError instanceof Error ? requestError.message : "文件加载失败。";
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
          <p className="mt-2 text-sm text-slate-400">
            输入 GitHub 仓库地址，解析文件结构并查看源码。
          </p>

          <div className="mt-5 space-y-3">
            <label className="block text-xs text-slate-400" htmlFor="repo-url">
              仓库地址
            </label>
            <input
              id="repo-url"
              type="url"
              value={repoUrl}
              onChange={(event) => setRepoUrl(event.target.value)}
              placeholder="https://github.com/owner/repo"
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
                  代码文件数: {codeFilesCount} | 模型: {aiAnalysis.model}
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
