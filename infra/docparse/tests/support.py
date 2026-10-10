"""Sample documents, built in memory at test time, and docparse run on them as RUVO runs it: a fresh process each."""

import atexit
import io
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile
from functools import cache

from openpyxl import Workbook

DOCPARSE = "/app/docparse.py"


def run(document: bytes, parse: bool = False) -> dict:
    """docparse's result for a document, as the worker gets it with Docker, or from docparse serve (the all-Docker
    setup) when the suite runs with DOCPARSE_VIA=service."""
    if os.environ.get("DOCPARSE_VIA") == "service":
        status, result = post(service(), document, parse)
        assert status == 200, result
        return result
    args = [sys.executable, DOCPARSE, *(["--parse"] if parse else [])]
    done = subprocess.run(args, input=document, capture_output=True, timeout=120, check=True)
    return json.loads(done.stdout)


def start_service(port: int, **env: str) -> subprocess.Popen:
    """docparse serve on `port`, with `env` added to its environment, once it answers."""
    process = subprocess.Popen([sys.executable, DOCPARSE, "serve"], env={**os.environ, "DOCPARSE_PORT": str(port), **env},
                               stderr=subprocess.DEVNULL)
    for _ in range(100):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1).close()
            return process
        except OSError:
            time.sleep(0.1)
    process.kill()
    raise RuntimeError(f"docparse serve didn't start on port {port}")


@cache
def service() -> int:
    """The port of the suite's service, started on first use and stopped when the suite ends."""
    atexit.register(start_service(8100).kill)
    return 8100


def post(port: int, document: bytes, parse: bool = False) -> tuple[int, dict]:
    request = urllib.request.Request(f"http://127.0.0.1:{port}/{'?parse=1' if parse else ''}", data=document, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=120) as reply:
            return reply.status, json.load(reply)
    except urllib.error.HTTPError as error:
        with error:
            return error.code, json.load(error)


def pdf(*objects: bytes, trailer: bytes = b"") -> bytes:
    """A PDF from its objects' bodies, numbered from 1 (the catalog), with a correct cross-reference table."""
    out = bytearray(b"%PDF-1.7\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R %s >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, trailer, xref)
    return bytes(out)


def stream(data: bytes, entries: bytes = b"") -> bytes:
    return b"<< /Length %d %s >>\nstream\n%s\nendstream" % (len(data), entries, data)


HELVETICA = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"


def text_pdf(pages: list[str], catalog: bytes = b"", font: bytes = HELVETICA, extra: tuple[bytes, ...] = (),
             info: bytes | None = None, page: bytes = b"") -> bytes:
    """A PDF with a page of text per item of `pages` (lines split on "\\n", characters taken as the font's codes).
    Its objects: the catalog (1), the page tree (2), the font (3), then `extra` from 4, which the catalog, font and
    each page's added entries (`page`) may refer to, then each page and its content, then the Info dictionary."""
    first_page = 4 + len(extra)
    page_numbers = [first_page + 2 * i for i in range(len(pages))]
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R %s >>" % catalog,
        b"<< /Type /Pages /Kids [%s] /Count %d >>" % (b" ".join(b"%d 0 R" % n for n in page_numbers), len(pages)),
        font,
        *extra,
    ]
    for number, text in zip(page_numbers, pages):
        lines = b" 0 -14 Td ".join(b"(%s) Tj" % escape(line) for line in text.split("\n"))
        objects.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R %s >>" % (number + 1, page))
        objects.append(stream(b"BT /F1 12 Tf 72 720 Td %s ET" % lines))
    if info is None:
        return pdf(*objects)
    return pdf(*objects, info, trailer=b"/Info %d 0 R" % (len(objects) + 1))


def escape(text: str) -> bytes:
    return text.encode("latin-1").replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


def suppliers(workbook) -> None:
    workbook.active.append(["Company", "City"])
    workbook.active.append(["Acme", "Paris"])


def xlsx(build=suppliers) -> bytes:
    """An Excel workbook made by `build(workbook)`."""
    workbook = Workbook()
    build(workbook)
    out = io.BytesIO()
    workbook.save(out)
    return out.getvalue()


def repack(archive: bytes, parts: dict[str, bytes]) -> bytes:
    """A ZIP archive (a workbook) with `parts` added or replaced."""
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(archive)) as source, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as target:
        for name in source.namelist():
            if name not in parts:
                target.writestr(name, source.read(name))
        for name, data in parts.items():
            target.writestr(name, data)
    return out.getvalue()


def part(archive: bytes, name: str) -> bytes:
    with zipfile.ZipFile(io.BytesIO(archive)) as source:
        return source.read(name)
