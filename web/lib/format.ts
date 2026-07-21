export function formatMinutes(totalMinutes: number): string {
  const sign = totalMinutes < 0 ? "-" : "";
  const abs = Math.abs(Math.round(totalMinutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatAge(dateIso: string): string {
  const ms = Date.now() - new Date(dateIso).getTime();
  const minutes = Math.max(0, Math.round(ms / 60000));
  return formatMinutes(minutes);
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

// Human "how long ago" phrasing (e.g. "3h ago", "2d ago") — distinct from
// formatAge above, which returns an HH:MM SLA-countdown-style duration.
// Used by VulnFindingsPanel to show how long ago a finding was detected;
// coarsens to the largest whole unit (minutes -> hours -> days) rather than
// a precise duration, since this is a glance-value, not a countdown.
export function formatRelativeAge(dateIso: string): string {
  const ms = Math.max(0, Date.now() - new Date(dateIso).getTime());
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
