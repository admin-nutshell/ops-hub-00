# Ops Hub — dashboard (T-59). Built from the MONOREPO ROOT as build context
# (not web/), because this app imports src/metrics/* directly — see
# web/lib/queries.ts. Build with:
#   docker build -f web/Dockerfile -t ops-hub-dashboard .
# (run from the repo root, not from inside web/).

FROM node:20-slim AS deps
WORKDIR /app
RUN npm install -g pnpm@10
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json ./web/package.json
RUN CI=1 pnpm install --frozen-lockfile

FROM deps AS build
WORKDIR /app
COPY tsconfig*.json ./
COPY src/ ./src/
COPY web/ ./web/
RUN pnpm --filter ops-hub-dashboard build

# Runtime: Next.js standalone output — self-contained, no monorepo checkout needed.
FROM node:20-slim AS runtime
WORKDIR /app
# HOSTNAME must be 0.0.0.0 -- Next.js standalone's server.js binds to
# process.env.HOSTNAME, and Docker sets HOSTNAME=<container-id> by default
# in every container. Without this override the server binds to the
# container's own hostname interface instead of all interfaces, so Traefik
# (or any reverse proxy on the docker network) gets connection-refused ->
# 502, even though the container itself is healthy and "Ready". Confirmed
# live 2026-07-06 (T-68): ops-hub-dashboard-staging 502'd from Traefik while
# its own container logs showed "Ready in 0ms" listening on the container ID
# hostname. Matches Next.js's own official with-docker example, which sets
# this for the same reason.
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup appuser
COPY --from=build /app/web/.next/standalone ./
COPY --from=build /app/web/.next/static ./web/.next/static
COPY --from=build /app/web/public ./web/public
USER appuser
EXPOSE 3000
CMD ["node", "web/server.js"]
