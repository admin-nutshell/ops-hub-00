import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * T-19 — First integration test: ticket intake state machine (new -> triaged).
 *
 * Exercises the real staging Supabase schema (T-11) end to end:
 *   project -> tenant -> ticket(new) -> assert -> update(triaged) -> assert -> teardown.
 *
 * Auth model (TEMPORARY): connects with the service_role key, which BYPASSES RLS.
 * The login role with connectable credentials does not exist yet (that is T-12).
 * Once Vault + the login role land, this test must connect as the app role so it
 * exercises the same RLS-enforced path the triage agent uses in production.
 *
 * TODO T-12: migrate to ops_hub_app_login once Vault setup complete
 *
 * Runs only when staging credentials are present; otherwise the whole suite is
 * skipped (not failed) so CI stays green without secrets. Vitest exits 0 on a
 * fully-skipped suite.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasCreds = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

if (!hasCreds) {
  // Surfaced in CI logs so a green run is not mistaken for a passing run.
  console.warn(
    "Skipping: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — integration tests require staging credentials"
  );
}

// Unique marker so concurrent/leftover runs never collide and any orphaned
// fixture rows are trivially identifiable in staging.
const RUN_TAG = `t19-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe.skipIf(!hasCreds)("ticket state machine: new -> triaged", () => {
  let supabase: SupabaseClient;

  // IDs captured from gen_random_uuid() at insert time, used for teardown.
  let projectId: string | undefined;
  let tenantId: string | undefined;
  let ticketId: string | undefined;

  beforeAll(async () => {
    supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Seed a project, then a tenant under it. Let the DB assign UUIDs and read
    // them back via .select() rather than pre-generating them.
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .insert({ name: `${RUN_TAG}-project` })
      .select("id")
      .single();
    expect(projectError, projectError?.message).toBeNull();
    expect(project).not.toBeNull();
    projectId = project!.id;

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .insert({
        project_id: projectId,
        name: `${RUN_TAG}-tenant`,
        tier: "starter",
      })
      .select("id")
      .single();
    expect(tenantError, tenantError?.message).toBeNull();
    expect(tenant).not.toBeNull();
    tenantId = tenant!.id;
  });

  it("inserts a ticket that lands in state 'new'", async () => {
    const { data: ticket, error } = await supabase
      .from("tickets")
      .insert({
        project_id: projectId,
        tenant_id: tenantId,
        title: `${RUN_TAG}-ticket`,
        severity: "P2",
        // state intentionally omitted — schema default is 'new'.
      })
      .select("id, state")
      .single();

    expect(error, error?.message).toBeNull();
    expect(ticket).not.toBeNull();
    ticketId = ticket!.id;
    expect(ticket!.state).toBe("new");
  });

  it("confirms the ticket is readable with state 'new'", async () => {
    const { data: ticket, error } = await supabase
      .from("tickets")
      .select("id, state")
      .eq("id", ticketId)
      .single();

    expect(error, error?.message).toBeNull();
    expect(ticket).not.toBeNull();
    expect(ticket!.state).toBe("new");
  });

  it("transitions the ticket new -> triaged (what the triage agent does)", async () => {
    const { data: updated, error } = await supabase
      .from("tickets")
      .update({ state: "triaged" })
      .eq("id", ticketId)
      .select("id, state")
      .single();

    expect(error, error?.message).toBeNull();
    expect(updated).not.toBeNull();
    expect(updated!.state).toBe("triaged");
  });

  it("confirms the persisted state is 'triaged'", async () => {
    const { data: ticket, error } = await supabase
      .from("tickets")
      .select("state")
      .eq("id", ticketId)
      .single();

    expect(error, error?.message).toBeNull();
    expect(ticket!.state).toBe("triaged");
  });

  // Delete the ticket after each test if one was created, so a mid-suite failure
  // does not strand fixture rows. afterAll handles the parent rows.
  afterEach(async () => {
    if (ticketId) {
      await supabase.from("tickets").delete().eq("id", ticketId);
      ticketId = undefined;
    }
  });

  // Teardown in reverse FK order: tickets -> tenants -> projects.
  // (Ticket rows are already removed in afterEach; this is the belt-and-braces sweep.)
  afterAll(async () => {
    if (tenantId) {
      await supabase.from("tickets").delete().eq("tenant_id", tenantId);
      await supabase.from("tenants").delete().eq("id", tenantId);
    }
    if (projectId) {
      await supabase.from("projects").delete().eq("id", projectId);
    }
  });
});
