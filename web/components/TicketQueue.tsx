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
  new: "bg-accent/[0.14] text-accent-text",
  triaged: "bg-triaged/[0.13] text-triaged-text",
  responded: "bg-good/[0.12] text-good",
  investigating: "bg-warn/[0.12] text-warn",
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
      <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-text-muted shadow-card">
        No open tickets right now — queue is empty.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-border-soft px-[22px] py-[17px]">
        <div>
          <h2 className="text-[13px] font-[650]">Ticket queue</h2>
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
        <table className="w-full min-w-[660px] border-collapse text-sm">
          <thead>
            <tr>
              {["Ticket", "Tenant", "State", "SLA remaining", "Age"].map((h) => (
                <th
                  key={h}
                  className="border-b border-border-soft px-[22px] py-[11px] text-left text-[10.5px] font-[650] tracking-[0.06em] text-text-faint uppercase whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <tr
                key={t.id}
                className="border-b border-border-soft last:border-none hover:bg-surface-raised"
              >
                <td className="px-[22px] py-[13px]">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`h-7 w-[3px] shrink-0 rounded-[2px] ${URGENCY_BAR[t.urgency ?? ""] ?? "bg-text-faint"}`}
                    />
                    <div>
                      <div className="text-[13px] font-semibold">{t.title}</div>
                      <div className="mt-0.5 text-[11.5px] text-text-muted">
                        <span className="font-mono text-[11px] text-text-faint">
                          #{t.id.slice(0, 8)}
                        </span>{" "}
                        · {t.category ?? "uncategorized"} · {t.urgency ?? "untriaged"}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-[22px] py-[13px] text-xs text-text-muted">{t.tenantName}</td>
                <td className="px-[22px] py-[13px]">
                  <span
                    className={`inline-flex rounded-md px-2.5 py-[3px] text-[11px] font-[650] whitespace-nowrap ${STATE_CHIP[t.state] ?? "bg-surface-raised text-text-muted"}`}
                  >
                    {t.state}
                  </span>
                </td>
                <td
                  className={`px-[22px] py-[13px] font-mono text-xs tabular-nums ${
                    t.minutesRemaining < 0
                      ? "font-[650] text-critical"
                      : t.minutesRemaining < t.targetMinutes * 0.2
                        ? "text-warn"
                        : "text-good"
                  }`}
                >
                  {formatMinutes(t.minutesRemaining)}
                </td>
                <td className="px-[22px] py-[13px] font-mono text-xs tabular-nums text-text">
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
