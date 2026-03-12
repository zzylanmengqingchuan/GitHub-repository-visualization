import { getRepositoryTreeByUrl } from "@/lib/github";
import {
  analyzeProjectFromFileList,
  extractCodeFilePaths,
} from "@/lib/repository-analysis";
import { isValidGitHubRepoUrl } from "@/lib/github-url";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const repoUrl = request.nextUrl.searchParams.get("repoUrl")?.trim() ?? "";

  if (!isValidGitHubRepoUrl(repoUrl)) {
    return NextResponse.json(
      { message: "请输入合法的 GitHub 仓库地址。" },
      { status: 400 },
    );
  }

  try {
    const result = await getRepositoryTreeByUrl(repoUrl);
    const codeFiles = extractCodeFilePaths(result.tree);
    const aiAnalysis = await analyzeProjectFromFileList(repoUrl, codeFiles);

    return NextResponse.json({
      ...result,
      codeFilesCount: codeFiles.length,
      aiAnalysis,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "仓库分析失败，请稍后重试。";
    const status = message.includes("不存在")
      ? 404
      : message.includes("访问受限")
        ? 403
        : message.includes("无法连接 GitHub API")
          ? 502
          : 500;
    return NextResponse.json({ message }, { status });
  }
}
