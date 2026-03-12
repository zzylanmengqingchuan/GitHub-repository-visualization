"use client";

import { normalizeGitHubRepoInput } from "@/lib/github-url";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function Home() {
  const router = useRouter();
  const [repoUrl, setRepoUrl] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const normalizedRepo = normalizeGitHubRepoInput(repoUrl);
    if (!normalizedRepo) {
      setError("请输入合法仓库地址，例如 owner/repo 或 https://github.com/owner/repo");
      return;
    }

    router.push(`/analyze?repo=${encodeURIComponent(normalizedRepo)}`);
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.18),transparent_45%)]" />
      <div className="relative w-full max-w-3xl rounded-3xl border border-slate-800 bg-slate-900/85 p-8 shadow-[0_30px_100px_-30px_rgba(6,182,212,0.5)] backdrop-blur md:p-12">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-cyan-400/15 text-xl text-cyan-300">
            GR
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-cyan-400">Code Insight</p>
            <h1 className="text-2xl font-semibold text-white md:text-3xl">GitHub 项目代码分析可视化</h1>
          </div>
        </div>

        <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-400 md:text-base">
          输入 GitHub 仓库地址，自动解析项目文件树，并在分析页中按文件查看高亮代码内容。
        </p>

        <form onSubmit={handleSubmit} className="mt-7 space-y-3">
          <input
            type="text"
            value={repoUrl}
            onChange={(event) => setRepoUrl(event.target.value)}
            placeholder="owner/repo 或 https://github.com/owner/repo"
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-500 md:text-base"
          />
          <button
            type="submit"
            className="inline-flex rounded-xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 md:text-base"
          >
            开始分析
          </button>
        </form>

        {error ? <p className="mt-3 text-sm text-rose-400">{error}</p> : null}
      </div>
    </main>
  );
}
