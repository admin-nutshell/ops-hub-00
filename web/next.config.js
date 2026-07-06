/** @type {import('next').NextConfig} */
const path = require("path");

const nextConfig = {
  reactStrictMode: true,
  // Self-contained production image for Coolify (see web/Dockerfile) — bundles
  // the ../src/metrics imports at build time, no monorepo checkout needed at
  // runtime.
  output: "standalone",
  // This app imports query functions directly from ../src/metrics (the root
  // ops-hub package) so there is exactly ONE place dashboard SQL lives — see
  // src/metrics/dashboard.ts. outputFileTracingRoot points at the monorepo
  // root so Next's file tracing (standalone builds) includes those files.
  outputFileTracingRoot: path.join(__dirname, ".."),
  // `pg` does dynamic requires for optional native bindings — keep it as a
  // real Node dependency instead of letting the bundler try to bundle it.
  serverExternalPackages: ["pg"],
};

module.exports = nextConfig;
