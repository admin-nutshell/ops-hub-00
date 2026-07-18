# Founder setup: create the "ops-hub-connector" GitHub App (S1, read-only pilot)

**Written by:** Security Lead — Sprint S1 of the ops-hub reboot
**Date:** 2026-07-17
**Time needed:** ~10 minutes of clicking, same style as the Coolify domain steps you did for FQ-59/FQ-63
**Why only you:** GitHub does not let an agent create a GitHub App — creating one requires a human logged into the `admin-nutshell` organization clicking through GitHub's own screens. Everything before and after this is handled.

---

## What this is, in plain language

The rebooted ops-hub needs a way to *look at* the code of the products it will watch over — starting with one pilot repo: **`admin-nutshell/web-app-tns-06`** (the TTS app itself). GitHub's safe way to grant that is a "GitHub App": a named identity we control, with an exact list of what it may and may not do.

**This sprint the App is read-only.** It will be able to *read* code, pull requests, check results, and security alerts on the one repo you install it on — and nothing else. It cannot change code, cannot merge anything, cannot touch settings. If we ever want it to do more (e.g., open fix PRs in a later sprint), that will come back to you as a separate, explicit permission upgrade.

A machine-readable copy of the exact settings lives at `docs/integrations/github-app-manifest-s1.json` — you don't need to open it, but it's the reference if any field below is unclear.

---

## Step 1 — Open the App creation page

1. Log into GitHub as yourself.
2. Go to: `https://github.com/organizations/admin-nutshell/settings/apps/new`
   - If that link doesn't land you on a form, go to the `admin-nutshell` organization → **Settings** → (left sidebar, near the bottom) **Developer settings** → **GitHub Apps** → **New GitHub App**.

**What you'll see:** a long form titled "Register new GitHub App". Most fields stay blank or on their defaults — the list below covers every field you need to touch.

> **If your screen offers a "create from manifest" or "import" option:** some org setups show a way to create an App from a JSON manifest. If you see it, you can paste the entire contents of `docs/integrations/github-app-manifest-s1.json` and GitHub will pre-fill the form — then just review that it matches Step 2 and click Create. If you don't see that option (most likely), fill the form manually per Step 2 — same result either way.

## Step 2 — Fill in the form

Only touch these fields; leave everything else as-is:

1. **GitHub App name:** `ops-hub-connector`
   - I checked today (2026-07-17): this name is free on GitHub. App names are unique across all of GitHub, so if by the time you do this it says "name already taken", use `its-ops-hub-connector` instead and tell me you did.
2. **Homepage URL:** `https://ops-hub-staging.inatechshell.ca`
   - This is just a label GitHub requires; nothing connects to it.
3. **Callback URL:** leave **blank**. (Ops-hub has no login-with-GitHub feature — nothing to call back to.)
4. **Webhook → "Active" checkbox:** **UNCHECK it.**
   - This is deliberate, not an oversight: this sprint nothing in ops-hub listens for GitHub's push notifications yet, so we switch them off entirely. Unchecking it also makes the "Webhook URL" field optional, so you can leave that blank too.
5. **Permissions → Repository permissions:** set exactly these five to **Read-only**, and leave every other row at "No access":

   | Permission row | Set to |
   |---|---|
   | Contents | Read-only |
   | Pull requests | Read-only |
   | Checks | Read-only |
   | Commit statuses | Read-only |
   | Code scanning alerts / Security events *(the row may be named either way)* | Read-only |

   Do **not** grant anything under "Organization permissions" or "Account permissions" — all stay "No access".
6. **Subscribe to events:** since the webhook is off, this section will be empty/grayed out. Nothing to do.
7. **"Where can this GitHub App be installed?":** choose **"Only on this account"** (i.e., only `admin-nutshell`). This keeps the App private to us.
8. Click the green **Create GitHub App** button.

**What you'll see next:** the App's own settings page, with a green success banner. Stay on this page for Step 3.

## Step 3 — Write down the App ID

Near the top of the App's settings page (under "About") you'll see **App ID:** followed by a number (e.g., `App ID: 1234567`). That number is not a secret — note it down, you'll hand it to me at the end.

## Step 4 — Generate and save the private key (the one sensitive item)

1. On the same settings page, scroll down to **Private keys** and click **Generate a private key**.
2. Your browser will download a file ending in `.pem` (e.g., `ops-hub-connector.2026-07-17.private-key.pem`).
3. **This file is the App's password — treat it like one:**
   - Move it into a private folder on your computer (e.g., a `github-app-keys` folder in your Documents, or wherever you keep the FQ-59-era credential files).
   - **Do NOT paste its contents into chat, email, or any document. Do NOT commit it to any repo.** I only need to know *where the file is*, never what's inside it.
   - A follow-up task will move it into proper secret storage — for now it just needs to exist somewhere safe that you can point to.

## Step 5 — Install the App on ONLY the pilot repo

1. Still on the App's settings page, click **Install App** in the left sidebar.
2. You'll see the `admin-nutshell` organization with an **Install** button — click it.
3. **Important — the least-privilege part:** on the next screen choose **"Only select repositories"** (NOT "All repositories"), then in the repository picker select only:
   - `web-app-tns-06`
4. Click **Install**.

This means even in the worst case, the App can only ever see that one repo. Adding more products later is a deliberate, one-repo-at-a-time decision — never a blanket grant.

## Step 6 — Grab the Installation ID

After clicking Install, look at your browser's address bar. It will read something like:

```
https://github.com/organizations/admin-nutshell/settings/installations/87654321
```

The number at the end (`87654321` in this example) is the **Installation ID** — note it down. (If you navigated away and lost it: org **Settings** → **GitHub Apps** (under Third-party access / Integrations) → **Configure** next to ops-hub-connector → the number is in that page's address bar.)

---

## Step 7 — Tell me when done: the three things to hand back

Reply here (or in `WORK.md`) with exactly these three items:

1. **App ID** — the number from Step 3 (not secret, fine in chat).
2. **Installation ID** — the number from Step 6 (not secret, fine in chat).
3. **Where the `.pem` file is saved** — the folder path on your computer (e.g., `Documents\github-app-keys\ops-hub-connector.pem`). **Just the location — never the file's contents.** A follow-up task will handle moving it into secret storage securely.

That's the whole handoff. Once I have those three, S1's read-only repo connection gets wired up with zero further action from you.

---

## For the record: why these permissions and not others (Security Lead notes)

*You can stop reading here — this section is the audit trail, not instructions.*

- **`contents: read`** — the minimum needed to list the pilot repo's file tree and commits (S1's demo). **`contents: write` is deliberately NOT requested** — no fix-author agent exists yet; write access is a later-sprint escalation that will come back to the founder explicitly.
- **`pull_requests: read`** — S1 only *reads* PR state for the dashboard; opening PRs (write) is S3+ and will be a separate permission upgrade.
- **`checks: read` / `statuses: read`** — lets later sprints read the product repo's own CI results as an independent gate; read-only is sufficient indefinitely for that purpose.
- **`security_events: read`** — enables S2's ingestion of Dependabot/code-scanning alerts as vulnerability findings; read-only by nature.
- **Explicitly excluded, indefinitely, per the project's autonomy model:** `administration`, `workflows` (write), and anything touching branch protection. Repo settings and branch-protection rules stay founder-only — the platform must never be able to weaken the rules that gate its own future write access.
- **No webhook events (`default_events: []`)** — deliberate S1 scope boundary: no webhook consumer is built this sprint, and an unused webhook endpoint would be pure attack surface. When a consumer exists (S2+), enabling the webhook is a small, reviewable change on the App's settings page.
- **Private App (`public: false`), installed on one repo only** — per-installation isolation and revocation; uninstalling from the one repo severs all access instantly, which is also the S1 rollback plan.
