import { getRepositoryTreeByUrl } from "@/lib/github";
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
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "仓库分析失败，请稍后重试。";
    return NextResponse.json({ message }, { status: 500 });
  }
}
