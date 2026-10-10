"""docparse serve, the all-Docker setup's sandbox. The rest of the suite also runs through it (DOCPARSE_VIA=service)."""

import http.client
import json
import os
import time
import unittest

from support import post, service, start_service, text_pdf


def readers() -> list[int]:
    """The docparse processes reading a document right now: not the services."""
    pids = []
    for pid in filter(str.isdigit, os.listdir("/proc")):
        try:
            with open(f"/proc/{pid}/cmdline", "rb") as cmdline:
                args = cmdline.read().split(b"\0")
        except OSError:
            continue  # it ended meanwhile
        if any(arg.endswith(b"docparse.py") for arg in args) and b"serve" not in args:
            pids.append(int(pid))
    return pids


class Service(unittest.TestCase):
    def test_a_hung_parser_is_killed_at_the_timeout(self):
        # The suite's hook makes each document's process hang, as a parser stuck on a hostile file would.
        hung = start_service(8101, DOCPARSE_TIMEOUT="2", DOCPARSE_TEST_SLEEP="600")
        try:
            started = time.monotonic()
            status, reply = post(8101, text_pdf(["Hello"]), parse=True)
            self.assertEqual((status, reply["error"]), (504, "timeout"))
            self.assertLess(time.monotonic() - started, 10)
            self.assertEqual(readers(), [])
        finally:
            hung.kill()
            hung.wait()

    def test_a_document_over_the_size_cap_is_rejected_unread(self):
        connection = http.client.HTTPConnection("127.0.0.1", service(), timeout=10)
        connection.putrequest("POST", "/")
        connection.putheader("Content-Length", str(65 << 20))
        connection.endheaders()
        reply = connection.getresponse()
        result = json.load(reply)
        self.assertEqual((reply.status, result["verdict"], result["reason"]), (200, "rejected", "larger than 64 MB"))
        connection.close()


if __name__ == "__main__":
    unittest.main()
