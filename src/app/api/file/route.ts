import { getRepositoryFileByUrl } from "@/lib/github";
import { isValidGitHubRepoUrl } from "@/lib/github-url";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const repoUrl = request.nextUrl.searchParams.get("repoUrl")?.trim() ?? "";
  const filePath = request.nextUrl.searchParams.get("path")?.trim() ?? "";
  const branch = request.nextUrl.searchParams.get("branch")?.trim() ?? "";

  if (!isValidGitHubRepoUrl(repoUrl)) {
    return NextResponse.json(
      { message: "请输入合法的 GitHub 仓库地址。" },
      { status: 400 },
    );
  }

  if (!filePath) {
    return NextResponse.json({ message: "缺少文件路径参数。" }, { status: 400 });
  }

  if (!branch) {
    return NextResponse.json({ message: "缺少分支参数。" }, { status: 400 });
  }

  try {
    const file = await getRepositoryFileByUrl({ repoUrl, filePath, branch });
    return NextResponse.json(file);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "文件读取失败，请稍后重试。";
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
