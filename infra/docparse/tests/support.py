"""Sample documents, built in memory at test time, and docparse run on them as RUVO runs it: a fresh process each."""

import io
import json
import subprocess
import sys

from openpyxl import Workbook

DOCPARSE = "/app/docparse.py"


def run(document: bytes) -> dict:
    done = subprocess.run([sys.executable, DOCPARSE], input=document, capture_output=True, timeout=120, check=True)
    return json.loads(done.stdout)


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


def text_pdf(pages: list[str], catalog: bytes = b"", info: bytes | None = None, extra: tuple[bytes, ...] = ()) -> bytes:
    """A PDF with a page of Helvetica text per item of `pages` (lines split on "\\n"). Its objects are the catalog (1),
    the page tree (2), the font (3), then each page and its content, the Info dictionary when given, then `extra`,
    which `catalog` may refer to."""
    first_page = 4
    page_numbers = [first_page + 2 * i for i in range(len(pages))]
    after_pages = first_page + 2 * len(pages)
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R %s >>" % catalog,
        b"<< /Type /Pages /Kids [%s] /Count %d >>" % (b" ".join(b"%d 0 R" % n for n in page_numbers), len(pages)),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    for number, text in zip(page_numbers, pages):
        lines = b" 0 -14 Td ".join(b"(%s) Tj" % escape(line) for line in text.split("\n"))
        objects.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>" % (number + 1))
        objects.append(stream(b"BT /F1 12 Tf 72 720 Td %s ET" % lines))
    if info is not None:
        objects.append(info)
    return pdf(*objects, *extra, trailer=b"/Info %d 0 R" % after_pages if info is not None else b"")


def escape(text: str) -> bytes:
    return text.encode("latin-1").replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


def xlsx(build) -> bytes:
    """An Excel workbook made by `build(workbook)`."""
    workbook = Workbook()
    build(workbook)
    out = io.BytesIO()
    workbook.save(out)
    return out.getvalue()
