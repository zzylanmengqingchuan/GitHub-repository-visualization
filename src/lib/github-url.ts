export type GitHubRepoRef = {
  owner: string;
  repo: string;
};

const GITHUB_REPO_URL_PATTERN =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s?#]+)(?:\/|$)/i;
const GITHUB_REPO_SHORTHAND_PATTERN = /^([^/\s]+)\/([^/\s?#]+)$/i;

export function parseGitHubRepoUrl(url: string): GitHubRepoRef | null {
  const normalizedUrl = url.trim();
  const match =
    normalizedUrl.match(GITHUB_REPO_URL_PATTERN) ??
    normalizedUrl.match(GITHUB_REPO_SHORTHAND_PATTERN);

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

export function normalizeGitHubRepoInput(input: string): string | null {
  const parsed = parseGitHubRepoUrl(input);
  if (!parsed) {
    return null;
  }
  return `https://github.com/${parsed.owner}/${parsed.repo}`;
}
