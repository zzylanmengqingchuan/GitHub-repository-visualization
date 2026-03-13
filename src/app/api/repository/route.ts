import { getRepositoryTreeByUrl } from "@/lib/github";
import { analyzeProjectEntryFiles } from "@/lib/entry-analysis";
import {
  analyzeProjectFromFileList,
  countAllFiles,
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
    const totalFilesCount = countAllFiles(result.tree);
    const codeFiles = extractCodeFilePaths(result.tree);
    const aiResult = await analyzeProjectFromFileList(repoUrl, codeFiles);
    const entryResult = await analyzeProjectEntryFiles({
      repoUrl,
      branch: result.defaultBranch,
      projectSummary: aiResult.analysis.summary,
      mainLanguages: aiResult.analysis.mainLanguages,
      possibleEntryFiles: aiResult.analysis.possibleEntryFiles,
    });

    return NextResponse.json({
      ...result,
      totalFilesCount,
      codeFilesCount: codeFiles.length,
      filteredOutCount: Math.max(0, totalFilesCount - codeFiles.length),
      aiAnalysis: aiResult.analysis,
      aiDebug: aiResult.debug,
      entryAnalysis: entryResult.analysis,
      entryDebug: entryResult.debug,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "仓库分析失败，请稍后重试。";

    let status = 500;
    if (message.includes("不存在")) {
      status = 404;
    } else if (message.includes("访问受限")) {
      status = 403;
    } else if (
      message.includes("无法连接 GitHub API") ||
      message.includes("镜像服务连接失败") ||
      message.includes("请求超时")
    ) {
      status = 502;
    }

    console.error("[API /repository] Error:", message);
    return NextResponse.json({ message }, { status });
  }
}
