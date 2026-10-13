# Local temporary SFTP server and throwaway keys; no real hosting credentials.
import subprocess, tempfile, pathlib, socket, json, time, os, getpass
repo=str(pathlib.Path(__file__).resolve().parent.parent)
with tempfile.TemporaryDirectory(prefix='tcg-sftp-check-') as td:
    d=pathlib.Path(td); (d/'public_html').mkdir()
    for kind in ['host','client']:
        subprocess.run(['ssh-keygen','-q','-t','ed25519','-N','','-f',str(d/kind)],check=True)
    with socket.socket() as s: s.bind(('127.0.0.1',0)); port=s.getsockname()[1]
    # Unprivileged fixture server uses no system SSH configuration.
    (d/'config').write_text(f'''Port {port}
ListenAddress 127.0.0.1
HostKey {d}/host
PidFile {d}/pid
AuthorizedKeysFile {d}/client.pub
StrictModes no
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM no
Subsystem sftp internal-sftp
''')
    log=open(d/'sshd.log','w+')
    server=subprocess.Popen(['/usr/sbin/sshd','-D','-e','-f',str(d/'config')],stderr=log)
    try:
        for _ in range(40):
            try:
                with socket.create_connection(('127.0.0.1',port),timeout=.1): break
            except OSError: time.sleep(.05)
        env=dict(os.environ,STATIC_PROTOCOL='sftp',STATIC_HOST='127.0.0.1',STATIC_PORT=str(port),STATIC_USER=getpass.getuser(),STATIC_DIRECTORY=str(d/'public_html'),STATIC_SSH_KEY=(d/'client').read_text(),STATIC_KNOWN_HOSTS=f'[127.0.0.1]:{port} '+(d/'host.pub').read_text(),CONTACT_FORM_ENDPOINT='https://example.com/api/contact',SITE_REVISION='b'*40)
        code="""const {upload}=require('./scripts/publish-static'); const files=[{path:'nested/page.html',content:'updated page'},{path:'images/test.png',content:'asset'},{path:'sw.js',content:'worker'}]; upload(files); upload(files); console.log('PASS actual SFTP: upload, nested directories and replacement');"""
        subprocess.run(['node','-e',code],cwd=repo,env=env,check=True)
        assert (d/'public_html/nested/page.html').read_text()=='updated page'
        assert len(list((d/'public_html').rglob('*.tmp')))==0
        env['STATIC_KNOWN_HOSTS']='wrong.example '+(d/'host.pub').read_text()
        check=subprocess.run(['node','-e',"require('./scripts/publish-static').upload([{path:'bad.html',content:'bad'}])"],cwd=repo,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        assert check.returncode != 0 and not (d/'public_html/bad.html').exists()
        print('PASS actual SFTP: untrusted server key is rejected without uploading')
    except Exception:
        log.flush(); print((d/'sshd.log').read_text()[-1200:]); raise
    finally:
        server.terminate();server.wait(timeout=5);log.close()
