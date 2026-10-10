"""The container itself: the suite runs with the sandbox's isolation (bun run test:sandbox in apps/server)."""

import os
import resource
import socket
import subprocess
import sys
import time
import unittest

from support import DOCPARSE


class Container(unittest.TestCase):
    def test_each_run_limits_its_own_process(self):
        # The suite's hook keeps docparse waiting before it reads the document, so its limits can be read meanwhile.
        reader = subprocess.Popen([sys.executable, DOCPARSE], stdin=subprocess.DEVNULL, env={**os.environ, "DOCPARSE_TEST_SLEEP": "600"})
        expected = {resource.RLIMIT_AS: 512 << 20, resource.RLIMIT_CPU: 30, resource.RLIMIT_FSIZE: 0, resource.RLIMIT_NOFILE: 32}
        try:
            for _ in range(100):  # until it has set them
                limits = {limit: resource.prlimit(reader.pid, limit) for limit in expected}
                if limits[resource.RLIMIT_FSIZE] == (0, 0):
                    break
                time.sleep(0.05)
            self.assertEqual(limits, {limit: (value, value) for limit, value in expected.items()})
        finally:
            reader.kill()
            reader.wait()

    def test_there_is_no_network(self):
        with self.assertRaises(socket.gaierror):
            socket.getaddrinfo("example.com", 443)
        with self.assertRaises(OSError):
            socket.create_connection(("1.1.1.1", 443), timeout=5).close()

    def test_nothing_outside_tmp_can_be_written(self):
        for path in ("/evil", "/app/docparse.py", "/tests/evil", "/home/evil", "/var/tmp/evil"):
            with self.subTest(path), self.assertRaises(OSError):
                open(path, "a").close()
        with open("/tmp/scratch", "w") as scratch:
            scratch.write("ok")
        os.remove("/tmp/scratch")

    def test_it_runs_as_nobody(self):
        self.assertEqual((os.getuid(), os.getgid()), (65534, 65534))


if __name__ == "__main__":
    unittest.main()
