"""The container itself: the suite runs with the sandbox's isolation (bun run test:sandbox in apps/server)."""

import os
import socket
import unittest


class Container(unittest.TestCase):
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
