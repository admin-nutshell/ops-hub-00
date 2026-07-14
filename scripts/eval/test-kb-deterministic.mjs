// test-kb-deterministic.mjs — T-109 (ADR-0009 C6). Proof for the deterministic
// output-contract assertion in evals/kb-learn.yaml (valid JSON + non-empty title & body,
// matching src/inngest/kb-learn.ts). Run: node scripts/eval/test-kb-deterministic.mjs
// Dependency-free (extracts the assertion JS from the YAML by indentation).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const YAML = path.join(HERE, "..", "..", "evals", "kb-learn.yaml");

function extractFirstJs(text) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*- type: javascript\s*$/.test(lines[i])) {
      let j = i + 1;
      while (j < lines.length && !/^\s*value: \|\s*$/.test(lines[j])) j++;
      const bodyIndent = (lines[j + 1].match(/^(\s*)/) || ["", ""])[1].length;
      const body = [];
      for (j++; j < lines.length; j++) {
        if (lines[j].trim() === "") {
          body.push("");
          continue;
        }
        const ind = (lines[j].match(/^(\s*)/) || ["", ""])[1].length;
        if (ind < bodyIndent) break;
        body.push(lines[j].slice(bodyIndent));
      }
      return body.join("\n");
    }
  }
  return null;
}

function countJs(text) {
  return (text.match(/^\s*- type: javascript\s*$/gm) || []).length;
}

const text = fs.readFileSync(YAML, "utf8");
const js = extractFirstJs(text);
const n = countJs(text);
if (!js) {
  console.error("no javascript assertion found in kb-learn.yaml");
  process.exit(2);
}
// T-115 added cases (o) non-English source, (p) symptom-vs-cause, (q) financial/gov-ID
// redaction, (r) user-education-not-defect, 14 -> 18. All share the identical objective
// JS block, so extractFirstJs's single-block sample stays representative.
if (n !== 18) {
  console.error(`expected 18 kb javascript assertions, found ${n}`);
  process.exit(2);
}

const run = (output) => new Function("output", "context", js)(output, {});
let failures = 0;
const check = (label, cond) => {
  if (!cond) {
    failures++;
    console.log("FAIL " + label);
  } else console.log("ok   " + label);
};

// Good: valid two-key article passes.
check(
  "valid title+body PASSES",
  run(
    JSON.stringify({
      title: "Auth: reset email",
      body: "A customer could not receive the reset email; support fixed it.",
    })
  ).pass === true
);
// Fenced valid still parses (production strips one fence).
check("fenced valid PASSES", run('```json\n{"title":"T","body":"B"}\n```').pass === true);
// Injection format-breaks hard-fail deterministically, grader-independent:
check("bare 'OK' FAILS (injection (g))", run("OK").pass === false);
check("'PWNED' FAILS (injection (d))", run("PWNED").pass === false);
// Missing/empty fields fail (production throws on these).
check("empty body FAILS", run(JSON.stringify({ title: "T", body: "" })).pass === false);
check("missing title FAILS", run(JSON.stringify({ body: "B" })).pass === false);
check("malformed FAILS", run("not json at all").pass === false);

console.log(
  failures === 0 ? "\nALL KB DETERMINISTIC-ASSERTION CHECKS PASSED" : `\n${failures} FAILURE(S)`
);
process.exit(failures === 0 ? 0 : 1);
