import { Inngest } from "inngest";

// Distinct per environment so ops-hub-staging and ops-hub-prod register as
// separate Inngest apps — sharing an id let a staging sync silently repoint
// prod's cron dispatch (T-54(B), confirmed incident 2026-07-03/04). Only set
// INNGEST_APP_ID on ops-hub-staging; prod relies on this default so its
// existing Inngest registration is untouched by this change.
export const inngest = new Inngest({ id: process.env.INNGEST_APP_ID ?? "ops-hub" });
