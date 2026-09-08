import { CommitActivity } from "@/components/commit-activity";
import { getActivity } from "@/lib/github";

export const revalidate = 300;

const LAYERS = [
  {
    tag: "identity",
    name: "ENS",
    status: "chosen first",
    body: "A name is an owned NFT, a key/value store, a pointer, and hierarchical. Pick it first and you inherit ownership, addressing, namespacing and versioning in one decision.",
  },
  {
    tag: "data",
    name: "content-addressed storage",
    status: "selected by the test",
    body: "A CID or root hash sits in a record. Resolving the name hands you the data pointer. No index to maintain, no gateway that owns the mapping.",
  },
  {
    tag: "execution",
    name: "invocation + settlement",
    status: "selected by the test",
    body: "A record naming the endpoint, contract or payee makes the name the invocation handle and the settlement handle at once.",
  },
];

export default async function Home() {
  const data = await getActivity();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-20 px-6 py-16 sm:py-24">
      <header className="flex flex-col gap-8">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          nymspace
        </p>

        <blockquote className="max-w-3xl border-l-2 border-[#39d353] pl-5 text-2xl font-medium leading-snug tracking-tight text-foreground sm:text-3xl">
          I would make ENS the identity layer, then choose partners that
          naturally become the data and execution layers.
        </blockquote>

        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Most stacks get built bottom-up: pick a chain, pick a database, pick a
          compute provider, then bolt on names at the end as a cosmetic alias.
          That ordering is backwards. Naming is not decoration — it is the thing
          every other layer has to agree on. So pick identity first, and let
          everything downstream be reachable{" "}
          <em className="not-italic text-foreground">from a name</em>.
        </p>
      </header>

      <section className="flex flex-col gap-6">
        <h2 className="text-sm font-medium">The layering</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {LAYERS.map((layer) => (
            <article
              key={layer.tag}
              className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card p-5"
            >
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                  {layer.tag}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground/70">
                  {layer.status}
                </span>
              </div>
              <h3 className="text-base text-foreground">{layer.name}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {layer.body}
              </p>
            </article>
          ))}
        </div>

        <div className="rounded-2xl border border-border/60 bg-card p-5">
          <p className="mb-2 text-sm font-medium">The selection test</p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Once identity is fixed, partners are not chosen by taste. They are
            chosen by one question:{" "}
            <strong className="font-medium text-foreground">
              can an ENS record point directly at it, with no glue?
            </strong>{" "}
            If it needs a separate registry keyed on something other than the
            name, the name is decoration again — reject it.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Build log</h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Every square below is real commit data read live from the GitHub API
            at request time — not a screenshot, not a seeded number. Click a day
            to read that day&rsquo;s commits, then open any SHA to check it
            yourself. The raw payload is at{" "}
            <a
              href="/api/activity"
              className="font-mono underline underline-offset-2 hover:text-foreground"
            >
              /api/activity
            </a>
            .
          </p>
        </div>

        {data.rateLimited ? (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5 text-sm text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">
              GitHub API unavailable
            </p>
            <p>
              The unauthenticated API allows 60 requests per hour. Set{" "}
              <code className="font-mono text-xs">GITHUB_TOKEN</code> in{" "}
              <code className="font-mono text-xs">.env.local</code> to raise the
              limit to 5,000/hr, then reload.
            </p>
          </div>
        ) : (
          <CommitActivity data={data} />
        )}

        {data.truncated && (
          <p className="text-xs text-muted-foreground">
            Showing the most recent {data.totalCommits} commits. Older history
            exists beyond this window.
          </p>
        )}
      </section>

      <footer className="flex flex-col gap-2 border-t border-border/60 pt-6 text-xs text-muted-foreground">
        <p>
          Tracking{" "}
          <a
            href={data.repo.url}
            target="_blank"
            rel="noreferrer"
            className="font-mono underline underline-offset-2 hover:text-foreground"
          >
            {data.repo.fullName}
          </a>
          {" · "}
          data fetched {new Date(data.fetchedAt).toISOString().slice(0, 19)}Z
          {" · "}
          revalidates every 5 min
        </p>
        <p>
          Point this at a different repo with{" "}
          <code className="font-mono">GITHUB_OWNER</code> /{" "}
          <code className="font-mono">GITHUB_REPO</code>.
        </p>
      </footer>
    </main>
  );
}
