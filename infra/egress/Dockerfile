# The egress guard on its own (apps/server/src/fetch/egressGuard.ts), bundled with only what it imports, so the
# fetch service's way out carries none of the server. Build from the repo root:
#   docker build -f infra/egress/Dockerfile .
FROM oven/bun:1.4.2 AS build
WORKDIR /app

# The lockfile pins the guard's one dependency (winston); every workspace manifest is needed for it to resolve.
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/typescript-config/package.json packages/typescript-config/
COPY packages/ui/package.json packages/ui/
RUN bun install --frozen-lockfile --production --filter server

COPY apps/server/src/fetch/egressGuard.ts apps/server/src/fetch/ssrf.ts apps/server/src/fetch/errors.ts apps/server/src/fetch/
COPY apps/server/src/libs/logger.ts apps/server/src/libs/
# A production build fixes NODE_ENV in the bundle, so the guard listens on every interface: it runs only in a container.
RUN bun build apps/server/src/fetch/egressGuard.ts --target=bun --production --outfile=egressGuard.js

FROM oven/bun:1.4.2-slim
WORKDIR /app
COPY --from=build /app/egressGuard.js ./
USER bun
EXPOSE 1080
CMD ["bun", "egressGuard.js"]
