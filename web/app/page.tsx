import { Suspense } from "react";
import { TopBar } from "../components/TopBar";
import { NavTabs } from "../components/NavTabs";
import {
  SlaAttainmentCard,
  OpenTicketsCard,
  AgentCostCard,
  EvalHealthCard,
  DeflectionCard,
} from "../components/PillarCards";
import { TicketQueue } from "../components/TicketQueue";
import { PipelinePanel } from "../components/PipelinePanel";
import { SystemHealthPanel } from "../components/SystemHealthPanel";
import { PlatformIncidentsPanel } from "../components/PlatformIncidentsPanel";
import { CardSkeleton, PanelSkeleton } from "../components/Skeleton";

// Read-only MVP (T-59, Sprint 6). Every widget below is its own async Server
// Component wrapped in <Suspense> so slow/failing queries never block or
// blank the rest of the page — each streams and fails independently. Sprint 7
// (T-75) adds a Settings screen alongside this one (see NavTabs) — this page
// itself stays read-only; nothing here writes.
export default function DashboardPage() {
  return (
    <main className="mx-auto flex max-w-[1320px] flex-col gap-[30px] px-8 pt-8 pb-[72px]">
      <Suspense fallback={<div className="h-14 animate-pulse rounded-xl bg-surface" />}>
        <TopBar />
      </Suspense>

      <NavTabs active="dashboard" />

      <section className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        <Suspense fallback={<CardSkeleton />}>
          <SlaAttainmentCard />
        </Suspense>
        <Suspense fallback={<CardSkeleton />}>
          <OpenTicketsCard />
        </Suspense>
        <Suspense fallback={<CardSkeleton />}>
          <AgentCostCard />
        </Suspense>
        <Suspense fallback={<CardSkeleton />}>
          <EvalHealthCard />
        </Suspense>
        <Suspense fallback={<CardSkeleton />}>
          <DeflectionCard />
        </Suspense>
      </section>

      <section className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.7fr_1fr]">
        <Suspense fallback={<PanelSkeleton rows={6} />}>
          <TicketQueue />
        </Suspense>

        <div className="flex flex-col gap-[18px]">
          <Suspense fallback={<PanelSkeleton rows={5} />}>
            <PipelinePanel />
          </Suspense>
          <Suspense fallback={<PanelSkeleton rows={3} />}>
            <SystemHealthPanel />
          </Suspense>
          <Suspense fallback={<PanelSkeleton rows={2} />}>
            <PlatformIncidentsPanel />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
