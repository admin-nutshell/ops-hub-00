// eslint-config-next + FlatCompat currently crashes under eslint 9.39 /
// Next 16.2 (circular-structure error while formatting a validation error in
// eslint-config-next's legacy shareable config) — a known brittle spot on
// this bleeding-edge combo, not something worth fighting for a Sprint-6 MVP.
// Falls back to the same typescript-eslint baseline the root package uses
// (eslint.config.js), which catches the real correctness issues; Next's own
// `next build` type-checks the app on every build as a second gate.
import tseslint from "typescript-eslint";

export default tseslint.config(
  // next.config.js is CommonJS Node tooling (not app source), same reasoning
  // as the root package's eslint.config.js excluding itself.
  { ignores: [".next/**", "node_modules/**", "next.config.js"] },
  ...tseslint.configs.recommended
);
