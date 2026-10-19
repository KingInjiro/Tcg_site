# Portable Windows test kit (separate from production)

This work is based on merged PR #33, main `ead5a5ea0e4a725460be3532a416d893bc9666a7`.
The immutable source archive is `tcg-php-feba7dade013.zip`, SHA-256
`feba7dade0139115ee3df363d74491d83d91872f8b7bd38a041d7f48ec9cb6c8`.
The production activation key is neither loaded nor reused.

`release-manifest.json` records all 549 release files. `prepare-windows-demo.cjs`
rebuilds them and rejects any byte difference, except the test activation hash in
`admin/_app/release.php`. No PHP core, editor, public HTML/CSS/JS or source asset
is changed. Seed activation is unusable; the guest applies a random per-demo
activation hash before starting Apache. The actual public document root is
`/srv/tcg/public`; the existing PHP implementation creates its normal private
sibling under `/srv/tcg` with POSIX ownership and mode 0700.

## Runtime

The PHP core intentionally requires POSIX path/permission semantics, so running
the unchanged release using native Windows PHP would be inaccurate. The portable
kit runs it on a small Alpine Linux guest in QEMU TCG software emulation. The
tester installs neither a hypervisor nor WSL, Docker, Apache, PHP or Node.
Docker, npm and Python packaging scripts here are developer build dependencies.

Apache handles real TLS and real PHP requests, with no mocked transport and no
rewrite dependency. All host listeners explicitly bind `127.0.0.1`. The guest has
no default route or DNS and QEMU `restrict=on` adds a second outbound restriction.
No host filesystem is shared with the guest. The base disk is immutable; one
persistent qcow2 overlay stores the test site and private data.

Each boot creates a localhost-only certificate in the guest. Its public
certificate and SPKI reach the launcher through the private VM console. Python
validates HTTPS using this certificate; the dedicated portable Chromium profile
trusts only this SPKI using `--ignore-certificate-errors-spki-list`. No broad TLS
override or system trust-store modification is used. Chromium is restricted to
loopback via a dead external proxy and disabled background networking. External
SMTP, financial feeds and other external integrations cannot be tested offline.

The Python launcher joins a Windows Job with KILL_ON_JOB_CLOSE before spawning
children. Closing the initial admin tab requests a guest shutdown, waits for the
disk to sync and then cleans up the dedicated browser tree. Forced console close
also terminates the complete tree; avoid it during publication. Only files under
the marked `demo-data` directory are reset, with junction checks and a lock.

## Reproduction and checkpoints

1. On a Linux build machine with Docker and Node 24: `npm ci --ignore-scripts`.
2. `mkdir /tmp/tcg-demo-build`; `bash windows-demo/build-guest.sh /tmp/tcg-demo-build`.
3. With Python 3.11+ and 7z: `python3 windows-demo/package.py /tmp/tcg-demo-build /tmp/TCG-TEST-WINDOWS.zip`.
4. Extract on a real Windows x64 machine. Set `TCG_WINDOWS_DEMO` to its directory
   and run `node --test tests/windows-demo/cycle.cjs` in the developer checkout.
   These are developer test tools, not user runtime dependencies.

`.github/workflows/windows-demo.yml` builds one candidate and transfers that exact
ZIP to Windows Server 2022. Tests invoke START-DEMO.cmd from a clean Unicode path,
then use the actual shipped Chromium via CDP. They cover browser activation,
GrapesJS text/image editing, preview, save/reopen, menu, create/rename/delete,
publication, legacy URLs, restore, PWA, authentication/CSRF/path checks, malicious
upload, stale publication, external network restriction, TLS negative control,
process cleanup, persistent restart and reset. Root trust stores are compared.

At initial checkpoint, the original release comparison, 40 Node tests and 6 PHP
tests pass locally. Windows packaging/startup failures are being corrected; a
candidate is not a finished distributable until the full Windows job succeeds.
No production hosting claim follows from these tests. Main is unchanged.
