"""RUVO's fetch service: Scrapling behind a small HTTP API, with every connection sent through the egress guard.

Run: EGRESS_PROXY=socks5://127.0.0.1:1080 python infra/scrapling/server.py
"""

import asyncio
import base64
import os
import re
import sys

import uvicorn
from scrapling import __version__
from scrapling.fetchers import AsyncFetcher, DynamicFetcher, StealthyFetcher
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

EGRESS_PROXY = os.environ.get("EGRESS_PROXY")
if not EGRESS_PROXY:
    sys.exit("EGRESS_PROXY is required (e.g. socks5://127.0.0.1:1080): every fetch must go through the egress guard")
GUARD = EGRESS_PROXY.split("://", 1)[-1]
# socks5h makes curl leave name resolution to the guard; browsers reject socks5h but send names over socks5 anyway.
HTTP_PROXY = f"socks5h://{GUARD}"
BROWSER_PROXY = f"socks5://{GUARD}"

ENGINES = ("http", "browser", "stealth")
SKIPPED_RESOURCES = {"image", "font", "media"}
# Keep WebRTC's UDP from going around the proxy (the stealth browser gets this from block_webrtc).
WEBRTC_FLAGS = ["--webrtc-ip-handling-policy=disable_non_proxied_udp", "--force-webrtc-ip-handling-policy"]
# curl error 97 with SOCKS reply 2: the guard refused the connection by rule.
GUARD_REFUSED = re.compile(r"SOCKS5 connection to \S+\. \(2\)")

browser_slots = asyncio.Semaphore(2)


async def skip_heavy_resources(page) -> None:
    """Abort image, font and media requests; stylesheets still load so the page renders as it should."""

    async def handle(route) -> None:
        if route.request.resource_type in SKIPPED_RESOURCES:
            await route.abort()
        else:
            await route.fallback()

    await page.route("**/*", handle)


async def fetch_page(url: str, engine: str, timeout_ms: int, accept: str | None):
    """One fetch with a fresh client or browser, so no cookies or storage carry over between pages."""
    if engine == "http":
        return await AsyncFetcher.get(
            url,
            proxy=HTTP_PROXY,
            follow_redirects=True,  # never "safe": behind a proxy curl rejects every redirect
            max_redirects=5,
            retries=1,
            timeout=timeout_ms / 1000,
            **({"headers": {"Accept": accept}} if accept else {}),
        )
    async with browser_slots:
        if engine == "browser":
            return await DynamicFetcher.async_fetch(
                url,
                proxy=BROWSER_PROXY,
                network_idle=True,
                retries=1,
                timeout=timeout_ms,
                extra_flags=WEBRTC_FLAGS,
                additional_args={"service_workers": "block"},
                page_setup=skip_heavy_resources,
            )
        return await StealthyFetcher.async_fetch(
            url,
            proxy=BROWSER_PROXY,
            solve_cloudflare=True,
            block_webrtc=True,
            retries=1,
            timeout=max(timeout_ms, 60000),
            additional_args={"service_workers": "block", "ignore_https_errors": False},
            page_setup=skip_heavy_resources,
        )


def failure_kind(e: Exception) -> str:
    if getattr(e, "code", None) == 97 and GUARD_REFUSED.search(str(e)):
        return "blocked"
    return "timeout" if "Timeout" in type(e).__name__ else "network"


async def client_disconnected(request: Request) -> None:
    while (await request.receive())["type"] != "http.disconnect":
        pass


async def fetch(request: Request) -> Response:
    try:
        req = await request.json()
        url, engine, timeout_ms, max_bytes, accept = (
            req["url"], req["engine"], req["timeoutMs"], req["maxBytes"], req.get("accept"))
        valid = (isinstance(url, str) and url.startswith(("http://", "https://")) and engine in ENGINES
                 and type(timeout_ms) is int and timeout_ms > 0 and type(max_bytes) is int and max_bytes > 0
                 and (accept is None or isinstance(accept, str)))
    except (ValueError, KeyError, TypeError, AttributeError):
        valid = False
    if not valid:
        message = 'expected {"url", "engine": "http" | "browser" | "stealth", "timeoutMs", "maxBytes", "accept"}'
        return JSONResponse({"error": "bad_request", "message": message}, 400)

    # Race the fetch against the client hanging up, and cancel the fetch if nobody is waiting for it.
    fetching = asyncio.ensure_future(fetch_page(url, engine, timeout_ms, accept))
    hangup = asyncio.ensure_future(client_disconnected(request))
    await asyncio.wait({fetching, hangup}, return_when=asyncio.FIRST_COMPLETED)
    hangup.cancel()
    if not fetching.done():
        fetching.cancel()
        return Response(status_code=499)

    try:
        page = fetching.result()
    except Exception as e:
        return JSONResponse({"error": failure_kind(e), "message": str(e)}, 502)
    if len(page.body) > max_bytes:
        return JSONResponse({"error": "too_large", "message": f"body is {len(page.body)} bytes, over {max_bytes}"}, 502)
    return JSONResponse({
        "status": page.status,
        "url": page.url,
        "headers": {name.lower(): value for name, value in page.headers.items()},
        "body": base64.b64encode(page.body).decode(),
    })


async def health(_: Request) -> Response:
    return JSONResponse({"status": "ok", "scrapling": __version__})


app = Starlette(routes=[Route("/health", health), Route("/fetch", fetch, methods=["POST"])])

if __name__ == "__main__":
    uvicorn.run(app, host=os.environ.get("SCRAPLING_HOST", "127.0.0.1"), port=int(os.environ.get("SCRAPLING_PORT", "8001")))
