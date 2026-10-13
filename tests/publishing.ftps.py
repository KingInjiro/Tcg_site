# Local TLS FTP fixture. Trust is injected only into this test's curl child.
import tempfile, pathlib, subprocess, socket, ssl, threading, os
repo = str(pathlib.Path(__file__).resolve().parent.parent)
with tempfile.TemporaryDirectory(prefix='tcg-ftps-check-') as td:
    root = pathlib.Path(td); public = root/'public_html'; public.mkdir()
    subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(root/'key'),'-out',str(root/'cert'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); context.load_cert_chain(root/'cert',root/'key'); context.maximum_version=ssl.TLSVersion.TLSv1_2
    listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen();port=listener.getsockname()[1]
    errors=[]
    def serve(conn):
        passive=None; stream=None; cwd=root; rename=None
        try:
            conn.settimeout(10);stream=conn.makefile('rwb',buffering=0)
            def reply(line): stream.write((line+'\r\n').encode())
            reply('220 Fixture ready')
            while True:
                line=stream.readline().decode().strip()
                if not line: break
                cmd,_,arg=line.partition(' ');cmd=cmd.upper()
                if cmd=='AUTH':
                    reply('234 Start TLS');stream.close();conn=context.wrap_socket(conn,server_side=True);stream=conn.makefile('rwb',buffering=0)
                elif cmd=='USER': reply('331 Password required')
                elif cmd=='PASS': reply('230 Logged in')
                elif cmd=='PWD': reply('257 "/'+str(cwd.relative_to(root)).replace('.', '')+'"')
                elif cmd=='FEAT': reply('211 No additional features')
                elif cmd in ['PBSZ','PROT','TYPE']: reply('200 OK')
                elif cmd in ['CWD','MKD']:
                    target=(root/arg.lstrip('/')) if arg.startswith('/') else cwd/arg
                    if cmd=='MKD': target.mkdir(exist_ok=True);reply('257 Created')
                    elif target.is_dir(): cwd=target;reply('250 Directory changed')
                    else: reply('550 Directory missing')
                elif cmd=='EPSV':
                    passive=socket.socket();passive.bind(('127.0.0.1',0));passive.listen();passive.settimeout(10)
                    reply('229 Entering Extended Passive Mode (|||'+str(passive.getsockname()[1])+'|)')
                elif cmd=='STOR':
                    reply('150 Opening data connection')
                    channel,_=passive.accept();passive.close();passive=None
                    data=context.wrap_socket(channel,server_side=True)
                    with open(cwd/arg,'wb') as out:
                        while True:
                            block=data.recv(65536)
                            if not block:break
                            out.write(block)
                    try: data.unwrap().close()
                    except (OSError,ssl.SSLError): data.close()
                    reply('226 Transfer complete')
                elif cmd=='RNFR': rename=cwd/arg;reply('350 Ready to rename')
                elif cmd=='RNTO': rename.replace(cwd/arg);reply('250 Renamed')
                elif cmd=='QUIT': reply('221 Bye');break
                else: reply('502 Not implemented')
        except (ssl.SSLError,ConnectionResetError,BrokenPipeError): pass # Expected for invalid trust test.
        except Exception as error: errors.append(str(error))
        finally:
            if stream:stream.close()
            conn.close()
            if passive:passive.close()
    def accept():
        try:
            while True:
                conn,_=listener.accept();threading.Thread(target=serve,args=(conn,),daemon=True).start()
        except OSError:pass
    threading.Thread(target=accept,daemon=True).start()
    env=dict(os.environ,STATIC_PROTOCOL='ftps',STATIC_HOST='localhost',STATIC_PORT=str(port),STATIC_USER='test',STATIC_PASSWORD='throwaway-password',STATIC_DIRECTORY='/public_html',CONTACT_FORM_ENDPOINT='https://example.com/api/contact',SITE_REVISION='b'*40,TEST_CERT=str(root/'cert'))
    code="""const {upload}=require('./scripts/publish-static'); const {execFileSync}=require('node:child_process'); const files=[{path:'nested/page.html',content:'updated page'},{path:'images/test.png',content:'asset'},{path:'sw.js',content:'worker'}]; const run=(cmd,args,options)=>{try{return execFileSync(cmd,args,{...options,env:{...options.env,CURL_CA_BUNDLE:process.env.TEST_CERT}});}catch(e){console.error(e.stderr.toString());throw e;}}; upload(files,process.env,run); upload(files,process.env,run); console.log('PASS actual FTPS: TLS, nested directories, transfer and replacement');"""
    try:
        subprocess.run(['node','-e',code],cwd=repo,env=env,check=True)
        assert (public/'nested/page.html').read_text()=='updated page'
        assert not list(public.rglob('*.tmp'))
        result=subprocess.run(['node','-e',"require('./scripts/publish-static').upload([{path:'bad.html',content:'bad'}])"],cwd=repo,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        assert result.returncode!=0 and not (public/'bad.html').exists()
        assert not errors,errors
        print('PASS actual FTPS: untrusted certificate rejected without uploading')
    finally:listener.close()
