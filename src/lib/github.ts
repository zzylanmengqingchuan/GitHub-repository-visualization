import { parseGitHubRepoUrl } from "@/lib/github-url";
import type { FileTreeNode } from "@/types/repository";

type GitHubRepoResponse = {
  default_branch: string;
};

type GitHubTreeEntry = {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
  url: string;
};

type GitHubTreeResponse = {
  sha: string;
  tree: GitHubTreeEntry[];
  truncated: boolean;
};

type GitHubContentResponse = {
  type: "file" | "dir";
  content?: string;
  encoding?: string;
};

const GITHUB_API_BASE = "https://api.github.com";

function getGitHubHeaders(): HeadersInit {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
}

async function githubRequest<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: getGitHubHeaders(),
      cache: "no-store",
    });
  } catch {
    throw new Error(
      "服务端无法连接 GitHub API，请检查网络或代理设置后重试。",
    );
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("仓库或文件不存在，请检查地址与路径。");
    }

    if (response.status === 403) {
      throw new Error("GitHub API 访问受限，请稍后重试。");
    }

    throw new Error(`GitHub API 请求失败（${response.status}）。`);
  }

  return (await response.json()) as T;
}

function sortNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  const sorted = [...nodes].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "dir" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return sorted.map((node) => {
    if (node.type === "dir" && node.children) {
      return {
        ...node,
        children: sortNodes(node.children),
      };
    }
    return node;
  });
}

function buildFileTree(entries: GitHubTreeEntry[]): FileTreeNode[] {
  const root: FileTreeNode = {
    name: "",
    path: "",
    type: "dir",
    children: [],
  };

  for (const entry of entries) {
    if (!entry.path || (entry.type !== "blob" && entry.type !== "tree")) {
      continue;
    }

    const segments = entry.path.split("/").filter(Boolean);
    let current = root;

    segments.forEach((segment, index) => {
      const isLeaf = index === segments.length - 1;
      const nodeType: FileTreeNode["type"] =
        isLeaf && entry.type === "blob" ? "file" : "dir";

      if (!current.children) {
        current.children = [];
      }

      const existing = current.children.find(
        (node) => node.name === segment && node.type === nodeType,
      );

      if (existing) {
        current = existing;
        return;
      }

      const nextPath = segments.slice(0, index + 1).join("/");
      const newNode: FileTreeNode = {
        name: segment,
        path: nextPath,
        type: nodeType,
        ...(nodeType === "file" ? { sha: entry.sha } : { children: [] }),
      };

      current.children.push(newNode);
      current = newNode;
    });
  }

  return sortNodes(root.children ?? []);
}

export async function getRepositoryTreeByUrl(repoUrl: string): Promise<{
  owner: string;
  repo: string;
  defaultBranch: string;
  tree: FileTreeNode[];
}> {
  const parsed = parseGitHubRepoUrl(repoUrl);
  if (!parsed) {
    throw new Error("请输入合法的 GitHub 仓库地址。");
  }

  const { owner, repo } = parsed;

  const repoData = await githubRequest<GitHubRepoResponse>(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}`,
  );

  const defaultBranch = repoData.default_branch;

  const treeData = await githubRequest<GitHubTreeResponse>(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`,
  );

  return {
    owner,
    repo,
    defaultBranch,
    tree: buildFileTree(treeData.tree),
  };
}

export async function getRepositoryFileByUrl({
  repoUrl,
  filePath,
  branch,
}: {
  repoUrl: string;
  filePath: string;
  branch: string;
}): Promise<{ path: string; content: string }> {
  const parsed = parseGitHubRepoUrl(repoUrl);
  if (!parsed) {
    throw new Error("请输入合法的 GitHub 仓库地址。");
  }

  const { owner, repo } = parsed;
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");

  const contentData = await githubRequest<GitHubContentResponse | GitHubContentResponse[]>(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
  );

  if (Array.isArray(contentData) || contentData.type !== "file") {
    throw new Error("当前路径不是文件。");
  }

  const encodedContent = contentData.content ?? "";

  if (!encodedContent) {
    return { path: filePath, content: "" };
  }

  if (contentData.encoding === "base64") {
    return {
      path: filePath,
      content: Buffer.from(encodedContent, "base64").toString("utf-8"),
    };
  }

  return { path: filePath, content: encodedContent };
}
