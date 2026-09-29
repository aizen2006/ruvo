# RUVO dashboard image (Next.js standalone server). Build from the repo root:
#   docker build -f apps/web/Dockerfile .
# NEXT_PUBLIC_API_URL (the API's public URL, as the browser reaches it) is baked in at build time.

FROM oven/bun:1.4.2 AS bun

FROM node:24-slim AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Every workspace manifest is needed for the frozen lockfile to resolve.
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/typescript-config/package.json packages/typescript-config/
COPY packages/ui/package.json packages/ui/
RUN bun install --frozen-lockfile --filter web

COPY packages packages
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN cd apps/web && bun run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3001

# The standalone server does not serve static assets unless they sit beside it.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static

USER node
EXPOSE 3001
CMD ["node", "apps/web/server.js"]
