# Deploying RUVO

`docker-compose.prod.yml` runs the whole stack on one machine with Docker: Postgres, a one-shot
migration, the API (port 3000), the run worker and the dashboard (port 3001).

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

Each worker runs its own headless Chromium, so allow roughly 1 GB of memory per worker.

## Security

The API has **no authentication** and anyone who can reach it can start runs that spend your
OpenAI (and Firecrawl) credits. The compose file publishes ports 3000 and 3001 for local or
private-network use. Before exposing RUVO to the internet, put both behind your own reverse proxy
with HTTPS and authentication (or a VPN), and don't publish Postgres.

## Operations

- **Logs:** `docker compose -f docker-compose.prod.yml logs -f api worker`
- **Health:** `GET /health` on the API returns 200 while it can reach the database.
- **Backups:** `docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U ruvo ruvo > ruvo.sql`.
  Postgres holds everything, remembered plans included.
- **Disk:** fetched pages are cached in Postgres, so the database grows with use. `bun run prune`
  in `apps/server` deletes old pages that no record cites.
