import type { NextRequest } from "next/server";

/** The names this machine answers to (apps/server/src/middlewares/localOrigin.ts has the API's). */
const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];
/** All the API reads from a request: the body's type, a new run's Idempotency-Key, and the Origin it checks changes against. */
const REQUEST_HEADERS = ["content-type", "idempotency-key", "origin"];
/** All the browser needs from an answer: its type and, for an export, the file name. */
const RESPONSE_HEADERS = ["content-type", "content-disposition"];

/** `headers` with only `names`, so nothing else (cookies, X-Forwarded-Host, CORS answers) gets through. */
const only = (headers: Headers, names: string[]) => new Headers([...headers].filter(([name]) => names.includes(name)));

/**
 * The browser calls the API on the dashboard's own origin (/api/...) and this passes each call on to API_URL,
 * read per request so one build works anywhere. Bodies stream through, so exports arrive as the API writes them.
 */
async function forward(request: NextRequest) {
  // A website that points its own name at this machine (DNS rebinding) is the dashboard's origin to the browser, so
  // only requests to this machine by name go on, unless ALLOW_ANY_HOST (read per request, unlike NODE_ENV, which a
  // build fixes) says the dashboard sits behind your own host names, as in docker-compose.prod.yml.
  // Host is checked, not X-Forwarded-Host, which a page can set.
  const hostname = request.headers.get("host")?.replace(/:\d+$/, "") ?? "";
  if (process.env.ALLOW_ANY_HOST !== "true" && !LOCAL_HOSTNAMES.includes(hostname)) {
    return Response.json({ error: "RUVO's dashboard answers only requests to localhost on this computer." }, { status: 403 });
  }

  // Without the trim, a configured trailing slash turns every request into "//api/...", which matches no route.
  const apiUrl = (process.env.API_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  let answer: Response;
  try {
    answer = await fetch(`${apiUrl}${request.nextUrl.pathname}${request.nextUrl.search}`, {
      method: request.method,
      // The browser's Origin goes on, so the API still refuses changes from other websites.
      headers: only(request.headers, REQUEST_HEADERS),
      body: request.body,
      // Node's fetch needs this to stream a request body; the DOM types don't know it.
      duplex: "half",
    } as RequestInit);
  } catch {
    return Response.json({ error: `Can't reach the RUVO API at ${apiUrl}. Check that the server is running.` }, { status: 502 });
  }
  return new Response(answer.body, { status: answer.status, headers: only(answer.headers, RESPONSE_HEADERS) });
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
