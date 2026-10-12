import importlib.util
import os
import socket
import tempfile
import threading
import unittest
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "startos_rpc_auth_proxy",
    os.path.join(os.path.dirname(__file__), "..", "scripts", "startos-rpc-auth-proxy.py"),
)
proxy = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(proxy)


def _listener():
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(8)
    return srv


def _fake_node(srv, seen_auth):
    """Answer each request with its own body, recording the Authorization header."""
    conn, _ = srv.accept()
    peer = proxy.Peer(conn)
    while True:
        head, body = peer.read_message()
        if head is None:
            break
        for line in head.split(b"\r\n"):
            if line.lower().startswith(b"authorization:"):
                seen_auth.append(line)
        conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: %d\r\n\r\n" % len(body) + body)
    conn.close()


def _request(body: bytes, auth: bytes = b"Authorization: Basic bm9wZTpub3Bl") -> bytes:
    return (b"POST / HTTP/1.1\r\nHost: x\r\n" + auth +
            b"\r\nContent-Length: %d\r\n\r\n" % len(body) + body)


class ProxyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cookie = Path(self.tmp.name) / ".cookie"
        self.cookie.write_text("__cookie__:secret\n")

    def tearDown(self):
        self.tmp.cleanup()

    def _run(self, payload: bytes, n: int):
        node = _listener()
        seen = []
        threading.Thread(target=_fake_node, args=(node, seen), daemon=True).start()
        front = _listener()

        def accept_one():
            client, _ = front.accept()
            proxy.handle(client, node.getsockname(), self.cookie)

        threading.Thread(target=accept_one, daemon=True).start()
        c = socket.create_connection(front.getsockname(), timeout=10)
        c.sendall(payload)
        reader = proxy.Peer(c)
        bodies = []
        for _ in range(n):
            head, body = reader.read_message()
            self.assertIsNotNone(head)
            bodies.append(body)
        c.close()
        return bodies, seen

    def test_pipelined_requests_in_one_write_all_answered(self):
        bodies = [b'{"id":%d}' % i for i in range(5)]
        got, _ = self._run(b"".join(_request(b) for b in bodies), len(bodies))
        self.assertEqual(got, bodies)

    def test_client_auth_replaced_with_cookie(self):
        _, seen = self._run(_request(b"{}"), 1)
        self.assertEqual(len(seen), 1)
        self.assertIn(b"X19jb29raWVfXzpzZWNyZXQ=", seen[0])  # base64("__cookie__:secret")

    def test_large_body_split_across_reads(self):
        big = b"x" * (3 << 20)
        got, _ = self._run(_request(big) + _request(b"after"), 2)
        self.assertEqual(got, [big, b"after"])


if __name__ == "__main__":
    unittest.main()
