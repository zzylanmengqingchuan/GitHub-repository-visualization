export type GitHubRepoRef = {
  owner: string;
  repo: string;
};

const GITHUB_REPO_URL_PATTERN =
  /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s?#]+)(?:\/|$)/i;

export function parseGitHubRepoUrl(url: string): GitHubRepoRef | null {
  const normalizedUrl = url.trim();
  const match = normalizedUrl.match(GITHUB_REPO_URL_PATTERN);

  if (!match) {
    return null;
  }

  const owner = match[1]?.trim();
  const repo = match[2]?.replace(/\.git$/i, "").trim();

  if (!owner || !repo) {
    return null;
  }

  return { owner, repo };
}

export function isValidGitHubRepoUrl(url: string): boolean {
  return parseGitHubRepoUrl(url) !== null;
}
