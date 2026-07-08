import Link from "next/link";

// Sprint 7 (T-75) adds a second screen — Settings — to what was a single-page
// dashboard (T-59). A plain server-rendered nav is enough: two destinations,
// no client state, keyboard/focus behavior comes for free from <a> semantics.
export function NavTabs({ active }: { active: "dashboard" | "settings" }) {
  const tabClass = (tab: "dashboard" | "settings") =>
    `rounded-lg px-3 py-1.5 text-[12.5px] font-[600] transition-colors ${
      active === tab
        ? "bg-surface-raised text-text"
        : "text-text-muted hover:text-text"
    }`;

  return (
    <nav aria-label="Dashboard sections" className="flex items-center gap-1.5">
      <Link href="/" className={tabClass("dashboard")} aria-current={active === "dashboard" ? "page" : undefined}>
        Dashboard
      </Link>
      <Link
        href="/settings"
        className={tabClass("settings")}
        aria-current={active === "settings" ? "page" : undefined}
      >
        Settings
      </Link>
    </nav>
  );
}
