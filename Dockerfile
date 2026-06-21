# Stage 1: dependencies
FROM node:20-slim AS deps
WORKDIR /app
RUN npm install -g pnpm@10
COPY package.json pnpm-lock.yaml ./
# CI=1 prevents the prepare script from running `git config core.hooksPath`
# (no .git dir in Docker build context — fails without this flag)
RUN CI=1 pnpm install --frozen-lockfile --prod=false

# Stage 2: build
FROM deps AS build
COPY tsconfig*.json ./
COPY src/ ./src/
RUN pnpm build

# Stage 3: runtime (minimal)
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000
# Non-root user
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup appuser
COPY --from=build /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
USER appuser
EXPOSE 3000
CMD ["node", "dist/index.js"]
