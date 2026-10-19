"""Loopback-only, byte-transparent TLS transport to QEMU's tiny accept queue."""
import select
import socket
import socketserver
import threading
import time


class TLSForwarder(socketserver.ThreadingMixIn, socketserver.TCPServer):
    request_queue_size = 128
    daemon_threads = True
    allow_reuse_address = False

    def __init__(self, port, guest_port):
        self.guest_port = guest_port
        self.stopping = threading.Event()
        self.slots = threading.BoundedSemaphore(64)
        super().__init__(('127.0.0.1', port), ForwardTLS)

    def server_bind(self):
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()

    def shutdown(self):
        self.stopping.set()
        super().shutdown()


class ForwardTLS(socketserver.BaseRequestHandler):
    def handle(self):
        upstream = None
        try:
            # libslirp tcpx_listen uses listen(s, 1). Windows refuses bursts
            # when that accept queue is full. Retry only TCP establishment:
            # NO client bytes have been read/sent, so no HTTP write is replayed.
            deadline = time.monotonic() + 10
            while not self.server.stopping.is_set():
                try:
                    upstream = socket.create_connection(('127.0.0.1', self.server.guest_port), 1)
                    break
                except (ConnectionRefusedError, TimeoutError):
                    if time.monotonic() >= deadline:
                        return
                    self.server.stopping.wait(0.025)
            if upstream is None:
                return
            self.request.settimeout(10)
            upstream.settimeout(10)
            peers = {self.request: upstream, upstream: self.request}
            readers = list(peers)
            idle = time.monotonic() + 90
            while readers and not self.server.stopping.is_set() and time.monotonic() < idle:
                ready, _, _ = select.select(readers, [], [], 0.5)
                for source in ready:
                    data = source.recv(65536)
                    if not data:
                        # Preserve half-close and drain the other direction.
                        # In particular, acknowledge a graceful TLS/TCP close
                        # before releasing an exclusive Windows listener.
                        readers.remove(source)
                        peers[source].shutdown(socket.SHUT_WR)
                        continue
                    peers[source].sendall(data)
                    idle = time.monotonic() + 90
        except OSError:
            # Close the stream on failure. Never reconnect or replay TLS/HTTP.
            pass
        finally:
            if upstream is not None:
                upstream.close()
