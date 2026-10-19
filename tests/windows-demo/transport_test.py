"""Transport checks use real TLS; no certificate validation bypass or HTTP replay."""
import concurrent.futures
import http.client
import http.server
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'windows-demo'))
from transport import TLSForwarder


class TransportTests(unittest.TestCase):
    def test_tls_burst_delayed_accept_and_no_write_replay(self):
        with tempfile.TemporaryDirectory() as tmp:
            key, cert = str(Path(tmp) / 'key.pem'), str(Path(tmp) / 'cert.pem')
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            writes = []
            payload = bytes(range(256)) * 512
            class Handler(http.server.BaseHTTPRequestHandler):
                def log_message(self, *args): pass
                def do_GET(self):
                    self.send_response(200); self.send_header('Content-Length', str(len(payload))); self.end_headers(); self.wfile.write(payload)
                def do_POST(self):
                    writes.append(self.rfile.read(int(self.headers['Content-Length'])))
                    self.send_response(200); self.send_header('Content-Length', '2'); self.end_headers(); self.wfile.write(b'OK')
            guest = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler, bind_and_activate=False)
            guest.server_bind()
            server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            server_context.load_cert_chain(cert, key)
            guest.socket = server_context.wrap_socket(guest.socket, server_side=True)
            forward = TLSForwarder(0, guest.server_address[1])
            threading.Thread(target=forward.serve_forever, daemon=True).start()
            ca = ssl.create_default_context(cafile=cert)
            def call(method='GET', data=None, context=ca):
                c = http.client.HTTPSConnection('127.0.0.1', forward.server_address[1], context=context, timeout=15)
                try:
                    c.request(method, '/', data)
                    r = c.getresponse(); self.assertEqual(r.status, 200); return r.read()
                finally: c.close()
            try:
                # Client TLS bytes are queued while TCP connect is refused.
                with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:
                    first = pool.submit(call, 'POST', b'write once')
                    time.sleep(0.2)
                    guest.server_activate()
                    threading.Thread(target=guest.serve_forever, daemon=True).start()
                    self.assertEqual(first.result(), b'OK')
                    self.assertEqual(writes, [b'write once'])
                    results = list(pool.map(lambda _: call(), range(24)))
                    self.assertTrue(all(r == payload for r in results))
                with self.assertRaises(ssl.SSLCertVerificationError): call(context=ssl.create_default_context())
            finally:
                forward.shutdown(); forward.server_close(); guest.shutdown(); guest.server_close()
            self.assertTrue(forward.stopping.is_set())


if __name__ == '__main__': unittest.main()
