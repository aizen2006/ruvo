"""The parse of clean documents: a PDF's text with page offsets, and rows with headers from the other types."""

import json
import unittest
from datetime import date, datetime

from support import run, stream, text_pdf, xlsx

# A font whose codes 1 to 4 are a zero-width space, a soft hyphen, the "fi" ligature and an emoji.
CMAP = b"""/CIDInit /ProcSet findresource begin 12 dict begin begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Test def
1 begincodespacerange <00> <FF> endcodespacerange
4 beginbfchar <01> <200B> <02> <00AD> <03> <FB01> <04> <D83DDE00> endbfchar
endcmap CMapName currentdict /CMap defineresource pop end end"""
MAPPED_FONT = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode 4 0 R >>"


def mapped_pdf(pages: list[str]) -> bytes:
    return text_pdf(pages, font=MAPPED_FONT, extra=(stream(CMAP),))


def table(result: dict) -> tuple[list, list]:
    found = result["tables"][0]
    return found["headers"], [(row["row"], row["values"]) for row in found["rows"]]


class Pdf(unittest.TestCase):
    def test_pages_are_joined_with_where_each_starts(self):
        result = run(text_pdf(["First page", "Second\npage", "Third"]), parse=True)
        self.assertEqual((result["verdict"], result["capped"], result["flags"]), ("clean", False, []))
        self.assertEqual(result["text"], "First page\n\nSecond\npage\n\nThird")
        self.assertEqual(result["pageStarts"], [0, 12, 25])

    def test_text_is_normalized_and_broken_words_are_joined(self):
        # The zero-width space goes, the ligature becomes letters, and "exam-ple" (a soft hyphen at the line's end)
        # is joined; "well-" stays, as the next line goes on in upper case.
        result = run(mapped_pdf(["ze\x01ro of\x03ce exam\x02\nple and well-\nKnown"]), parse=True)
        self.assertEqual(result["text"], "zero office example and well-\nKnown")

    def test_page_starts_count_utf16_code_units_as_javascript_does(self):
        # The emoji is one character in Python, but two code units in a JavaScript string.
        result = run(mapped_pdf(["smile \x04", "next"]), parse=True)
        self.assertEqual(result["text"], "smile \U0001f600\n\nnext")
        self.assertEqual(result["pageStarts"], [0, 10])

    def test_without_parse_there_is_no_text(self):
        result = run(text_pdf(["Hello"]))
        self.assertEqual((result["verdict"], result["text"], result["pageStarts"], result["tables"]), ("clean", None, None, None))


class Workbook(unittest.TestCase):
    def test_visible_cells_only_with_dates_and_no_formulas(self):
        def build(wb):
            ws = wb.active
            ws.title = "Suppliers"
            ws.append(["Supplier list"])  # a title above the header
            ws.append(["Company", "City", "Secret", "Since", "Total"])
            ws.append(["Acme", "Paris", "x", date(2001, 2, 3), "=1+2"])
            ws.append(["Hidden Co", "Rome", "y", date(2002, 2, 3), 5])
            ws.append(["Beta", "Oslo", "z", datetime(1999, 1, 2, 10, 30), 7])
            ws.row_dimensions[4].hidden = True
            ws.column_dimensions["C"].hidden = True
            notes = wb.create_sheet("Notes")
            notes.sheet_state = "hidden"
            notes.append(["Never", "read"])

        result = run(xlsx(build), parse=True)
        self.assertEqual((result["verdict"], result["capped"]), ("clean", False))
        self.assertEqual(len(result["tables"]), 1)
        self.assertEqual(result["tables"][0]["name"], "Suppliers")
        headers, rows = table(result)
        self.assertEqual(headers, ["Company", "City", "Since", "Total"])
        # A formula's cell holds the value Excel saved with it (none here, as nothing calculated it): never evaluated.
        self.assertEqual(rows, [
            (3, ["Acme", "Paris", "2001-02-03T00:00:00", None]),
            (5, ["Beta", "Oslo", "1999-01-02T10:30:00", 7]),
        ])


class Csv(unittest.TestCase):
    def test_rows_keep_their_numbers_in_the_file(self):
        csv = b'Supplier list,,\ncompany,city,note\nAcme,Paris,"two\nlines"\n\nBeta,Oslo,\n'
        headers, rows = table(run(csv, parse=True))
        self.assertEqual(headers, ["company", "city", "note"])
        self.assertEqual(rows, [(3, ["Acme", "Paris", "two\nlines"]), (5, ["Beta", "Oslo", ""])])

    def test_other_encodings_and_delimiters(self):
        headers, rows = table(run("société;ville\nÉcole;Zürich\n".encode("cp1252"), parse=True))
        self.assertEqual((headers, rows), (["société", "ville"], [(2, ["École", "Zürich"])]))

    def test_a_long_value_is_capped(self):
        result = run(b"company,about\nAcme," + b"x" * 5000 + b"\n", parse=True)
        self.assertTrue(result["capped"])
        self.assertEqual(len(table(result)[1][0][1][1]), 2000)


class Json(unittest.TestCase):
    def test_an_array_of_objects_becomes_rows(self):
        items = [{"company": "Acme", "tags": ["a", "b"]}, 3, {"company": "Beta", "city": "Oslo"}]
        headers, rows = table(run(json.dumps(items).encode(), parse=True))
        self.assertEqual(headers, ["company", "tags", "city"])
        self.assertEqual(rows, [(1, ["Acme", '["a", "b"]', None]), (3, ["Beta", None, "Oslo"])])

    def test_json_lines_become_rows(self):
        headers, rows = table(run(b'{"company": "Acme"}\n{"company": "Beta", "open": true}\n', parse=True))
        self.assertEqual((headers, rows), (["company", "open"], [(1, ["Acme", None]), (2, ["Beta", True])]))

    def test_an_object_has_no_rows(self):
        result = run(b'{"company": "Acme"}', parse=True)
        self.assertEqual((result["verdict"], result["tables"]), ("clean", []))


if __name__ == "__main__":
    unittest.main()
