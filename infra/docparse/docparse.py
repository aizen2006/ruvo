"""RUVO's document sandbox: scans a PDF, Excel workbook, CSV or JSON document that RUVO found on the web and, when
it is clean, parses it.

Documents are hostile input (active content, parser exploits, decompression bombs), so RUVO's API and worker never
parse them: each one is read here, in a container per document with no network, a read-only filesystem, and memory,
CPU and process limits. Every run limits its own process too, before it reads the document.

Run: docparse [--parse] < document    the document on stdin, one JSON object on stdout
     docparse serve                   the same over HTTP, for the all-Docker setup, where the worker can't start
                                      containers: POST a document to port 8100 (DOCPARSE_PORT), with ?parse=1 to
                                      parse. Each runs in a fresh process, killed after 30 s (DOCPARSE_TIMEOUT).

The result always has these keys:
  verdict     "clean" (may be parsed), "risky" (active content: metadata only, never parsed) or "rejected" (dropped)
  reason      why the document was rejected, in plain words; else null
  type        what the bytes are, whatever the name or declared type says: "pdf", "xlsx", "csv", "json", "html" (a
              web page, always rejected) or null (anything else)
  flags       what the scan found: active content ("javascript", "open_action", "auto_action", "launch",
              "embedded_file", "rich_media", "xfa", "submit_form", "remote_goto" in a PDF; "macros", "external_link",
              "ole_object", "dde" in a workbook) and "encrypted"; a parse adds "no_text_layer" for a PDF without text
  meta        what the file says about itself, {} when rejected. A PDF: title, author, subject, keywords, created,
              modified (ISO 8601) and pages. A workbook: the same but pages, plus sheets [{name, hidden, rows,
              columns}]. A CSV: encoding, delimiter, columns (the header) and rows. JSON: encoding, shape ("array",
              "object" or "lines"), columns (the keys of the object or of the first item) and rows (items). Missing
              values are null.
  capped      true when the parse stopped at a cap: 200 pages, 5,000 rows, 2,000 characters a value, or 10 million
              characters in all
  text        a parsed PDF's text, its pages joined by blank lines: NFKC-normalized, invisible characters removed and
              words broken across lines joined; else null
  pageStarts  where each page starts in text, in UTF-16 code units as JavaScript counts them; else null
  tables      a parsed workbook's visible sheets, or a CSV or JSON file's rows (an array of objects or JSON Lines):
              [{name (the sheet, or null), headers, rows: [{row (its number in the sheet or file), values}]}], hidden
              rows and columns left out. Values are as stored: formulas are never evaluated. Else null.
"""

import csv
import html
import io
import json
import logging
import math
import os
import re
import resource
import subprocess
import sys
import unicodedata
import warnings
import zipfile
from datetime import date, datetime, time, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from itertools import accumulate, chain, islice
from time import sleep
from urllib.parse import parse_qs, urlsplit

import charset_normalizer
from defusedxml.ElementTree import fromstring
from openpyxl import load_workbook
from openpyxl.worksheet._reader import WorkSheetParser
from pypdf import PdfReader
from pypdf.generic import ArrayObject, DictionaryObject, IndirectObject, NameObject

# The parsers' complaints about a damaged file (one a line, so a hostile file can write megabytes of them) are noise
# here: the verdict says what matters, and stderr is left for failures.
logging.disable(logging.WARNING)
warnings.simplefilter("ignore")

MB = 1 << 20
MAX_BYTES = 64 * MB  # RUVO caps downloads well below this
TOO_LARGE = f"larger than {MAX_BYTES // MB} MB"
MAX_MEMORY = 512 * MB  # address space, as the container's own memory limit
TIMEOUT = float(os.environ.get("DOCPARSE_TIMEOUT", "30"))  # seconds a document may take
PORT = int(os.environ.get("DOCPARSE_PORT", "8100"))
MAX_PAGES = 200
MAX_ROWS = 5_000
MAX_TEXT = 2_000  # characters in one value
MAX_OUTPUT = 10_000_000  # characters a parse gives in all, so a small compressed file can't flood the worker
MAX_DEPTH = 64  # JSON nesting
MAX_PDF_OBJECTS = 100_000
# Zip-bomb limits, checked against the central directory before any entry is read.
MAX_ENTRIES = 1_000
MAX_UNZIPPED = 100 * MB
MAX_RATIO = 100  # for entries over 1 MB

# Formats refused by their first bytes alone.
REFUSED = {
    b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1": "a legacy Office file (.xls, .doc or .ppt); only .xlsx workbooks are read",
    b"\x1f\x8b": "a gzip file; compressed files aren't read",
}
ZIP = (b"PK\x03\x04", b"PK\x05\x06")  # an archive, or an empty one
HTML = re.compile(r"<(?:!doctype\s+html|html|head|body)\b", re.I)

# Names that mark active content in a PDF, and the flag each raises. /OpenAction is judged on its own (pdf_flags).
PDF_FLAGS = {
    "/JavaScript": "javascript", "/JS": "javascript",
    "/AA": "auto_action",
    "/Launch": "launch",
    "/EmbeddedFile": "embedded_file", "/EmbeddedFiles": "embedded_file", "/EF": "embedded_file",
    "/RichMedia": "rich_media",
    "/XFA": "xfa",
    "/SubmitForm": "submit_form",
    "/GoToR": "remote_goto",
}
# Each metadata field as pypdf names it in the Info dictionary, and in the XMP metadata.
PDF_META = {
    "title": ("title", "dc_title"),
    "author": ("author", "dc_creator"),
    "subject": ("subject", "dc_description"),
    "keywords": ("keywords", "pdf_keywords"),
    "created": ("creation_date", "xmp_create_date"),
    "modified": ("modification_date", "xmp_modify_date"),
}

WORKBOOK = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
XLSX_COLUMNS = 16_384  # Excel's last column, XFD
# An absolute path, a drive letter or a ".." step: an entry meant to land outside the folder it is unpacked into.
UNSAFE_PATH = re.compile(r"^[/\\]|^[A-Za-z]:|(?:^|[/\\])\.\.(?:[/\\]|$)")
FORMULA = re.compile(rb"<(?:\w+:)?f\b[^>]*(?<!/)>(.*?)</(?:\w+:)?f>", re.S)
QUOTED = re.compile(r'"[^"]*"')
DDE = re.compile(r"\w\|")  # Excel's DDE syntax: Application|Topic!Item

# A JSON string, or a bracket (captured): nesting is counted on the brackets outside strings.
BRACKETS = re.compile(r'"[^"\\]*(?:\\.[^"\\]*)*"|([\[\]{}])', re.S)
DEPTH = {"[": 1, "{": 1, "]": -1, "}": -1, "": 0}
SPACE = re.compile(r"\s*")
NUMBER = re.compile(r"[-+]?\d[\d.,]*%?")
# Characters that render as nothing or reorder text: zero-width, bidi controls, soft hyphens and C0 controls.
INVISIBLE = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u00ad\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff\ud800-\udfff]")
# A word broken across lines ("exam-\nple"); joined when the next line goes on in lower case.
BROKEN_WORD = re.compile(r"(?<=\w)[-\u00ad\u2010\u2011][ \t]*\n[ \t]*(?=\w)")


class Rejected(Exception):
    """A document RUVO drops; the message says why."""


class Caps:
    """What a parse may still give (rows, and characters in all), and whether a cap cut it short."""

    def __init__(self) -> None:
        self.rows, self.chars, self.hit = MAX_ROWS, MAX_OUTPUT, False

    def text(self, text: str) -> str:
        """`text`, cut to the characters left."""
        if len(text) > self.chars:
            self.hit, text = True, text[: self.chars]
        self.chars -= len(text)
        return text

    def value(self, value):
        """A value as it goes out: text cleaned and capped, dates in ISO 8601, nested JSON as its text."""
        if isinstance(value, (date, time)):  # datetimes too
            return value.isoformat()
        if isinstance(value, timedelta):
            return str(value)
        if isinstance(value, float) and not math.isfinite(value):
            return None  # JSON has no infinity
        if isinstance(value, (dict, list)):
            value = json.dumps(value, ensure_ascii=False)
        if isinstance(value, str) and len(value := clean(value)) > MAX_TEXT:
            self.hit, value = True, value[:MAX_TEXT]
        return value

    def row(self, values: list) -> bool:
        """Whether a row fits under the caps; when it does, it is counted."""
        size = len(json.dumps(values, ensure_ascii=False))
        if self.rows == 0 or size > self.chars:
            self.hit = True
            return False
        self.rows, self.chars = self.rows - 1, self.chars - size
        return True


def read(data: bytes, parse: bool) -> dict:
    """A document's scan and, when it is clean and `parse` is set, its text or rows (see the result above)."""
    doc = {"verdict": "clean", "reason": None, "type": None, "flags": [], "meta": {}, "capped": False, "text": None,
           "pageStarts": None, "tables": None}
    try:
        opened = scan(data, doc)
        if doc["flags"]:
            doc["verdict"] = "risky"
        elif parse:
            caps = Caps()
            PARSERS[doc["type"]](opened, doc, caps)
            doc["capped"] = caps.hit
    except Rejected as e:
        return rejected(str(e), doc["type"])
    except MemoryError:
        return rejected("too large to read within the sandbox's memory", doc["type"])
    except Exception as e:  # a damaged or hostile file can make a parser fail in any way
        return rejected(f"could not be read ({type(e).__name__}: {clean(str(e))[:200]})", doc["type"])
    return doc


def rejected(reason: str, type_: str | None) -> dict:
    return {"verdict": "rejected", "reason": reason, "type": type_, "flags": [], "meta": {}, "capped": False,
            "text": None, "pageStarts": None, "tables": None}


def scan(data: bytes, doc: dict):
    """Finds what the bytes are (their content decides, never a name or declared type), then scans them as that,
    filling in the type, flags and metadata. Returns what a parse reads on from."""
    if not data:
        raise Rejected("an empty file")
    if len(data) > MAX_BYTES:
        raise Rejected(TOO_LARGE)
    if data.startswith(b"%PDF-"):
        doc["type"] = "pdf"
        return scan_pdf(data, doc)
    if data.startswith(ZIP):
        return scan_xlsx(data, doc)
    for magic, what in REFUSED.items():
        if data.startswith(magic):
            raise Rejected(what)
    text, encoding = decode(data)
    head = text[:4096].lstrip()
    if head.startswith("<"):
        if HTML.search(head):
            doc["type"] = "html"
            raise Rejected("a web page, not a document")
        raise Rejected("XML or other markup, not a document")
    if head.startswith(("{", "[")):
        doc["type"] = "json"
        return scan_json(text, encoding, doc)
    return scan_csv(text, encoding, doc)


def scan_pdf(data: bytes, doc: dict) -> PdfReader:
    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        # Its objects can't be read without the password, so there is no metadata to give either.
        doc["flags"] = ["encrypted"]
        return reader
    doc["flags"] = sorted(pdf_flags(reader))
    doc["meta"] = pdf_meta(reader)
    return reader


def pdf_flags(reader: PdfReader) -> set[str]:
    """Active content in the objects a viewer can reach from the trailer, those inside object streams included."""
    flags, seen, todo = set(), set(), [reader.trailer]
    while todo:
        obj = todo.pop()
        if isinstance(obj, IndirectObject):
            if (obj.idnum, obj.generation) in seen:
                continue
            seen.add((obj.idnum, obj.generation))
            if len(seen) > MAX_PDF_OBJECTS:
                raise Rejected(f"a PDF with over {MAX_PDF_OBJECTS:,} objects")
            obj = obj.get_object()
        if isinstance(obj, DictionaryObject):  # streams too, without their data
            todo += [*obj.keys(), *obj.values()]
        elif isinstance(obj, ArrayObject):
            todo += obj
        elif isinstance(obj, NameObject) and obj in PDF_FLAGS:
            flags.add(PDF_FLAGS[obj])
    # A destination or a plain /GoTo only sets the first view (LaTeX's hyperref adds one); any other action runs.
    action = reader.trailer["/Root"].get("/OpenAction")
    action = action and action.get_object()
    if isinstance(action, DictionaryObject) and action.get("/S") != "/GoTo":
        flags.add("open_action")
    return flags


def pdf_meta(reader: PdfReader) -> dict:
    """The Info dictionary's properties, with the XMP metadata filling in what it lacks."""
    info, xmp = reader.metadata, attempt(lambda: reader.xmp_metadata)
    meta = {}
    for key, (in_info, in_xmp) in PDF_META.items():
        value = attempt(lambda: getattr(info, in_info)) or attempt(lambda: getattr(xmp, in_xmp))
        if isinstance(value, dict):  # XMP text in several languages
            value = next(iter(value.values()), None)
        elif isinstance(value, list):  # XMP creators
            value = ", ".join(value)
        meta[key] = meta_value(value)
    return {**meta, "pages": len(reader.pages)}


def parse_pdf(reader: PdfReader, doc: dict, caps: Caps) -> None:
    """The text of the first MAX_PAGES pages, and where each starts."""
    pages = []
    for page in islice(reader.pages, MAX_PAGES):
        if caps.chars <= 0:
            caps.hit = True
            break
        pages.append(caps.text(page_text(page.extract_text())))
    caps.hit |= len(reader.pages) > MAX_PAGES
    if not any(text.strip() for text in pages):
        doc["flags"].append("no_text_layer")  # scanned pages: reading them would take OCR
        return
    doc["text"] = "\n\n".join(pages)
    doc["pageStarts"] = list(accumulate((len(text.encode("utf-16-le")) // 2 + 2 for text in pages[:-1]), initial=0))


def page_text(text: str) -> str:
    """A page's text as RUVO matches quotes against it: cleaned, with words broken across lines joined."""
    text = BROKEN_WORD.sub(lambda m: "" if m.string[m.end()].islower() else m[0], unicodedata.normalize("NFKC", text))
    return INVISIBLE.sub("", text)


def scan_xlsx(data: bytes, doc: dict):
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise Rejected("a damaged ZIP archive")
    check_archive(archive)
    try:
        types = {part.get("ContentType", "") for part in fromstring(archive.read("[Content_Types].xml"))}
    except KeyError:
        types = set()
    if any("macroEnabled" in t for t in types):
        raise Rejected("a macro-enabled workbook (.xlsm)")
    if WORKBOOK not in types:
        raise Rejected("a ZIP archive that isn't an Excel workbook; Word, PowerPoint and compressed files aren't read")
    doc["type"] = "xlsx"
    doc["flags"] = sorted(xlsx_flags(archive))
    workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True, keep_links=False)
    props = workbook.properties
    doc["meta"] = {
        "title": meta_value(props.title),
        "author": meta_value(props.creator),
        "subject": meta_value(props.subject),
        "keywords": meta_value(props.keywords),
        "created": meta_value(props.created),
        "modified": meta_value(props.modified),
        "sheets": [
            {"name": meta_value(ws.title), "hidden": ws.sheet_state != "visible", "rows": ws.max_row, "columns": ws.max_column}
            for ws in workbook.worksheets
        ],
    }
    return workbook


def parse_xlsx(workbook, doc: dict, caps: Caps) -> None:
    """A table for each visible sheet."""
    doc["tables"] = []
    for ws in workbook.worksheets:
        if ws.sheet_state != "visible":
            continue
        if caps.rows == 0:
            caps.hit = True
            break
        header, rows = split_header(sheet_rows(ws))
        if header:
            doc["tables"].append(table(meta_value(ws.title), header, rows, caps))


def sheet_rows(ws):
    """A worksheet's rows as (row number, values), hidden rows and columns left out. openpyxl's read-only sheets don't
    say what is hidden, so the rows come from openpyxl's own sheet parser, which records it."""
    workbook = ws.parent
    with ws._get_source() as source:
        parser = WorkSheetParser(source, ws._shared_strings, data_only=True, epoch=workbook.epoch,
                                 date_formats=workbook._date_formats, timedelta_formats=workbook._timedelta_formats)
        hidden = None
        for number, cells in parser.parse():
            if hidden is None:  # columns are described before the first row
                hidden = {i for col in parser.column_dimensions.values() if col.get("hidden") in ("1", "true")
                          for i in range(int(col["min"]), min(int(col["max"]), XLSX_COLUMNS) + 1)}
            if parser.row_dimensions.get(str(number), {}).get("hidden") in ("1", "true"):
                continue
            values = {cell["column"]: cell["value"] for cell in cells if cell["value"] is not None and cell["column"] not in hidden}
            yield number, [values.get(i) for i in range(1, max(values, default=0) + 1) if i not in hidden]


def check_archive(archive: zipfile.ZipFile) -> None:
    """Zip-bomb and path checks on the central directory, before any entry is read. Python's zipfile never unpacks
    more than an entry's declared size, so the declared sizes can be trusted."""
    entries = archive.infolist()
    if len(entries) > MAX_ENTRIES:
        raise Rejected(f"an archive with over {MAX_ENTRIES:,} entries")
    if sum(entry.file_size for entry in entries) > MAX_UNZIPPED:
        raise Rejected(f"a zip bomb: it unpacks to over {MAX_UNZIPPED // MB} MB")
    for entry in entries:
        if entry.file_size > MB and entry.file_size > MAX_RATIO * entry.compress_size:
            raise Rejected(f"a zip bomb: an entry unpacks to over {MAX_RATIO} times its size")
        if UNSAFE_PATH.search(entry.filename):
            raise Rejected(f"an archive entry with an unsafe path ({clean(entry.filename)[:100]})")


def xlsx_flags(archive: zipfile.ZipFile) -> set[str]:
    flags = set()
    for name in archive.namelist():
        lower = name.lower()
        if lower.endswith("vbaproject.bin") or lower.startswith("xl/macrosheets/"):
            flags.add("macros")
        elif lower.startswith(("xl/embeddings/", "xl/activex/")):
            flags.add("ole_object")
        elif lower.startswith("xl/externallinks/") and lower.endswith(".xml"):
            flags.add("dde" if b"ddeLink" in archive.read(name) else "external_link")
        elif lower.endswith(".rels"):
            # A cell's hyperlink is harmless here; any other external target is something Excel would fetch or open.
            for rel in fromstring(archive.read(name)):
                if rel.get("TargetMode") == "External" and not rel.get("Type", "").endswith("/hyperlink"):
                    flags.add("external_link")
        elif lower.startswith("xl/worksheets/") and has_dde_formula(archive, name):
            flags.add("dde")
    return flags


def has_dde_formula(archive: zipfile.ZipFile, name: str) -> bool:
    """Whether a worksheet has a DDE formula. Its XML is read a megabyte at a time, so a large sheet isn't held whole;
    each read starts with the end of the one before, so a formula split between them is still found."""
    rest = b""
    with archive.open(name) as part:
        while chunk := part.read(MB):
            xml = rest + chunk
            for formula in FORMULA.findall(xml):
                if DDE.search(QUOTED.sub("", html.unescape(formula.decode("utf-8", "replace")))):
                    return True
            rest = xml[-64 * 1024 :]  # longer than any formula Excel opens
    return False


def decode(data: bytes) -> tuple[str, str]:
    """The document as text and its encoding: UTF-8 when it decodes as UTF-8, else charset-normalizer's best guess."""
    try:
        text, encoding = data.decode("utf-8"), "utf-8"
    except UnicodeDecodeError:
        best = charset_normalizer.from_bytes(data).best()
        if best is None:
            raise Rejected("binary data that isn't a PDF, Excel workbook, CSV or JSON file")
        text, encoding = str(best), best.encoding
    if "\x00" in text:
        raise Rejected("binary data that isn't a PDF, Excel workbook, CSV or JSON file")
    return text.removeprefix("\ufeff"), encoding


def scan_csv(text: str, encoding: str, doc: dict) -> tuple[list, list]:
    # A small sample keeps the sniffer's regular expressions quick on any input.
    try:
        dialect = csv.Sniffer().sniff(text[: 16 * 1024], delimiters=",;\t|")
    except csv.Error:
        raise Rejected("text that isn't a CSV or JSON file")
    doc["type"] = "csv"
    header, rows = split_header(enumerate(csv.reader(io.StringIO(text, newline=""), dialect), start=1))
    kept = list(islice(rows, MAX_ROWS + 1))  # one over the cap, so a parse knows when it stopped short
    count = len(kept) + sum(1 for _ in rows)
    doc["meta"] = {"encoding": encoding, "delimiter": dialect.delimiter, "columns": names(header), "rows": count}
    return header, kept


def parse_csv(scanned: tuple[list, list], doc: dict, caps: Caps) -> None:
    header, rows = scanned
    doc["tables"] = [table(None, header, rows, caps)] if header else []


def split_header(rows):
    """A table's header and an iterator over the rows after it, from (row number, values) pairs; empty rows are left
    out. The header is the first of the leading rows that is mostly text and spans at least half the widest of them,
    so a title above it isn't taken for it."""
    rows = ((number, values) for number, values in rows if filled(values))
    first = list(islice(rows, 10))
    if not first:
        return [], iter(())
    width = max(len(filled(values)) for _, values in first)
    for i, (_, values) in enumerate(first):
        cells = filled(values)
        words = [v for v in cells if isinstance(v, str) and not NUMBER.fullmatch(v.strip())]
        if 2 * len(cells) >= width and 2 * len(words) > len(cells):
            break
    else:
        i = 0
    return first[i][1], chain(first[i + 1 :], rows)


def filled(values: list) -> list:
    return [v for v in values if v not in (None, "")]


def scan_json(text: str, encoding: str, doc: dict) -> list:
    if max(accumulate(map(DEPTH.__getitem__, BRACKETS.findall(text))), default=0) > MAX_DEPTH:
        raise Rejected(f"JSON nested over {MAX_DEPTH} levels deep")
    decoder = json.JSONDecoder(parse_constant=not_json)
    start = SPACE.match(text).end()
    if text.startswith("[", start):
        shape, items = "array", array_items(decoder, text, start)
    else:
        value, end = decoder.raw_decode(text, start)
        if SPACE.match(text, end).end() == len(text):
            doc["meta"] = {"encoding": encoding, "shape": "object", "columns": names(value), "rows": None}
            return []
        shape, items = "lines", (decoder.decode(line) for line in io.StringIO(text) if line.strip())
    count, kept = 0, []
    for item in items:  # one at a time, so a large file is never held decoded whole
        count += 1
        if isinstance(item, dict) and len(kept) <= MAX_ROWS:  # one over the cap, as for a CSV
            kept.append((count, item))
    doc["meta"] = {"encoding": encoding, "shape": shape, "columns": names(kept[0][1]) if kept else [], "rows": count}
    return kept


def array_items(decoder: json.JSONDecoder, text: str, start: int):
    """The items of the JSON array at `start`, decoded one by one."""
    i = SPACE.match(text, start + 1).end()
    if not text.startswith("]", i):
        while True:
            item, i = decoder.raw_decode(text, i)
            yield item
            i = SPACE.match(text, i).end()
            if not text.startswith(",", i):
                break
            i = SPACE.match(text, i + 1).end()
    if not text.startswith("]", i):
        raise ValueError(f"expected ',' or ']' at character {i}")
    if SPACE.match(text, i + 1).end() != len(text):
        raise ValueError(f"extra data after character {i}")


def not_json(constant: str):
    raise ValueError(f"{constant} isn't JSON")


def parse_json(kept: list, doc: dict, caps: Caps) -> None:
    """Rows from the objects of an array or JSON Lines; their keys, in the order first seen, are the headers."""
    header = list(dict.fromkeys(key for _, item in kept for key in item))
    rows = ((number, [item.get(key) for key in header]) for number, item in kept)
    doc["tables"] = [table(None, header, rows, caps)] if kept else []


def table(name: str | None, header: list, rows, caps: Caps) -> dict:
    """A table as it goes out: its headers, then (row number, values) rows while the caps allow, each at least as
    long as the header."""
    out = {"name": name, "headers": names(header), "rows": []}
    for number, values in rows:
        values = [caps.value(value) for value in values] + [None] * (len(header) - len(values))
        if not caps.row(values):
            break
        out["rows"].append({"row": number, "values": values})
    return out


# How each type of clean document is parsed, from what its scan opened.
PARSERS = {"pdf": parse_pdf, "xlsx": parse_xlsx, "csv": parse_csv, "json": parse_json}


def clean(text: str) -> str:
    """NFKC-normalized (ligatures and full-width forms become plain letters), with invisible characters removed."""
    return INVISIBLE.sub("", unicodedata.normalize("NFKC", text))


def meta_value(value) -> str | None:
    """A metadata value as text: dates in ISO 8601, anything else cleaned and capped; None when it is missing."""
    if isinstance(value, datetime):
        return value.isoformat()
    return clean(str(value))[:MAX_TEXT] if value not in (None, "") else None


def names(values) -> list[str]:
    """Column names: a header's values or an object's keys."""
    return [meta_value(value) or "" for value in values]


def attempt(get):
    """A value that may fail to read in a damaged file, as None when it does."""
    try:
        return get()
    except Exception:
        return None


def dump(value) -> bytes:
    """JSON as UTF-8; a lone surrogate, which UTF-8 can't hold, goes out as "?"."""
    return json.dumps(value, ensure_ascii=False).encode("utf-8", "replace")


def limit_resources() -> None:
    """Limits this process before it reads a document: its memory, CPU time and open files, and no files written."""
    for limit, value in ((resource.RLIMIT_AS, MAX_MEMORY), (resource.RLIMIT_CPU, math.ceil(TIMEOUT)),
                         (resource.RLIMIT_FSIZE, 0), (resource.RLIMIT_NOFILE, 32)):
        resource.setrlimit(limit, (value, value))


class Service(BaseHTTPRequestHandler):
    """docparse over HTTP: each document POSTed is read by a fresh docparse process, killed at the timeout."""

    timeout = 60  # a client that stops sending mid-document is dropped

    def do_GET(self) -> None:
        if self.path == "/health":
            self.reply(200, dump({"status": "ok"}))
        else:
            self.reply(404, dump({"error": "not_found", "message": "POST a document to /"}))

    def do_POST(self) -> None:
        size = int(self.headers.get("Content-Length") or -1)
        if size < 0:
            return self.reply(411, dump({"error": "bad_request", "message": "send the document with a Content-Length"}))
        if size > MAX_BYTES:
            self.close_connection = True  # the document is left unread
            return self.reply(200, dump(rejected(TOO_LARGE, None)))
        document = self.rfile.read(size)
        parse = parse_qs(urlsplit(self.path).query).get("parse") == ["1"]
        args = [sys.executable, os.path.abspath(__file__), *(["--parse"] if parse else [])]
        try:
            done = subprocess.run(args, input=document, capture_output=True, timeout=TIMEOUT)
        except subprocess.TimeoutExpired:  # the process is killed by now
            return self.reply(504, dump({"error": "timeout", "message": f"took longer than {TIMEOUT:g} s, so it was stopped"}))
        if done.returncode != 0:
            message = f"exited with {done.returncode}: {done.stderr.decode('utf-8', 'replace')[-300:]}"
            return self.reply(500, dump({"error": "failed", "message": message}))
        self.reply(200, done.stdout)

    def reply(self, status: int, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    args = sys.argv[1:]
    if args == ["serve"]:
        ThreadingHTTPServer(("0.0.0.0", PORT), Service).serve_forever()
        return
    if args not in ([], ["--parse"]):
        sys.exit("usage: docparse [--parse] < document, or docparse serve")
    limit_resources()
    if seconds := os.environ.get("DOCPARSE_TEST_SLEEP"):  # test-only: a parser that hangs, for the suite to kill
        sleep(float(seconds))
    sys.stdout.buffer.write(dump(read(sys.stdin.buffer.read(MAX_BYTES + 1), parse=args == ["--parse"])))


if __name__ == "__main__":
    main()
