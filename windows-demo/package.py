"""Development-side bundler; never downloads anything during demo startup."""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import urllib.request
import zipfile

SOURCE = Path(__file__).resolve().parent


def download(url, expected, target, algorithm='sha256'):
    with urllib.request.urlopen(url, timeout=120) as response, target.open('wb') as output:
        shutil.copyfileobj(response, output)
    actual = hashlib.file_digest(target.open('rb'), algorithm).hexdigest()
    if actual != expected:
        target.unlink()
        raise ValueError(f'Download hash mismatch: {url} ({actual})')


def package(build, output):
    pins = json.loads((SOURCE / 'dependencies.json').read_text('utf-8'))
    stage = build / 'TCG-TEST-WINDOWS'
    stage.mkdir()
    (stage / 'runtime').mkdir()
    shutil.copytree(build / 'runtime/guest', stage / 'runtime/guest')
    for filename in ['START-DEMO.cmd', 'RESET-DEMO.cmd', 'launcher.py', 'ПРОЧИТАЙТЕ.txt']:
        data = (SOURCE / filename).read_text('utf-8').replace('\r\n', '\n').replace('\n', '\r\n')
        (stage / filename).write_bytes(data.encode('utf-8'))
    for name in ['python', 'browser']:
        entry = pins[name]
        archive = build / (name + '.zip')
        download(entry['url'], entry['sha256'], archive)
        unpacked = build / (name + '-unpacked')
        with zipfile.ZipFile(archive) as z:
            z.extractall(unpacked)
        src = unpacked / entry.get('prefix', '')
        shutil.copytree(src, stage / 'runtime' / name)
        if name == 'browser':
            for unnecessary in ['interactive_ui_tests.exe', 'setup.exe', 'elevation_service.exe', 'elevated_tracing_service.exe']:
                (stage / 'runtime/browser' / unnecessary).unlink(missing_ok=True)
    entry = pins['qemu']
    installer = build / 'qemu.exe'
    download(entry['url'], entry['sha512'], installer, 'sha512')
    import subprocess
    subprocess.run(['7z', 'x', '-y', '-o' + str(build / 'qemu-unpacked'), str(installer)], check=True, stdout=subprocess.DEVNULL)
    qemu = stage / 'runtime/qemu'
    qemu.mkdir()
    extracted = build / 'qemu-unpacked'
    # Keep x86 only; runtime dependency DLLs and firmware retain their licenses.
    for file in extracted.iterdir():
        if file.is_file() and (file.suffix.lower() == '.dll' or file.name in ['qemu-img.exe', 'qemu-system-x86_64.exe'] or file.suffix in ['.bin', '.rom', '.fd'] or file.name.upper().startswith(('COPYING', 'LICENSE'))):
            shutil.copy2(file, qemu / file.name)
    for name in ['share', 'licenses', 'keymaps']:
        if (extracted / name).is_dir():
            shutil.copytree(extracted / name, qemu / name)
    if not (qemu / 'qemu-system-x86_64.exe').is_file():
        raise RuntimeError('Unexpected QEMU archive layout')
    shutil.copy2(SOURCE / 'dependencies.json', stage / 'runtime/dependencies.json')
    shutil.copy2(SOURCE / 'release-manifest.json', stage / 'runtime/release-manifest.json')
    manifest = {p.relative_to(stage).as_posix(): hashlib.file_digest(p.open('rb'), 'sha256').hexdigest() for p in sorted(stage.rglob('*')) if p.is_file()}
    (stage / 'runtime-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), 'utf-8')
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for file in sorted(stage.rglob('*')):
            if file.is_file():
                z.write(file, file.relative_to(stage).as_posix())
    print(json.dumps({'archive': str(output), 'sha256': hashlib.file_digest(output.open('rb'), 'sha256').hexdigest(), 'bytes': output.stat().st_size}))


if __name__ == '__main__':
    package(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve())
