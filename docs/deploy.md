# Deploying RUVO

`docker-compose.prod.yml` runs the whole stack on one machine with Docker: Postgres, a one-shot
migration, the API (port 3000), the run worker, the dashboard (port 3001), two containers for
fetching, and one for web search:

- **`scrapling`**, the fetch service, built from `infra/scrapling/Dockerfile`. The worker sends it
  every page fetch.
- **`egress`**, the guard (`bun src/fetch/egressGuard.ts`), a SOCKS proxy that refuses any
  connection to a private address and connects only to the address it checked.
- **`searxng`**, the web search that finds sources. It publishes no port; the worker reaches it
  at `http://searxng:8080`. `SEARXNG_SECRET` in `.env` is optional: without it, SearXNG gets a
  new random secret at each start, and nothing it keeps needs the same one.

The fetch service sits on an internal network with the guard, so the guard is its only way out.

## Run it

```bash
cp .env.example .env        # set POSTGRES_PASSWORD, OPENAI_API_KEY and NEXT_PUBLIC_API_URL
docker compose -f docker-compose.prod.yml up -d --build
```

The `migrate` service applies database migrations and exits; the API and worker start once it
succeeds. Any other server setting from `apps/server/.env.example` can go in the same `.env`.

**`NEXT_PUBLIC_API_URL`** is the API's address as the browser reaches it (for example
`https://api.example.com`). It is baked into the dashboard when the image builds, so after
changing it rebuild with `up -d --build`.

**The AI account** here is an OpenAI API key. Without a key RUVO uses the ChatGPT sign-in, which
is for a machine where the sign-in server (`bunx openai-oauth --detach`) runs next to RUVO: it
listens on 127.0.0.1, which the containers can't reach. Use it with `bun run dev` on your own computer.

**A host without Scrapling.** This compose file always runs the fetch service. If you run the
server some other way, on a host where Scrapling can't run, set `SCRAPLING_URL` blank. Pages
are then read with plain requests only, with no browser or stealth browser, and Firecrawl doesn't
step in either. A site with a bot check stops its source, and self-repair skips the Scrapling
step.

## Updating

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Migrations run again on every `up` and only apply what is new.

## Scaling workers

Runs are claimed from a queue in Postgres, so more workers means more runs in parallel:

```bash
docker compose -f docker-compose.prod.yml up -d --scale worker=3
```

Workers run no browser, so they need no extra shared memory. Browsers run in the one
`scrapling` container, at most two at a time, whichever worker asked.

## Security

The API has **no authentication** and anyone who can reach it can start runs that spend your
OpenAI (and Firecrawl) credits. The compose file publishes ports 3000 and 3001 for local or
private-network use. Before exposing RUVO to the internet, put both behind your own reverse proxy
with HTTPS and authentication (or a VPN), and don't publish Postgres.

## Operations

- **Logs:** `docker compose -f docker-compose.prod.yml logs -f api worker scrapling egress searxng`
- **Health:** `GET /health` on the API returns 200 while it can reach the database.
- **Backups:** `docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U ruvo ruvo > ruvo.sql`.
  Postgres holds everything, remembered plans included.
- **Disk:** fetched pages are cached in Postgres, so the database grows with use. `bun run prune`
  in `apps/server` deletes old pages that no record cites.
