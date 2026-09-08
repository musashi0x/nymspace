import "server-only";

/**
 * Repo-level commit activity, pulled straight from the public GitHub API.
 *
 * The point of this module is verifiability: every number rendered on the
 * landing page traces back to a commit SHA that anyone can open on GitHub.
 * Nothing here is seeded, sampled, or synthesised.
 */

export const REPO_OWNER = process.env.GITHUB_OWNER ?? "musashi0x";
export const REPO_NAME = process.env.GITHUB_REPO ?? "nymspace";
export const REPO_BRANCH = process.env.GITHUB_BRANCH ?? "";

/** Cap on pages of 100 commits. Keeps us inside the unauthenticated rate limit. */
const MAX_PAGES = 5;
const PER_PAGE = 100;
/** Seconds before the route re-fetches from GitHub. */
export const REVALIDATE_SECONDS = 300;

export type ContributionLevel = 0 | 1 | 2 | 3 | 4;

export type Contribution = {
  date: string;
  count: number;
  level: ContributionLevel;
};

export type Commit = {
  sha: string;
  shortSha: string;
  message: string;
  /** First line only — what you'd see in `git log --oneline`. */
  subject: string;
  authorName: string;
  authorLogin: string | null;
  authorAvatar: string | null;
  date: string;
  url: string;
  verified: boolean;
};

export type Contributor = {
  login: string;
  avatar: string;
  url: string;
  contributions: number;
};

export type ActivityPayload = {
  repo: {
    owner: string;
    name: string;
    fullName: string;
    url: string;
    description: string | null;
    defaultBranch: string;
    pushedAt: string | null;
    stars: number;
  };
  contributions: Contribution[];
  commitsByDate: Record<string, Commit[]>;
  contributors: Contributor[];
  totalCommits: number;
  windowDays: number;
  /** True when we hit MAX_PAGES — older commits exist beyond what's shown. */
  truncated: boolean;
  fetchedAt: string;
  rateLimited: boolean;
};

function headers(): HeadersInit {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ens-project-activity",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function gh<T>(path: string): Promise<T | null> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: headers(),
    next: { revalidate: REVALIDATE_SECONDS },
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

/** YYYY-MM-DD in UTC, so the grid doesn't shift with the viewer's timezone. */
function isoDay(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input;
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/**
 * Builds a Sunday-aligned grid covering `weeks` weeks and ending on the
 * Saturday of the current week, matching GitHub's own contribution calendar.
 * Days with no commits are present with count 0 — the grid must be dense or
 * the week columns shear.
 */
function buildGrid(
  counts: Map<string, number>,
  weeks: number,
): { contributions: Contribution[]; windowDays: number } {
  const today = new Date();
  const end = addDays(today, 6 - today.getUTCDay());
  const start = addDays(end, -(weeks * 7 - 1));

  const nonZero = [...counts.values()].filter((n) => n > 0).sort((a, b) => a - b);
  const quantile = (q: number) =>
    nonZero.length ? nonZero[Math.floor((nonZero.length - 1) * q)] : 0;
  const t1 = Math.max(1, quantile(0.25));
  const t2 = Math.max(t1 + 1, quantile(0.55));
  const t3 = Math.max(t2 + 1, quantile(0.8));

  const level = (count: number): ContributionLevel => {
    if (count <= 0) return 0;
    if (count <= t1) return 1;
    if (count <= t2) return 2;
    if (count <= t3) return 3;
    return 4;
  };

  const contributions: Contribution[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    const date = isoDay(cursor);
    const count = counts.get(date) ?? 0;
    contributions.push({ date, count, level: level(count) });
  }

  return { contributions, windowDays: contributions.length };
}

type RawRepo = {
  description: string | null;
  default_branch: string;
  pushed_at: string | null;
  stargazers_count: number;
};

type RawCommit = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
    verification?: { verified: boolean };
  };
  author: { login: string; avatar_url: string } | null;
};

type RawContributor = {
  login: string;
  avatar_url: string;
  html_url: string;
  contributions: number;
  type: string;
};

export async function getActivity(
  weeks = 53,
): Promise<ActivityPayload> {
  const fullName = `${REPO_OWNER}/${REPO_NAME}`;
  const since = addDays(new Date(), -(weeks * 7)).toISOString();

  const repo = await gh<RawRepo>(`/repos/${fullName}`);

  const branchQuery = REPO_BRANCH ? `&sha=${encodeURIComponent(REPO_BRANCH)}` : "";
  const pages: RawCommit[][] = [];
  let truncated = false;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await gh<RawCommit[]>(
      `/repos/${fullName}/commits?per_page=${PER_PAGE}&page=${page}&since=${since}${branchQuery}`,
    );
    if (!batch || batch.length === 0) break;
    pages.push(batch);
    if (batch.length < PER_PAGE) break;
    if (page === MAX_PAGES) truncated = true;
  }

  const rawCommits = pages.flat();
  const contributors =
    (await gh<RawContributor[]>(`/repos/${fullName}/contributors?per_page=20`)) ??
    [];

  const counts = new Map<string, number>();
  const commitsByDate: Record<string, Commit[]> = {};

  for (const raw of rawCommits) {
    const authored = raw.commit.author?.date;
    if (!authored) continue;
    const date = isoDay(authored);

    counts.set(date, (counts.get(date) ?? 0) + 1);

    const message = raw.commit.message ?? "";
    const commit: Commit = {
      sha: raw.sha,
      shortSha: raw.sha.slice(0, 7),
      message,
      subject: message.split("\n")[0] ?? "",
      authorName: raw.commit.author?.name ?? "unknown",
      authorLogin: raw.author?.login ?? null,
      authorAvatar: raw.author?.avatar_url ?? null,
      date: authored,
      url: raw.html_url,
      verified: raw.commit.verification?.verified ?? false,
    };

    (commitsByDate[date] ??= []).push(commit);
  }

  // newest first within each day
  for (const list of Object.values(commitsByDate)) {
    list.sort((a, b) => b.date.localeCompare(a.date));
  }

  const { contributions, windowDays } = buildGrid(counts, weeks);

  return {
    repo: {
      owner: REPO_OWNER,
      name: REPO_NAME,
      fullName,
      url: `https://github.com/${fullName}`,
      description: repo?.description ?? null,
      defaultBranch: repo?.default_branch ?? "main",
      pushedAt: repo?.pushed_at ?? null,
      stars: repo?.stargazers_count ?? 0,
    },
    contributions,
    commitsByDate,
    contributors: contributors
      .filter((c) => c.type !== "Bot")
      .map((c) => ({
        login: c.login,
        avatar: c.avatar_url,
        url: c.html_url,
        contributions: c.contributions,
      })),
    totalCommits: rawCommits.length,
    windowDays,
    truncated,
    fetchedAt: new Date().toISOString(),
    rateLimited: repo === null && rawCommits.length === 0,
  };
}
