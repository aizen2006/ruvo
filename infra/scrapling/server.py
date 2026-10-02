"""RUVO's fetch service: Scrapling behind a small HTTP API, with every connection sent through the egress guard.
It also re-finds a broken recipe's fields on a changed page with Scrapling's adaptive parser (no network).

Run: EGRESS_PROXY=socks5://127.0.0.1:1080 python infra/scrapling/server.py
"""

import asyncio
import base64
import os
import re
import sys
from itertools import product

import uvicorn
from cssselect import SelectorError
from scrapling import Selector, __version__
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
# Settings that send connections around the guard, read from this process's environment: libcurl skips the proxy for
# hosts in no_proxy, and Playwright's drivers stop proxying the browsers' loopback requests.
for name in ("NO_PROXY", "no_proxy", "PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK"):
    os.environ.pop(name, None)

ENGINES = ("http", "browser", "stealth")
SKIPPED_RESOURCES = {"image", "font", "media"}
# Keep WebRTC's UDP from going around the proxy (the stealth browser gets this from block_webrtc).
WEBRTC_FLAGS = ["--webrtc-ip-handling-policy=disable_non_proxied_udp", "--force-webrtc-ip-handling-policy"]
# curl error 97 with SOCKS reply 2: the guard refused the connection by rule.
GUARD_REFUSED = re.compile(r"SOCKS5 connection to \S+\. \(2\)")
# A browser's navigation error for any SOCKS reply but success: the guard refused the address, or could not reach it.
SOCKS_FAILED = "net::ERR_SOCKS_CONNECTION_FAILED"
# Similarity (%) a relocated field must reach. Scrapling's default, 40, misses the demo careers redesign, which moves
# the location into a list item scoring 33.8; the closest element to a field that is gone there scores 27.5.
FIELD_SCORE = 30

browser_slots = asyncio.Semaphore(2)


async def skip_heavy_resources(page) -> None:
    """Abort image, font and media requests; stylesheets still load so the page renders as it should."""

    async def handle(route) -> None:
        if route.request.resource_type in SKIPPED_RESOURCES:
            await route.abort()
        else:
            await route.fallback()

    await page.route("**/*", handle)


class TooLarge(Exception):
    """A body over the fetch's maxBytes."""


async def fetch_page(url: str, engine: str, timeout_ms: int, max_bytes: int, accept: str | None):
    """One fetch with a fresh client or browser, so no cookies or storage carry over between pages: the page and its body."""
    if engine == "http":
        body = bytearray()

        def receive(chunk: bytes) -> int:
            body.extend(chunk)
            if len(body) > max_bytes:
                raise TooLarge(f"body is over {max_bytes} bytes")  # curl stops the download here
            return len(chunk)

        page = await AsyncFetcher.get(
            url,
            proxy=HTTP_PROXY,
            follow_redirects=True,  # never "safe": behind a proxy curl rejects every redirect
            max_redirects=5,
            retries=1,
            timeout=timeout_ms / 1000,
            content_callback=receive,  # the body comes here as it arrives, not whole into the page
            **({"headers": {"Accept": accept}} if accept else {}),
        )
        return page, bytes(body)
    async with browser_slots:
        if engine == "browser":
            page = await DynamicFetcher.async_fetch(
                url,
                proxy=BROWSER_PROXY,
                network_idle=True,
                retries=1,
                timeout=timeout_ms,
                extra_flags=WEBRTC_FLAGS,
                additional_args={"service_workers": "block"},
                page_setup=skip_heavy_resources,
            )
        else:
            page = await StealthyFetcher.async_fetch(
                url,
                proxy=BROWSER_PROXY,
                solve_cloudflare=True,
                block_webrtc=True,
                retries=1,
                timeout=max(timeout_ms, 60000),
                additional_args={"service_workers": "block", "ignore_https_errors": False},
                page_setup=skip_heavy_resources,
            )
    if len(page.body) > max_bytes:  # a rendered page arrives whole, so it is measured after
        raise TooLarge(f"body is {len(page.body)} bytes, over {max_bytes}")
    return page, page.body


def failure(e: Exception) -> tuple[str, str]:
    """A failed fetch as RUVO's client reads it: its kind and message."""
    if isinstance(e, TooLarge):
        return "too_large", str(e)
    if getattr(e, "code", None) == 97 and GUARD_REFUSED.search(str(e)):
        return "blocked", str(e)
    if SOCKS_FAILED in str(e):
        return "blocked", "the connection was refused by RUVO's private-network guard, or the host could not be reached"
    return ("timeout" if "Timeout" in type(e).__name__ else "network"), str(e)


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
    fetching = asyncio.ensure_future(fetch_page(url, engine, timeout_ms, max_bytes, accept))
    hangup = asyncio.ensure_future(client_disconnected(request))
    await asyncio.wait({fetching, hangup}, return_when=asyncio.FIRST_COMPLETED)
    hangup.cancel()
    if not fetching.done():
        fetching.cancel()
        return Response(status_code=499)

    try:
        page, body = fetching.result()
    except Exception as e:
        kind, message = failure(e)
        return JSONResponse({"error": kind, "message": message}, 502)
    return JSONResponse({
        "status": page.status,
        "url": page.url,
        "headers": {name.lower(): value for name, value in page.headers.items()},
        "body": base64.b64encode(body).decode(),
    })


def css_path(el) -> str:
    """Where an element sits, as a CSS path from <html>; RUVO finds the same element with it in cheerio."""
    steps = []
    while (parent := el.parent) is not None:
        nth, sibling = 1, el.previous
        while sibling is not None:
            nth += sibling.tag == el.tag
            sibling = sibling.previous
        steps.append(f"{el.tag}:nth-of-type({nth})")
        el = parent
    return " > ".join([el.tag, *reversed(steps)])


def value(el, attr: str) -> str:
    """What a recipe field reads from an element, whitespace collapsed."""
    return " ".join((el.get_all_text(separator=" ") if attr == "text" else el.attrib.get(attr, "")).split())


def shown(record) -> set[str]:
    """Every piece of text a record shows, whitespace collapsed."""
    return {" ".join(piece.split()) for piece in record.css("::text").getall()} - {""}


def relocate_field(old_el, new_item, attr: str):
    """The element of `new_item` most like `old_el` by Scrapling's similarity score, if it scores FIELD_SCORE."""
    # Scrapling compares an element's own text, so a text field is matched by the innermost element holding its text...
    target, depth, text = old_el, 0, old_el.get_all_text(strip=True)
    while attr == "text" and len(children := target.children) == 1 and children[0].get_all_text(strip=True) == text:
        target, depth = children[0], depth + 1
    found = new_item.relocate(target, FIELD_SCORE, selector_type=True)
    found = found[0] if found else None
    # ...then backed out to the level the recipe read, while the text stays the same.
    for _ in range(depth):
        if found is None or found.parent is None or found.parent.get_all_text(strip=True) != found.get_all_text(strip=True):
            break
        found = found.parent
    return found


def relocate_recipe(old_html: str, new_html: str, item_selector: str, fields: list[dict]) -> tuple[str | None, dict]:
    """Scrapling's adaptive relocation: where a recipe's item and fields, as read on the old page, are on the new one."""
    old, new = Selector(old_html), Selector(new_html)
    # Fifty old records are plenty to find one the new page still lists.
    old_items, new_items = old.css(item_selector)[:50], new.css(item_selector)
    if old_items and not new_items and (found := new.relocate(old_items[0], selector_type=True)):
        new_items = [found[0], *found[0].find_similar()]
    if not old_items or not new_items:
        return None, {}
    # The old and new item sharing the most text show the same record, so fields are matched against their own values.
    old_texts, new_texts = [shown(item) for item in old_items], [shown(item) for item in new_items]
    o, n = max(product(range(len(old_items)), range(len(new_items))), key=lambda p: len(old_texts[p[0]] & new_texts[p[1]]))
    if not old_texts[o] & new_texts[n]:
        return None, {}  # no record is on both pages, so no field could be checked
    old_item, new_item = old_items[o], new_items[n]

    relocated = {}
    for field in fields:
        selector, attr = field["selector"], field["attr"]
        old_el = old_item.css(selector).first if selector else None  # an empty selector reads the item itself
        new_el = old_el and (new_item.css(selector).first or relocate_field(old_el, new_item, attr))
        # Where a field is gone, Scrapling still offers the closest element: it is the field only if it reads the same value.
        if new_el is not None and value(new_el, attr) == value(old_el, attr):
            relocated[field["name"]] = css_path(new_el)
    return css_path(new_item), relocated


async def relocate(request: Request) -> Response:
    try:
        req = await request.json()
        old_html, new_html, item_selector, fields = req["oldHtml"], req["newHtml"], req["itemSelector"], req["fields"]
        valid = (all(isinstance(v, str) for v in (old_html, new_html, item_selector)) and isinstance(fields, list)
                 and all(isinstance(f, dict) and all(isinstance(f.get(k), str) for k in ("name", "selector", "attr")) for f in fields))
    except (ValueError, KeyError, TypeError, AttributeError):
        valid = False
    if not valid:
        message = 'expected {"oldHtml", "newHtml", "itemSelector", "fields": [{"name", "selector", "attr"}]}'
        return JSONResponse({"error": "bad_request", "message": message}, 400)

    try:
        # Scoring every element is CPU work: off the event loop, so fetches carry on meanwhile.
        item, relocated = await asyncio.to_thread(relocate_recipe, old_html, new_html, item_selector, fields)
    except SelectorError:
        item, relocated = None, {}  # a selector lxml cannot parse finds nothing, as in RUVO's replay
    return JSONResponse({"item": item, "fields": {f["name"]: relocated.get(f["name"]) for f in fields}})


async def health(_: Request) -> Response:
    return JSONResponse({"status": "ok", "scrapling": __version__})


app = Starlette(routes=[
    Route("/health", health),
    Route("/fetch", fetch, methods=["POST"]),
    Route("/relocate", relocate, methods=["POST"]),
])

if __name__ == "__main__":
    uvicorn.run(app, host=os.environ.get("SCRAPLING_HOST", "127.0.0.1"), port=int(os.environ.get("SCRAPLING_PORT", "8001")))
