# RUVO API and worker image (same image, different command). Build from the repo root:
#   docker build -f apps/server/Dockerfile .
FROM oven/bun:1.4.2 AS base
WORKDIR /app
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Manifests first so the install layer is cached until dependencies change.
# Every workspace manifest is needed for the frozen lockfile to resolve.
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/typescript-config/package.json packages/typescript-config/
COPY packages/ui/package.json packages/ui/
RUN bun install --frozen-lockfile --production --filter server

# Headless Chromium (and its system libraries) for the worker, at the lockfile's Playwright version.
RUN cd apps/server && bun x playwright install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/*

COPY packages/contracts packages/contracts
COPY apps/server apps/server

USER bun
WORKDIR /app/apps/server
EXPOSE 3000
CMD ["bun", "src/index.ts"]
