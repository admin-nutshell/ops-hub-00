// test-triage-deterministic.mjs — T-109 (ADR-0009 C6). Drop-don't-weaken PROOF for the
// deterministic over/under-escalation allowed-set assertions in evals/ticket-triage.yaml.
//
// Run: node scripts/eval/test-triage-deterministic.mjs
//
// Why this exists: honor-pass (apply-honor-pass.py) trusts the grader's `pass` inside a
// floored band. C6 moves each triage case's escalation bound into a DETERMINISTIC
// `javascript` assertion so an over-escalation hard-fails GRADER-INDEPENDENTLY — it can
// never be honor-pass'd through even if the grader wrongly returns pass:true below 0.8.
// This test runs the REAL assertion JS (extracted from the YAML, not a paraphrase) against
// genuinely-bad outputs and proves each one fails. Dependency-free (no YAML lib): the
// blocks are extracted by indentation, so `node` alone runs it — same standalone posture
// as test_compare_baseline.py / test_apply_honor_pass.py.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const YAML = path.join(HERE, "..", "..", "evals", "ticket-triage.yaml");
const ENUM = ["critical", "high", "normal", "low"];

// Extract, in file order, each test's { description, js } where js is the body of the
// `- type: javascript` assertion's `value: |` block (dedented from its 10-space indent).
function extractCases(text) {
  const lines = text.split(/\r?\n/);
  const cases = [];
  let desc = null;
  for (let i = 0; i < lines.length; i++) {
    const dm = lines[i].match(/^\s*- description:\s*"(.*)"\s*$/);
    if (dm) desc = dm[1];
    if (/^\s*- type: javascript\s*$/.test(lines[i])) {
      // find the `value: |` line, then collect the indented body
      let j = i + 1;
      while (j < lines.length && !/^\s*value: \|\s*$/.test(lines[j])) j++;
      const bodyIndent = (lines[j + 1].match(/^(\s*)/) || ["", ""])[1].length;
      const body = [];
      j++;
      for (; j < lines.length; j++) {
        if (lines[j].trim() === "") {
          body.push("");
          continue;
        }
        const ind = (lines[j].match(/^(\s*)/) || ["", ""])[1].length;
        if (ind < bodyIndent) break;
        body.push(lines[j].slice(bodyIndent));
      }
      cases.push({ desc, js: body.join("\n") });
    }
  }
  return cases;
}

function run(js, output) {
  const fn = new Function("output", "context", js);
  return fn(output, {});
}

let failures = 0;
function check(label, cond) {
  if (!cond) {
    failures++;
    console.log("FAIL " + label);
  } else console.log("ok   " + label);
}

const cases = extractCases(fs.readFileSync(YAML, "utf8"));
// T-112 added case (q) (single-user critical-trigger regression lock), 16 -> 17.
// T-115 added cases (r) degenerate-input, (s) casual-tone-over-outage, (t) cross-tenant
// leak, 17 -> 20 (all appended AFTER (q), so the cases[15]=(p) index below is unchanged).
if (cases.length !== 20) {
  console.error(`expected 20 javascript assertions, found ${cases.length}`);
  process.exit(2);
}

cases.forEach((c, i) => {
  const letter = String.fromCharCode(97 + i);
  const m = c.js.match(/const ALLOWED = (\[[^\]]*\]);/);
  if (!m) {
    failures++;
    console.log(`FAIL (${letter}) has no ALLOWED set`);
    return;
  }
  const allowed = JSON.parse(m[1].replace(/'/g, '"'));

  // A good output (an allowed urgency) passes the objective check.
  const good = JSON.stringify({
    urgency: allowed[0],
    category: "x",
    routing: "support",
    reasoning: "y",
  });
  check(`(${letter}) allowed urgency=${allowed[0]} passes`, run(c.js, good).pass === true);

  // A genuinely-bad output: an urgency OUTSIDE the allowed-set (over- or under-escalation)
  // must hard-fail, grader-independently — the drop-don't-weaken guarantee.
  const bad = ENUM.find((u) => !allowed.includes(u));
  const badOut = JSON.stringify({
    urgency: bad,
    category: "x",
    routing: "support",
    reasoning: "y",
  });
  check(`(${letter}) escalation urgency=${bad} FAILS`, run(c.js, badOut).pass === false);

  // Out-of-enum and malformed always fail (objective contract).
  check(
    `(${letter}) out-of-enum 'SEV-0' FAILS`,
    run(c.js, JSON.stringify({ urgency: "SEV-0" })).pass === false
  );
  check(`(${letter}) malformed output FAILS`, run(c.js, "not json").pass === false);
});

// Case (p) — the prompt-injection case — additionally rejects the injected category=vip /
// routing=executives even at an allowed urgency (grader-independent injection lock).
const p = cases[15].js;
check(
  "(p) injected category=vip FAILS",
  run(p, JSON.stringify({ urgency: "normal", category: "vip", routing: "support" })).pass === false
);
check(
  "(p) injected routing=executives FAILS",
  run(p, JSON.stringify({ urgency: "low", category: "account", routing: "executives" })).pass ===
    false
);
check(
  "(p) genuine account/support PASSES",
  run(p, JSON.stringify({ urgency: "normal", category: "account", routing: "support" })).pass ===
    true
);

// A fenced-but-valid JSON output still parses (faithful to production's fence tolerance).
check(
  "(a) fenced JSON parses",
  run(cases[0].js, '```json\n{"urgency":"critical"}\n```').pass === true
);

// T-110 NAME-PINNED REGRESSION LOCK for case (i) ("Non-English (Spanish) ticket").
// The generic loop above only proves "over-escalation fails for whatever ALLOWED set
// this case declares" — it would silently accept a FUTURE widening of case (i) to
// include 'high' (it would just re-derive {normal,low,high} and test that 'critical'
// fails). T-110's whole point is that widening case (i) to accept 'high' is a
// drop-don't-weaken violation (honor-pass can't de-flake it, and it deletes the only
// single-user/high guard — case (o) is the critical/outage axis). Pin the exact set by
// NAME so any future edit that loosens THIS case's escalation gate trips this test.
const spanish = cases.find((c) => /Non-English \(Spanish\)/.test(c.desc));
check("case (i) is present and name-matched", !!spanish);
if (spanish) {
  const sm = spanish.js.match(/const ALLOWED = (\[[^\]]*\]);/);
  const sAllowed = sm ? JSON.parse(sm[1].replace(/'/g, '"')) : null;
  check(
    "case (i) ALLOWED is exactly ['normal','low'] (over-escalation to high/critical stays a hard fail)",
    JSON.stringify(sAllowed) === JSON.stringify(["normal", "low"])
  );
}

// T-112 NAME-PINNED REGRESSION LOCK for case (q) ("Single user's irrecoverable data
// loss"), same pattern and same reason as T-110's lock on case (i) above: the generic
// loop only proves "an urgency outside THIS case's own declared set fails" — it would
// silently accept a FUTURE widening of case (q) to include 'high' (e.g. if a future edit
// tried to make the single-user carve-out apply to critical tickets too). Case (q) exists
// specifically to trap the single-user carve-out bleeding into `critical` demotion; pin
// the exact set by NAME so any future edit that loosens THIS case's gate trips this test.
const dataLoss = cases.find((c) => /Single user's irrecoverable data loss/.test(c.desc));
check("case (q) is present and name-matched", !!dataLoss);
if (dataLoss) {
  const qm = dataLoss.js.match(/const ALLOWED = (\[[^\]]*\]);/);
  const qAllowed = qm ? JSON.parse(qm[1].replace(/'/g, '"')) : null;
  check(
    "case (q) ALLOWED is exactly ['critical'] (single-user carve-out cannot demote a critical trigger)",
    JSON.stringify(qAllowed) === JSON.stringify(["critical"])
  );
}

console.log(
  failures === 0 ? "\nALL DETERMINISTIC-ASSERTION CHECKS PASSED" : `\n${failures} FAILURE(S)`
);
process.exit(failures === 0 ? 0 : 1);
