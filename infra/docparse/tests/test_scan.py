"""The scan of clean documents: what they are, from their content alone, and what they say about themselves."""

import io
import json
import unittest
import zipfile
from datetime import date

from support import run, stream, text_pdf, xlsx

XMP = b"""<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Voice API guide</rdf:li></rdf:Alt></dc:title>
<dc:creator><rdf:Seq><rdf:li>Ann Lee</rdf:li><rdf:li>Bo Chen</rdf:li></rdf:Seq></dc:creator>
<pdf:Keywords>voice, api</pdf:Keywords><xmp:CreateDate>2023-05-06T07:08:09Z</xmp:CreateDate>
</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>"""


class Pdf(unittest.TestCase):
    def test_a_clean_pdf_gives_its_info_and_page_count(self):
        info = b"<< /Title (Annual report) /Author (Jane Roe) /Subject (Leads) /Keywords (leads, data) /CreationDate (D:20240102030405+01'00') /ModDate (not a date) >>"
        result = run(text_pdf(["First page", "Second page"], info=info))
        self.assertEqual(result["verdict"], "clean")
        self.assertEqual(result["type"], "pdf")
        self.assertEqual(result["flags"], [])
        self.assertEqual(result["meta"], {
            "title": "Annual report", "author": "Jane Roe", "subject": "Leads", "keywords": "leads, data",
            "created": "2024-01-02T03:04:05+01:00", "modified": None, "pages": 2,
        })

    def test_xmp_metadata_fills_in_what_info_lacks(self):
        result = run(text_pdf(["Hello"], catalog=b"/Metadata 4 0 R", extra=(stream(XMP, b"/Type /Metadata /Subtype /XML"),)))
        self.assertEqual(result["verdict"], "clean")
        meta = result["meta"]
        self.assertEqual((meta["title"], meta["author"], meta["keywords"]), ("Voice API guide", "Ann Lee, Bo Chen", "voice, api"))
        self.assertTrue(meta["created"].startswith("2023-05-06T07:08:09"))

    def test_an_open_action_that_only_sets_the_first_view_is_not_active_content(self):
        # LaTeX's hyperref writes one into most papers.
        self.assertEqual(run(text_pdf(["Paper"], catalog=b"/OpenAction [4 0 R /Fit]"))["verdict"], "clean")
        goto = text_pdf(["Paper"], catalog=b"/OpenAction 4 0 R", extra=(b"<< /S /GoTo /D [5 0 R /Fit] >>",))
        self.assertEqual(run(goto)["verdict"], "clean")

    def test_a_damaged_pdf_is_rejected(self):
        result = run(b"%PDF-1.7\nthis is not a PDF body")
        self.assertEqual((result["verdict"], result["type"]), ("rejected", "pdf"))
        self.assertTrue(result["reason"])


class Workbook(unittest.TestCase):
    def test_a_clean_workbook_gives_its_properties_and_sheets(self):
        def build(wb):
            wb.properties.title, wb.properties.creator, wb.properties.keywords = "Suppliers", "Ops team", "2024"
            ws = wb.active
            ws.title = "Suppliers"
            ws.append(["Company", "City", "Since"])
            ws.append(["Acme", "Paris", date(2001, 2, 3)])
            hidden = wb.create_sheet("Notes")
            hidden.sheet_state = "hidden"
            hidden.append(["x"])

        result = run(xlsx(build))
        self.assertEqual((result["verdict"], result["type"], result["flags"]), ("clean", "xlsx", []))
        meta = result["meta"]
        self.assertEqual((meta["title"], meta["author"], meta["keywords"]), ("Suppliers", "Ops team", "2024"))
        self.assertEqual(meta["sheets"], [
            {"name": "Suppliers", "hidden": False, "rows": 2, "columns": 3},
            {"name": "Notes", "hidden": True, "rows": 1, "columns": 1},
        ])

    def test_a_zip_that_is_not_a_workbook_is_rejected(self):
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as archive:
            archive.writestr("notes.txt", "hello")
        result = run(out.getvalue())
        self.assertEqual((result["verdict"], result["type"]), ("rejected", None))
        self.assertIn("isn't an Excel workbook", result["reason"])


class Csv(unittest.TestCase):
    def test_columns_and_rows(self):
        result = run(b"company,city\nAcme,Paris\nBeta,Oslo\n\nGamma,Rome\n")
        self.assertEqual((result["verdict"], result["type"]), ("clean", "csv"))
        self.assertEqual(result["meta"], {"encoding": "utf-8", "delimiter": ",", "columns": ["company", "city"], "rows": 3})

    def test_the_header_is_found_below_a_title(self):
        result = run(b"Supplier list 2024;;\ncompany;city;employees\nAcme;Paris;12\nBeta;Oslo;7\n")
        self.assertEqual(result["meta"]["delimiter"], ";")
        self.assertEqual((result["meta"]["columns"], result["meta"]["rows"]), (["company", "city", "employees"], 2))

    def test_encodings(self):
        bom = run("﻿company,ville\nÉcole,Paris\n".encode("utf-8"))
        self.assertEqual((bom["meta"]["encoding"], bom["meta"]["columns"]), ("utf-8", ["company", "ville"]))
        latin = run("société;ville\nÉcole;Zürich\nCafé;Genève\n".encode("cp1252"))
        self.assertEqual(latin["meta"]["columns"], ["société", "ville"])
        excel = run("company\tcity\nTokyo Co\t東京\n".encode("utf-16"))  # Excel's "Unicode text"
        self.assertEqual((excel["meta"]["delimiter"], excel["meta"]["columns"]), ("\t", ["company", "city"]))


class Json(unittest.TestCase):
    def test_an_array_of_objects(self):
        result = run(json.dumps([{"company": "Acme", "city": "Paris"}, {"company": "Beta"}]).encode())
        self.assertEqual((result["verdict"], result["type"]), ("clean", "json"))
        self.assertEqual(result["meta"], {"encoding": "utf-8", "shape": "array", "columns": ["company", "city"], "rows": 2})

    def test_an_object(self):
        result = run(b' {"results": [], "next": null} ')
        self.assertEqual(result["meta"], {"encoding": "utf-8", "shape": "object", "columns": ["results", "next"], "rows": None})

    def test_json_lines(self):
        result = run(b'{"company": "Acme"}\n{"company": "Beta"}\n\n{"company": "Gamma"}\n')
        self.assertEqual(result["meta"], {"encoding": "utf-8", "shape": "lines", "columns": ["company"], "rows": 3})

    def test_broken_json_is_rejected(self):
        for broken in (b'[{"a": 1},]', b'[1, 2', b'[1] [2]', b'{"a": NaN}'):
            with self.subTest(broken):
                result = run(broken)
                self.assertEqual((result["verdict"], result["type"]), ("rejected", "json"))


class Other(unittest.TestCase):
    def test_text_that_is_not_a_document_is_rejected(self):
        for text in (b"just a line of prose\nand another\n", b'<?xml version="1.0"?><feed></feed>'):
            with self.subTest(text):
                result = run(text)
                self.assertEqual((result["verdict"], result["type"]), ("rejected", None))

    def test_binary_data_is_rejected(self):
        result = run(bytes(range(256)) * 64)
        self.assertEqual((result["verdict"], result["type"]), ("rejected", None))


if __name__ == "__main__":
    unittest.main()
