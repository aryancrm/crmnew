# The web app: built with Vite, served by nginx, which passes /api and /webhooks to the API
# so the sign-in cookie stays first-party (as Vercel's rewrites do). Build from the repo root:
#   docker build -f apps/web/Dockerfile -t crmnew-web .
# At run time API_UPSTREAM says where the API is (default http://api:4100).

FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.14.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @2mg/web...
# The web app reads the API's types (workspace package @2mg/api), so both sources are needed.
COPY apps/api ./apps/api
COPY apps/web ./apps/web
RUN pnpm --filter @2mg/web build

FROM nginx:1.29-alpine
ENV API_UPSTREAM=http://api:4100
# The official image fills ${...} in templates/*.template into conf.d on start.
COPY apps/web/docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
