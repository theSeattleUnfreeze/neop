#!/usr/bin/env python3
"""Loopback JSON-RPC proxy for a StartOS bitcoind (Knots) package.

Runs on the StartOS host. Listens on 127.0.0.1 only, reads the node cookie
on this host, and replaces whatever Authorization header the client sends.
The cookie never leaves this machine; reach the proxy through an SSH -L
tunnel.

HTTP/1.1 clients such as Fulcrum pipeline several requests on one
connection, so each side keeps its own read buffer: bytes past the end of
one message belong to the next one and must not be dropped.

The cookie is re-read for every client connection so a node restart (new
cookie) does not need a proxy restart.

Usage (on StartOS, as root so the package volume is readable):
  nohup python3 startos-rpc-auth-proxy.py >/tmp/rpc-auth-proxy.log 2>&1 &
"""
import argparse
import base64
import socket
import threading
from pathlib import Path

DEFAULT_COOKIE = "/media/startos/data/package-data/volumes/bitcoind/data/main/.cookie"
DEFAULT_UPSTREAM = "10.0.3.1:50810"
DEFAULT_LISTEN = "127.0.0.1:15081"
MAX_HEAD = 64 * 1024
IO_TIMEOUT = 900


def hostport(value: str):
    host, _, port = value.rpartition(":")
    return host, int(port)


class Peer:
    """A socket plus the bytes already read past the last full message."""

    def __init__(self, sock: socket.socket):
        self.sock = sock
        self.buf = bytearray()

    def _fill(self) -> bool:
        chunk = self.sock.recv(1 << 20)
        if not chunk:
            return False
        self.buf += chunk
        return True

    def read_message(self):
        """Return (head, body) for the next HTTP message, or (None, None) on EOF."""
        while True:
            end = self.buf.find(b"\r\n\r\n")
            if end >= 0:
                break
            if len(self.buf) > MAX_HEAD:
                raise RuntimeError("headers too large")
            if not self._fill():
                return None, None
        head = bytes(self.buf[:end])
        del self.buf[: end + 4]
        n = content_length(head)
        while len(self.buf) < n:
            if not self._fill():
                return None, None
        body = bytes(self.buf[:n])
        del self.buf[:n]
        return head, body


def content_length(head: bytes) -> int:
    for line in head.split(b"\r\n"):
        if line.lower().startswith(b"content-length:"):
            return int(line.split(b":", 1)[1].strip())
    if b"transfer-encoding: chunked" in head.lower():
        raise RuntimeError("chunked transfer encoding is not supported")
    return 0


def auth_line(cookie_path: Path) -> bytes:
    token = base64.b64encode(cookie_path.read_text().strip().encode()).decode()
    return b"Authorization: Basic " + token.encode()


def rewrite(head: bytes, auth: bytes) -> bytes:
    lines = [ln for ln in head.split(b"\r\n") if not ln.lower().startswith(b"authorization:")]
    lines.insert(1, auth)
    return b"\r\n".join(lines)


def handle(client_sock: socket.socket, upstream_addr, cookie_path: Path) -> None:
    upstream_sock = None
    try:
        auth = auth_line(cookie_path)
        upstream_sock = socket.create_connection(upstream_addr, timeout=IO_TIMEOUT)
        client_sock.settimeout(IO_TIMEOUT)
        client, upstream = Peer(client_sock), Peer(upstream_sock)
        while True:
            head, body = client.read_message()
            if head is None:
                break
            upstream_sock.sendall(rewrite(head, auth) + b"\r\n\r\n" + body)
            rhead, rbody = upstream.read_message()
            if rhead is None:
                break
            client_sock.sendall(rhead + b"\r\n\r\n" + rbody)
    except Exception as exc:  # one bad connection must not take the proxy down
        print("connection error: {0}: {1}".format(type(exc).__name__, exc), flush=True)
    finally:
        for sock in (client_sock, upstream_sock):
            if sock is not None:
                try:
                    sock.close()
                except OSError:
                    pass


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--cookie", default=DEFAULT_COOKIE)
    ap.add_argument("--upstream", default=DEFAULT_UPSTREAM, help="node RPC host:port")
    ap.add_argument("--listen", default=DEFAULT_LISTEN, help="loopback host:port")
    args = ap.parse_args()
    listen = hostport(args.listen)
    if listen[0] not in ("127.0.0.1", "::1", "localhost"):
        raise SystemExit("refusing to listen on a non-loopback address")
    upstream = hostport(args.upstream)
    cookie = Path(args.cookie)
    auth_line(cookie)  # fail fast if the cookie is unreadable

    srv = socket.socket()
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(listen)
    srv.listen(64)
    print("proxy_up {0}:{1}".format(*listen), flush=True)
    while True:
        client, _addr = srv.accept()
        threading.Thread(target=handle, args=(client, upstream, cookie), daemon=True).start()


if __name__ == "__main__":
    main()
