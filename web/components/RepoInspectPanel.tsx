import { loadRepoSnapshotView } from "../lib/queries";
import { ErrorNote, PendingNote } from "./ErrorNote";
import { RepoInspectTrigger } from "./RepoInspectTrigger";

// S1 of the ops-hub reboot's product-domain proof: one panel that dispatches
// a real GitHub App read (src/inngest/repo-inspect.ts) and displays the
// result. Deliberately narrow per the task's own scope guardrail — file tree
// + last-10-commits ONLY, no findings/PR/etc. UI (that's S2+).
export async function RepoInspectPanel() {
  let view: Awaited<ReturnType<typeof loadRepoSnapshotView>>;
  try {
    view = await loadRepoSnapshotView();
  } catch (error) {
    return <ErrorNote label="Repo inspection" error={error} />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <div className="flex items-start justify-between gap-4 border-b border-border-soft px-[22px] py-[17px]">
        <div>
          <h2 className="text-[13px] font-[650]">Repo inspection (pilot)</h2>
          <p className="mt-1 max-w-[520px] text-xs text-text-muted">
            A point-in-time snapshot pulled live through the GitHub App connection, not a live
            view — the file tree and commits below are only as fresh as the last inspection&apos;s
            timestamp.
          </p>
        </div>
        <RepoInspectTrigger view={view} />
      </div>

      {view.status === "schema_not_ready" ? (
        <div className="px-[22px] py-5">
          <PendingNote
            title="Not available in this environment yet"
            message="The product-domain / repo_snapshots database migrations haven't been applied here yet. Once they are, this panel starts working with no code change."
          />
        </div>
      ) : view.status === "no_connection" ? (
        <div className="px-[22px] py-5">
          <PendingNote
            title="No repo connected"
            message="This product has no active repo_connections row yet."
          />
        </div>
      ) : view.status === "no_snapshot" ? (
        <div className="px-[22px] py-5 text-[12.5px] leading-[1.6] text-text-muted">
          Connected to <span className="font-mono text-text">{view.repoFullName}</span> (branch{" "}
          <span className="font-mono text-text">{view.defaultBranch}</span>) — no snapshot fetched
          yet. Click &ldquo;Inspect repo&rdquo; above to pull the real file tree and recent commits.
        </div>
      ) : (
        <div className="flex flex-col gap-5 px-[22px] py-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
            <span className="font-mono text-text">{view.repoFullName}</span>
            <span>
              branch <span className="font-mono text-text">{view.defaultBranch}</span>
            </span>
            <span>
              fetched <span className="text-text">{new Date(view.fetchedAt).toLocaleString()}</span>
            </span>
          </div>

          <div>
            <h3 className="mb-2 text-[11px] font-[650] uppercase tracking-[0.06em] text-text-faint">
              File tree — {view.treeEntryCount} {view.treeEntryCount === 1 ? "entry" : "entries"}
              {view.treeTruncated ? " (truncated for storage — repo has more)" : ""}
            </h3>
            {view.tree.length === 0 ? (
              <div className="text-xs text-text-muted">Empty tree.</div>
            ) : (
              <ul
                tabIndex={0}
                aria-label={`File tree for ${view.repoFullName}`}
                className="max-h-72 overflow-y-auto rounded-lg border border-border-soft bg-surface-raised p-2.5 font-mono text-[11.5px] leading-[1.7] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {view.tree.map((entry) => (
                  <li key={entry.path} className="flex gap-2 truncate text-text-muted">
                    <span className="w-9 shrink-0 text-text-faint">
                      {entry.type === "tree" ? "dir" : entry.type === "blob" ? "file" : entry.type}
                    </span>
                    <span className="truncate">{entry.path}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-[11px] font-[650] uppercase tracking-[0.06em] text-text-faint">
              Last {view.commits.length} {view.commits.length === 1 ? "commit" : "commits"}
            </h3>
            {view.commits.length === 0 ? (
              <div className="text-xs text-text-muted">No commits returned.</div>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {view.commits.map((c) => (
                  <li key={c.sha} className="border-b border-border-soft pb-2.5 last:border-none last:pb-0">
                    <div className="text-[12.5px] text-text">{c.message || "(no commit message)"}</div>
                    <div className="mt-0.5 font-mono text-[10.5px] text-text-faint">
                      {c.sha.slice(0, 7)} · {c.author ?? "unknown author"} ·{" "}
                      {c.date ? new Date(c.date).toLocaleString() : "unknown date"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
