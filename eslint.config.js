const tseslint = require("typescript-eslint");
const eslintConfigPrettier = require("eslint-config-prettier");

module.exports = tseslint.config(
  // This CommonJS config file is Node tooling, not app source — keep it out of TS linting.
  // web/** is its own pnpm workspace package (the T-59 Next.js dashboard) with its own
  // `next lint` + `tsc --noEmit` — it is not part of this root tsconfig's project, so the
  // root ESLint/TS project service cannot parse its JSX/TSX correctly; lint it via
  // `pnpm --filter ops-hub-dashboard lint` instead.
  { ignores: ["dist/**", "node_modules/**", "eslint.config.js", ".claude/**", "web/**"] },
  ...tseslint.configs.recommended,
  eslintConfigPrettier
);
