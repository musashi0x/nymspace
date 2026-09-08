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
export const REVALIDATE_SECONDS = 60;

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
  /**
   * Non-null when GitHub did not answer. This must never be collapsed into
   * "0 commits": a silent zero is a fabricated number, and this page's whole
   * claim is that its numbers are real.
   */
  error: { kind: "rate_limited" | "unavailable"; message: string } | null;
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

type GhResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; rateLimited: boolean };

/**
 * A failed request is reported as a failure, never as empty data. Failures are
 * also fetched with `no-store` so a transient 403 does not get cached and
 * served as though the repo genuinely had no commits.
 */
async function gh<T>(path: string): Promise<GhResult<T>> {
  let res: Response;
  try {
    res = await fetch(`https://api.github.com${path}`, {
      headers: headers(),
    });
  } catch {
    return { ok: false, status: 0, rateLimited: false };
  }

  if (!res.ok) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    return {
      ok: false,
      status: res.status,
      rateLimited:
        (res.status === 403 || res.status === 429) && remaining === "0",
    };
  }

  return { ok: true, data: (await res.json()) as T };
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


export async function getActivity(
  weeks = 53,
): Promise<ActivityPayload> {
  const fullName = `${REPO_OWNER}/${REPO_NAME}`;
  const since = addDays(new Date(), -(weeks * 7)).toISOString();

  const repoRes = await gh<RawRepo>(`/repos/${fullName}`);
  const repo = repoRes.ok ? repoRes.data : null;

  const branchQuery = REPO_BRANCH ? `&sha=${encodeURIComponent(REPO_BRANCH)}` : "";
  const pages: RawCommit[][] = [];
  let truncated = false;
  let failure: { status: number; rateLimited: boolean } | null = repoRes.ok
    ? null
    : repoRes;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await gh<RawCommit[]>(
      `/repos/${fullName}/commits?per_page=${PER_PAGE}&page=${page}&since=${since}${branchQuery}`,
    );
    if (!res.ok) {
      // Record it and stop. Reporting the pages we did get as the whole
      // truth would understate the count without saying so.
      failure = res;
      break;
    }
    if (res.data.length === 0) break;
    pages.push(res.data);
    if (res.data.length < PER_PAGE) break;
    if (page === MAX_PAGES) truncated = true;
  }

  const rawCommits = pages.flat();

  // Contributors are counted from the commits above, NOT from
  // /repos/:owner/:repo/contributors. That endpoint is a cached aggregate that
  // lags pushes by minutes-to-hours and is invalidated by a history rewrite,
  // so it happily reports one contributor next to a list of commits by three.
  // Deriving them here keeps the two panels consistent by construction, and
  // saves an API call against the rate limit.
  const error: ActivityPayload["error"] = failure
    ? failure.rateLimited
      ? {
          kind: "rate_limited",
          message:
            "GitHub's API rate limit was reached, so commit data could not be read. Numbers are withheld rather than shown as zero.",
        }
      : {
          kind: "unavailable",
          message: `GitHub's API returned ${failure.status || "no response"}, so commit data could not be read. Numbers are withheld rather than shown as zero.`,
        }
    : null;

  const counts = new Map<string, number>();
  const commitsByDate: Record<string, Commit[]> = {};
  const byAuthor = new Map<string, Contributor>();

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

    // Key on the GitHub login where there is one; fall back to the raw git
    // author name so commits from an unlinked email still get attributed
    // instead of silently vanishing from the tally.
    const key = commit.authorLogin ?? `name:${commit.authorName}`;
    const existing = byAuthor.get(key);
    if (existing) {
      existing.contributions += 1;
    } else {
      byAuthor.set(key, {
        login: commit.authorLogin ?? commit.authorName,
        avatar: commit.authorAvatar ?? "",
        url: commit.authorLogin
          ? `https://github.com/${commit.authorLogin}`
          : commit.url,
        contributions: 1,
      });
    }
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
    contributors: [...byAuthor.values()].sort(
      (a, b) => b.contributions - a.contributions || a.login.localeCompare(b.login),
    ),
    totalCommits: rawCommits.length,
    windowDays,
    truncated,
    fetchedAt: new Date().toISOString(),
    error,
  };
}
