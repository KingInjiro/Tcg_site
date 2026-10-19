"""Portable Windows demo infrastructure. Never imported by the production site."""
import base64
import csv
import ctypes
from ctypes import wintypes
import hashlib
import json
import msvcrt
import os
from pathlib import Path
import secrets
import shutil
import socket
import socketserver
import ssl
import subprocess
import sys
import time
import threading
import urllib.error
import urllib.request

from transport import TLSForwarder

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

ROOT = Path(__file__).absolute().parent
DATA = ROOT / 'demo-data'
MARKER = 'TCG isolated Windows demo data v1'
CHILD_FLAGS = subprocess.CREATE_NO_WINDOW
processes = []
job = None


def local_url(url, context=None):
    # Never inherit a system proxy or disable TLS validation.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=context))
    with opener.open(url, timeout=3) as response:
        return response.read()


def no_links(path):
    for part in [path, *path.parents]:
        if part.exists() or part.is_symlink():
            st = part.lstat()
            if part.is_symlink() or getattr(st, 'st_file_attributes', 0) & 0x400:
                raise RuntimeError('Не запускайте демо через символічні посилання або junction-папки.')


def protect_data():
    no_links(ROOT)
    no_links(DATA)
    existed = DATA.exists()
    if existed and (not (DATA / 'marker').is_file() or (DATA / 'marker').read_text('utf-8') != MARKER):
        raise RuntimeError('Папка demo-data не належить цьому демо. Її не буде змінено.')
    DATA.mkdir(exist_ok=True)
    user = subprocess.check_output(['whoami.exe', '/user', '/fo', 'csv', '/nh'], creationflags=CHILD_FLAGS).decode('utf-8', 'replace')
    sid = next(csv.reader([user.strip()]))[-1]
    if not sid.startswith('S-1-5-'):
        raise RuntimeError('Не вдалося визначити власника тестових даних.')
    try:
        subprocess.run(['icacls.exe', str(DATA), '/inheritance:r', '/grant:r', f'*{sid}:(OI)(CI)F', '*S-1-5-18:(OI)(CI)F', '/Q'], check=True, stdout=subprocess.DEVNULL, creationflags=CHILD_FLAGS)
    except subprocess.CalledProcessError:
        raise RuntimeError('Не вдалося захистити тестові дані. Перемістіть комплект у власну локальну папку на NTFS.') from None
    if not existed:
        (DATA / 'marker').write_text(MARKER, 'utf-8')


def contain_children():
    # Put ourselves in a nested Job before spawning anything. Children inherit it
    # atomically. Closing the console/crashing releases the last job handle and
    # kills the entire dedicated process tree (never the user's normal browser).
    global job
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)

    class BASIC(ctypes.Structure):
        _fields_ = [('PerProcessUserTimeLimit', ctypes.c_int64), ('PerJobUserTimeLimit', ctypes.c_int64), ('LimitFlags', wintypes.DWORD), ('MinimumWorkingSetSize', ctypes.c_size_t), ('MaximumWorkingSetSize', ctypes.c_size_t), ('ActiveProcessLimit', wintypes.DWORD), ('Affinity', ctypes.c_size_t), ('PriorityClass', wintypes.DWORD), ('SchedulingClass', wintypes.DWORD)]

    class IO(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in ['ReadOperationCount', 'WriteOperationCount', 'OtherOperationCount', 'ReadTransferCount', 'WriteTransferCount', 'OtherTransferCount']]

    class EXTENDED(ctypes.Structure):
        _fields_ = [('BasicLimitInformation', BASIC), ('IoInfo', IO), ('ProcessMemoryLimit', ctypes.c_size_t), ('JobMemoryLimit', ctypes.c_size_t), ('PeakProcessMemoryUsed', ctypes.c_size_t), ('PeakJobMemoryUsed', ctypes.c_size_t)]

    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    job = kernel.CreateJobObjectW(None, None)
    limits = EXTENDED()
    limits.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not job or not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or not kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess()):
        raise ctypes.WinError(ctypes.get_last_error())


def start(args, **options):
    p = subprocess.Popen([str(a) for a in args], cwd=ROOT, creationflags=CHILD_FLAGS, **options)
    processes.append(p)
    return p


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class RejectExternalProxy(socketserver.ThreadingTCPServer):
    daemon_threads = True


class RejectExternalRequest(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.settimeout(1)
        try:
            self.request.recv(8192)
            self.request.sendall(b'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
        except OSError:
            pass


def check_runtime():
    files = json.loads((ROOT / 'runtime-manifest.json').read_text('utf-8'))
    for name, expected in files.items():
        path = ROOT / name
        no_links(path)
        if not path.is_file() or hashlib.file_digest(path.open('rb'), 'sha256').hexdigest() != expected:
            raise RuntimeError('Комплект пошкоджений або неповний: ' + name + '. Розпакуйте ZIP заново в іншу папку.')


def wait_for(callback, timeout, child=None):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if child and child.poll() is not None:
            raise RuntimeError('Тестовий процес завершився. Подробиці — у demo-data/guest.log.')
        try:
            value = callback()
            if value:
                return value
        except (OSError, ValueError, urllib.error.URLError):
            pass
        time.sleep(0.4)
    raise RuntimeError('Час запуску вичерпано. Подробиці — у demo-data/guest.log.')


def prepare_browser_sandbox():
    # A ZIP has no installer to grant Chromium's Windows LPAC sandbox RX on
    # its own binaries. Never grant this on private data or parent directories.
    browser = ROOT / 'runtime/browser'
    for directory, dirs, files in os.walk(browser, followlinks=False):
        for name in dirs + files:
            no_links(Path(directory) / name)
    try:
        subprocess.run(['icacls.exe', str(browser), '/grant', '*S-1-15-2-1:(OI)(CI)RX', '*S-1-15-2-2:(OI)(CI)RX', '/T', '/L', '/Q'], check=True, stdout=subprocess.DEVNULL, creationflags=CHILD_FLAGS)
    except subprocess.CalledProcessError:
        raise RuntimeError('Не вдалося надати ізольованим процесам Chromium доступ до файлів браузера. Скопіюйте комплект у власну локальну папку на NTFS.') from None


def reset():
    if not DATA.exists():
        print('Тестове середовище вже чисте.')
        return
    protect_data()
    print('Буде видалено ТІЛЬКИ тестовий сайт, його пароль, зміни та історію.')
    if input('Щоб підтвердити повне скидання, введіть RESET: ').strip() != 'RESET':
        print('Скидання скасовано.')
        return
    # Refuse junctions anywhere in the tree before recursive deletion.
    for directory, dirs, files in os.walk(DATA, followlinks=False):
        for name in dirs + files:
            no_links(Path(directory) / name)
    shutil.rmtree(DATA)
    print('Готово. Наступний START-DEMO.cmd відкриє чисту копію сайту.')


def run_demo():
    protect_data()
    contain_children()
    if shutil.disk_usage(ROOT).free < 1024 ** 3:
        raise RuntimeError('Для тестового диска і профілю браузера потрібен щонайменше 1 ГБ вільного місця після розпакування.')
    print('Перевірка комплекту…', flush=True)
    check_runtime()
    prepare_browser_sandbox()
    cfg_file = DATA / 'settings.json'
    if cfg_file.exists():
        cfg = json.loads(cfg_file.read_text('utf-8'))
    else:
        cfg = {'activationKey': secrets.token_urlsafe(32), 'httpsPort': free_port()}
        cfg_file.write_text(json.dumps(cfg), 'utf-8')
    if not isinstance(cfg.get('httpsPort'), int) or not 1024 <= cfg['httpsPort'] <= 65535 or len(cfg.get('activationKey', '')) != 43:
        raise RuntimeError('Тестові налаштування пошкоджені. Використайте RESET-DEMO.cmd.')
    port = cfg['httpsPort']
    # A closed TCP listener can remain in TIME_WAIT. A bind probe without
    # SO_REUSEADDR would wrongly reject an immediate restart on Windows.
    with socket.socket() as probe:
        probe.settimeout(0.5)
        if probe.connect_ex(('127.0.0.1', port)) == 0:
            raise RuntimeError('Тестову адресу зайняла інша програма. Закрийте іншу копію демо й повторіть запуск.')
    control_port = free_port()
    guest_port = free_port()
    while guest_port in (port, control_port):
        guest_port = free_port()
    stop_token = secrets.token_urlsafe(32)
    boot = DATA / 'boot.json'
    boot.write_text(json.dumps({'activationKey': cfg['activationKey'], 'stopToken': stop_token}), 'utf-8')
    overlay = DATA / 'site.qcow2'
    if not overlay.exists():
        # All QEMU file arguments are ASCII and relative: its Windows CRT does
        # not reliably handle Unicode absolute paths. The backing path is
        # relative to the overlay, so moving the extracted kit also works.
        subprocess.run([str(ROOT / 'runtime/qemu/qemu-img.exe'), 'create', '-f', 'qcow2', '-F', 'raw', '-b', '../runtime/guest/base.raw', 'demo-data/site.qcow2'], check=True, creationflags=CHILD_FLAGS, stdout=subprocess.DEVNULL)
    console = DATA / 'guest.log'
    console.write_bytes(b'')
    log = console.open('ab', buffering=0)
    vm = start([ROOT / 'runtime/qemu/qemu-system-x86_64.exe', '-L', 'runtime/qemu/share', '-machine', 'pc,accel=tcg', '-cpu', 'max', '-smp', '2', '-m', '384M', '-display', 'none', '-no-reboot', '-monitor', 'none', '-kernel', 'runtime/guest/vmlinuz', '-initrd', 'runtime/guest/initramfs', '-append', 'root=/dev/vda rootfstype=ext4 modules=virtio_pci,virtio_blk,ext4 rw console=ttyS0 quiet panic=1', '-drive', 'file=demo-data/site.qcow2,format=qcow2,if=virtio', '-nic', 'none', '-netdev', f'user,id=n0,restrict=on,hostfwd=tcp:127.0.0.1:{guest_port}-10.0.2.15:8443', '-device', 'virtio-net-pci,netdev=n0', '-serial', 'stdio', '-serial', f'tcp:127.0.0.1:{control_port},server=on,wait=off', '-fw_cfg', 'name=opt/tcg/boot,file=demo-data/boot.json'], stdout=log, stderr=log, stdin=subprocess.DEVNULL)
    print('Запуск ізольованого PHP-сервера. Перший запуск може тривати до двох хвилин…', flush=True)
    control = None
    proxy = None
    forward = None
    browser_log = None
    try:
        control = wait_for(lambda: socket.create_connection(('127.0.0.1', control_port), 2), 30, vm)

        def tls_from_console():
            for line in console.read_text('utf-8', errors='replace').splitlines():
                if line.startswith('TCG-TLS:'):
                    return json.loads(line[8:])

        tls = wait_for(tls_from_console, 180, vm)
        boot.unlink(missing_ok=True)
        forward = TLSForwarder(port, guest_port)
        threading.Thread(target=forward.serve_forever, daemon=True).start()
        context = ssl.create_default_context(cadata=tls['certificate'])
        origin = f'https://127.0.0.1:{port}'
        wait_for(lambda: json.loads(local_url(origin + '/admin/api.php?action=session', context)).get('setupRequired') is not None, 30, vm)
        # Verify all entry-point resources byte-for-byte over strict HTTPS.
        # The immutable release manifest contains public file hashes only.
        release_files = json.loads((ROOT / 'runtime/release-manifest.json').read_text('utf-8'))['files']
        assets = ['admin/index.html', 'admin/builder.css', 'admin/vendor/grapes.min.css', 'admin/vendor/grapes.min.js',
                  'admin/repository.js', 'themes/routes.js', 'themes/shared-header.js', 'admin/document.js',
                  'admin/php-repository.js', 'admin/php-controls.js', 'admin/grapes-uk.js', 'admin/builder.js']
        for asset in assets:
            data = wait_for(lambda asset=asset: local_url(origin + '/' + asset, context), 30, vm)
            if hashlib.sha256(data).hexdigest() != release_files[asset]:
                raise RuntimeError('Локальний сервер повернув пошкоджений ресурс: ' + asset)
        certificate_file = DATA / 'localhost-cert.pem'
        certificate_file.write_text(tls['certificate'], 'utf-8')
        profile = DATA / 'browser-profile'
        debug_port = free_port()
        # Own the rejecting proxy socket; a pre-existing service must never be
        # able to occupy a supposedly dead proxy port and forward data outside.
        proxy = RejectExternalProxy(('127.0.0.1', 0), RejectExternalRequest)
        threading.Thread(target=proxy.serve_forever, daemon=True).start()
        browser_log = (DATA / 'browser.log').open('wb', buffering=0)
        browser = start([ROOT / 'runtime/browser/chrome.exe', f'--user-data-dir={profile}', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions', '--enable-logging=stderr', '--log-level=1', '--disable-background-networking', '--dns-prefetch-disable', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', '--disable-client-side-phishing-detection', '--safebrowsing-disable-auto-update', '--disable-component-update', '--disable-sync', '--disable-domain-reliability', '--disable-breakpad', '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', f'--proxy-server=http://127.0.0.1:{proxy.server_address[1]}', '--proxy-bypass-list=127.0.0.1;localhost', '--disable-features=MediaRouter,OptimizationHints,AutofillServerCommunication', '--password-store=basic', '--remote-debugging-address=127.0.0.1', f'--remote-debugging-port={debug_port}', '--ignore-certificate-errors-spki-list=' + tls['spki'], '--start-maximized', '--new-window', origin + '/admin/'], stdout=browser_log, stderr=browser_log)
        runtime = {'origin': origin, 'guestPort': guest_port, 'debugPort': debug_port, 'vmPid': vm.pid, 'browserPid': browser.pid, 'launcherPid': os.getpid(), 'certificate': str(certificate_file)}
        print('\nВідкрито справжню адмінпанель: ' + origin + '/admin/', flush=True)
        print('Окремий ТЕСТОВИЙ ключ для першого налаштування:\n' + cfg['activationKey'], flush=True)
        print('\nВведіть цей ключ у браузері та створіть власні тестові логін і пароль (від 14 символів).\nЗміни зберігаються між запусками. Для завершення закрийте початкову вкладку адмінпанелі або натисніть Ctrl+C у цьому вікні.', flush=True)

        def tabs():
            return json.loads(local_url(f'http://127.0.0.1:{debug_port}/json/list'))

        admin_id = wait_for(lambda: next((t['id'] for t in tabs() if t.get('type') == 'page' and t.get('url', '').startswith(origin + '/admin/')), None), 30, browser)
        (DATA / 'running.json').write_text(json.dumps(runtime), 'utf-8')
        misses = 0
        while vm.poll() is None and browser.poll() is None:
            time.sleep(0.5)
            try:
                if not any(t['id'] == admin_id for t in tabs()):
                    break
                misses = 0
            except OSError:
                misses += 1
                if misses >= 6:
                    break
        if vm.poll() is not None:
            raise RuntimeError('PHP-сервер несподівано завершив роботу. Дивіться demo-data/guest.log.')
    finally:
        print('Завершення демо та збереження тестового диска…', flush=True)
        if control is not None:
            try:
                control.sendall(('poweroff:' + stop_token + '\n').encode('ascii'))
                vm.wait(timeout=25)
            except (OSError, subprocess.TimeoutExpired):
                pass
            control.close()
        (DATA / 'running.json').unlink(missing_ok=True)
        boot.unlink(missing_ok=True)
        for child in reversed(processes):
            if child.poll() is None:
                child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
        # Job's handle is intentionally owned until process exit; all browser
        # descendants are then killed even if their original parent has exited.
        if forward is not None:
            forward.shutdown()
            forward.server_close()
        if proxy is not None:
            proxy.shutdown()
            proxy.server_close()
        if browser_log is not None:
            browser_log.close()
        log.close()


def main():
    if sys.platform != 'win32' or ctypes.sizeof(ctypes.c_void_p) != 8:
        raise RuntimeError('Цей комплект призначений для 64-бітної Windows 10/11.')
    native = ctypes.create_string_buffer(64)
    ctypes.WinDLL('kernel32').GetNativeSystemInfo(ctypes.byref(native))
    if int.from_bytes(native.raw[:2], 'little') != 9:
        raise RuntimeError('Потрібен комп’ютер із процесором Intel/AMD x64. Windows ARM цим комплектом не підтримується.')
    no_links(ROOT)
    no_links(ROOT / 'demo.lock')
    lock = (ROOT / 'demo.lock').open('a+b')
    lock.seek(0)
    if lock.read(1) == b'':
        lock.write(b'0')
        lock.flush()
    lock.seek(0)
    try:
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        raise RuntimeError('Демо вже запущено. Спочатку закрийте його вікно.') from None
    try:
        if sys.argv[1:] == ['--reset']:
            reset()
        elif not sys.argv[1:]:
            run_demo()
        else:
            raise RuntimeError('Невідома команда.')
    finally:
        lock.seek(0)
        msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
        lock.close()


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('Демо закрито.')
    except Exception as error:
        print('Не вдалося запустити демо: ' + str(error), file=sys.stderr, flush=True)
        sys.exit(1)
