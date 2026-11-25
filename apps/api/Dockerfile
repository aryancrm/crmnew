# The API. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t crmnew-api .
# It runs the TypeScript with tsx (no build step, as `pnpm start` does).
# glibc (slim), not Alpine: sharp ships prebuilt binaries for it.
# NODE_ENV=production: the API needs DATABASE_URL (a Postgres) and SECRETS_KEY to start.
# Settings: apps/api/.env.production.example. Coolify: docs/DEPLOY-COOLIFY.md.

FROM node:24-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.14.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --prod --filter @2mg/api

FROM node:24-slim
ENV NODE_ENV=production \
    PORT=4100 \
    PGLITE_DIR=/data/pg
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY apps/api ./apps/api
# The 2026 chart, read by scripts/onboard-company.ts (the accounts are made from it on the server).
COPY docs/company-map.units.js ./docs/company-map.units.js
USER node
WORKDIR /app/apps/api
EXPOSE 4100
# The image has no curl or wget: the health check asks with Node itself.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4100)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/server.ts"]
