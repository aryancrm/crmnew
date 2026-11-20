# The API. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t crmnew-api .
# It runs the TypeScript with tsx (no build step, as `pnpm start` does).
# glibc (slim), not Alpine: sharp and PGlite ship prebuilt binaries for it.

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
# Only used when DATABASE_URL is empty (the embedded database) or MAIL_SINK is on.
RUN mkdir -p /data/pg /app/.data && chown -R node:node /data /app/.data
USER node
WORKDIR /app/apps/api
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4100)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/server.ts"]
