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

type JsDelivrFileNode = {
  type: "file" | "directory";
  name: string;
  files?: JsDelivrFileNode[];
};

const GITHUB_API_BASE = "https://api.github.com";
const JSDELIVR_DATA_API_BASE = "https://data.jsdelivr.com/v1";
const JSDELIVR_CDN_BASE = "https://cdn.jsdelivr.net";
const BRANCH_CANDIDATES = ["main", "master"] as const;

// 请求超时时间（毫秒）
const REQUEST_TIMEOUT = 30000;

// 创建带超时的 fetch 请求
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout = REQUEST_TIMEOUT,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

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
    response = await fetchWithTimeout(url, {
      headers: getGitHubHeaders(),
      cache: "no-store",
    });
  } catch (error) {
    // 检查是否是超时错误
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        "GitHub API 请求超时，请检查网络连接或稍后重试。",
      );
    }
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

function extractBranchFromUrl(repoUrl: string): string | null {
  const matched = repoUrl.match(/\/tree\/([^/?#]+)/i);
  return matched?.[1]?.trim() || null;
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

function flattenJsDelivrFiles(
  files: JsDelivrFileNode[],
  basePath = "",
): GitHubTreeEntry[] {
  const entries: GitHubTreeEntry[] = [];

  for (const file of files) {
    const currentPath = basePath ? `${basePath}/${file.name}` : file.name;

    if (file.type === "directory") {
      entries.push({
        path: currentPath,
        mode: "040000",
        type: "tree",
        sha: "",
        url: "",
      });

      if (file.files?.length) {
        entries.push(...flattenJsDelivrFiles(file.files, currentPath));
      }
      continue;
    }

    entries.push({
      path: currentPath,
      mode: "100644",
      type: "blob",
      sha: "",
      url: "",
    });
  }

  return entries;
}

async function getRepositoryTreeByJsDelivr({
  owner,
  repo,
  preferredBranch,
}: {
  owner: string;
  repo: string;
  preferredBranch?: string | null;
}): Promise<{ defaultBranch: string; tree: FileTreeNode[] }> {
  const candidates = [preferredBranch, ...BRANCH_CANDIDATES].filter(
    (item): item is string => Boolean(item),
  );
  const uniqueCandidates = [...new Set(candidates)];

  for (const branch of uniqueCandidates) {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        `${JSDELIVR_DATA_API_BASE}/package/gh/${owner}/${repo}@${encodeURIComponent(branch)}`,
        { cache: "no-store" },
      );
    } catch (error) {
      // 检查是否是超时错误
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("镜像服务请求超时，请检查网络连接或稍后重试。");
      }
      throw new Error("镜像服务连接失败，请检查网络或代理设置。");
    }

    if (response.status === 404) {
      continue;
    }

    if (!response.ok) {
      const text = await response.text();
      if (text.includes("Package size exceeded")) {
        throw new Error(
          "镜像模式无法处理超大仓库，请配置 GitHub API 网络后重试。",
        );
      }
      continue;
    }

    const data = (await response.json()) as {
      files?: JsDelivrFileNode[];
    };

    const files = data.files ?? [];
    const entries = flattenJsDelivrFiles(files);
    return {
      defaultBranch: branch,
      tree: buildFileTree(entries),
    };
  }

  try {
    const packageMetaResp = await fetchWithTimeout(
      `${JSDELIVR_DATA_API_BASE}/package/gh/${owner}/${repo}`,
      { cache: "no-store" },
    );

    if (packageMetaResp.status === 404) {
      throw new Error(
        "镜像未找到该仓库。该仓库可能不存在、为私有仓库，或仓库名不正确。",
      );
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("镜像服务连接失败，请检查网络或代理设置。");
  }

  throw new Error(
    "无法通过镜像获取仓库文件树，请确认仓库地址正确，并在 URL 中指定分支（如 /tree/main）。",
  );
}

async function getRepositoryFileByJsDelivr({
  owner,
  repo,
  branch,
  filePath,
}: {
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
}): Promise<{ path: string; content: string }> {
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${JSDELIVR_CDN_BASE}/gh/${owner}/${repo}@${encodeURIComponent(branch)}/${encodedPath}`,
      { cache: "no-store" },
    );
  } catch (error) {
    // 检查是否是超时错误
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("镜像文件请求超时，请检查网络连接或稍后重试。");
    }
    throw new Error("镜像文件连接失败，请检查网络或代理设置。");
  }

  if (!response.ok) {
    throw new Error("镜像文件读取失败，请检查文件路径或分支。");
  }

  return {
    path: filePath,
    content: await response.text(),
  };
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
  const preferredBranch = extractBranchFromUrl(repoUrl);

  try {
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
  } catch (githubError) {
    const message =
      githubError instanceof Error ? githubError.message : "GitHub API 请求失败。";
    const canFallback =
      message.includes("无法连接 GitHub API") || message.includes("访问受限");

    if (!canFallback) {
      throw githubError;
    }

    const mirrorResult = await getRepositoryTreeByJsDelivr({
      owner,
      repo,
      preferredBranch,
    });
    return {
      owner,
      repo,
      defaultBranch: mirrorResult.defaultBranch,
      tree: mirrorResult.tree,
    };
  }
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

  try {
    const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");

    const contentData = await githubRequest<
      GitHubContentResponse | GitHubContentResponse[]
    >(
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
  } catch (githubError) {
    const message =
      githubError instanceof Error ? githubError.message : "GitHub API 请求失败。";
    const canFallback =
      message.includes("无法连接 GitHub API") || message.includes("访问受限");

    if (!canFallback) {
      throw githubError;
    }

    return getRepositoryFileByJsDelivr({
      owner,
      repo,
      branch,
      filePath,
    });
  }
}
