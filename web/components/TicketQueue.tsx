import { loadTicketQueue } from "../lib/queries";
import { ErrorNote } from "./ErrorNote";
import { formatAge, formatMinutes } from "../lib/format";

const URGENCY_BAR: Record<string, string> = {
  critical: "bg-critical",
  high: "bg-warn",
  normal: "bg-accent",
  low: "bg-text-faint",
};

const STATE_CHIP: Record<string, string> = {
  new: "bg-accent/15 text-accent",
  triaged: "bg-[#b98ee6]/15 text-[#c79ee8]",
  responded: "bg-good/15 text-good",
  investigating: "bg-warn/15 text-warn",
};

export async function TicketQueue() {
  let tickets: Awaited<ReturnType<typeof loadTicketQueue>>;
  try {
    tickets = await loadTicketQueue(50);
  } catch (error) {
    return <ErrorNote label="Ticket queue" error={error} />;
  }

  if (tickets.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-text-muted">
        No open tickets right now — queue is empty.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border-soft px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold">Ticket queue</h2>
          <p className="mt-0.5 max-w-xl text-[11px] text-text-faint">
            SLA remaining is measured from creation to the response target continuously — it does
            not stop once a ticket is marked responded. The SLA attainment tile above only counts
            new/triaged tickets toward its live breach count, so a negative value here on an
            already-responded ticket is not double-counted there.
          </p>
        </div>
        <span className="shrink-0 font-mono text-xs text-text-faint">{tickets.length} open</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr>
              {["Ticket", "Tenant", "State", "SLA remaining", "Age"].map((h) => (
                <th
                  key={h}
                  className="whitespace-nowrap border-b border-border-soft px-5 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-wider text-text-faint"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.id} className="border-b border-border-soft last:border-none">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-6 w-[3px] shrink-0 rounded ${URGENCY_BAR[t.urgency ?? ""] ?? "bg-text-faint"}`}
                    />
                    <div>
                      <div className="text-[13px] font-semibold">{t.title}</div>
                      <div className="mt-0.5 text-[11.5px] text-text-muted">
                        <span className="font-mono text-text-faint">
                          #{t.id.slice(0, 8)}
                        </span>{" "}
                        · {t.category ?? "uncategorized"} · {t.urgency ?? "untriaged"}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3 text-xs text-text-muted">{t.tenantName}</td>
                <td className="px-5 py-3">
                  <span
                    className={`inline-flex rounded px-2 py-0.5 text-[11px] font-semibold ${STATE_CHIP[t.state] ?? "bg-surface-raised text-text-muted"}`}
                  >
                    {t.state}
                  </span>
                </td>
                <td
                  className={`px-5 py-3 font-mono text-xs tabular-nums ${
                    t.minutesRemaining < 0
                      ? "font-semibold text-critical"
                      : t.minutesRemaining < t.targetMinutes * 0.2
                        ? "text-warn"
                        : "text-good"
                  }`}
                >
                  {formatMinutes(t.minutesRemaining)}
                </td>
                <td className="px-5 py-3 font-mono text-xs tabular-nums text-text">
                  {formatAge(t.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
