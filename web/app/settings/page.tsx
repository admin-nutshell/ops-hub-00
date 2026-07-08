import { Suspense } from "react";
import { TopBar } from "../../components/TopBar";
import { NavTabs } from "../../components/NavTabs";
import { PanelSkeleton } from "../../components/Skeleton";
import { ModelRoutingSection } from "../../components/settings/ModelRoutingSection";
import { SlaSection } from "../../components/settings/SlaSection";
import { FeatureFlagsSection } from "../../components/settings/FeatureFlagsSection";

// Force dynamic rendering. Unlike "/" (which Next.js infers is dynamic only
// as a side effect of TopBar's `fetch(..., { cache: "no-store" })` call in
// lib/health.ts), every read on this page goes through `pg` directly with no
// `fetch()` call anywhere — Next.js has no signal to avoid static
// prerendering, and DID statically prerender this page at build time in
// testing (baking a build-time DB snapshot into the HTML — a stale "no
// override set" / stale flag states served to every viewer forever, since a
// static page is generated once and doesn't re-run these queries). Explicit
// > implicit: this page must run its reads on every request.
export const dynamic = "force-dynamic";

// Settings / write area (Sprint 7, T-75, ADR-0006). Sits behind the SAME
// Traefik/Coolify Basic Auth perimeter as "/" (T-57) — nothing app-level
// gates this route differently, by design (FQ-66/T-77: shared credential,
// `audit_log.actor = "dashboard"`).
//
// Three independent sections, each its own async Server Component (read) +
// Client Component (the actual form) — same "one failing widget never blanks
// the page" discipline as the read-only dashboard (T-59's ErrorNote), now
// extended to writes: every submit shows real success/error feedback, never
// an optimistic UI (ADR-0006 "honesty over polish").
//
// Two of the three surfaces (model routing, SLA) depend on T-72's migration
// being applied to the live DB (FQ-67, pending as of this writing). Reads
// degrade gracefully either way (see getModelRoutingOverrides — a missing
// table reads as "no overrides"), so this page always renders; a write
// attempt against an unapplied surface surfaces T-74's 503
// SchemaNotReadyError, translated to a plain-language note by
// web/lib/apiClient.ts's friendlyWriteError. Feature flags have no such
// dependency — that table and its write policy already existed before
// Sprint 7.
export default function SettingsPage() {
  return (
    <main className="mx-auto flex max-w-[1320px] flex-col gap-[30px] px-8 pt-8 pb-[72px]">
      <Suspense fallback={<div className="h-14 animate-pulse rounded-xl bg-surface" />}>
        <TopBar />
      </Suspense>

      <NavTabs active="settings" />

      <div className="flex flex-col gap-5">
        <Suspense fallback={<PanelSkeleton rows={5} />}>
          <ModelRoutingSection />
        </Suspense>
        <Suspense fallback={<PanelSkeleton rows={3} />}>
          <SlaSection />
        </Suspense>
        <Suspense fallback={<PanelSkeleton rows={4} />}>
          <FeatureFlagsSection />
        </Suspense>
      </div>
    </main>
  );
}
