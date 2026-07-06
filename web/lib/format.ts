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
