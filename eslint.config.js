const tseslint = require("typescript-eslint");
const eslintConfigPrettier = require("eslint-config-prettier");

module.exports = tseslint.config(
  // This CommonJS config file is Node tooling, not app source — keep it out of TS linting.
  { ignores: ["dist/**", "node_modules/**", "eslint.config.js"] },
  ...tseslint.configs.recommended,
  eslintConfigPrettier
);
