<?php
// Demo infrastructure only, outside document root. The application is unchanged.
declare(strict_types=1);
function put(string $path, string $text, int $mode = 0600): void {
    if (file_put_contents($path, $text) !== strlen($text) || !chmod($path, $mode) || !hash_equals(hash('sha256', $text), hash_file('sha256', $path))) throw new RuntimeException('Demo configuration write failed');
}
$boot = json_decode(file_get_contents('/sys/firmware/qemu_fw_cfg/by_name/opt/tcg/boot/raw'), true, 16, JSON_THROW_ON_ERROR);
foreach (['activationKey', 'stopToken'] as $name) if (!preg_match('/^[A-Za-z0-9_-]{43}$/D', $boot[$name] ?? '')) throw new RuntimeException('Invalid boot secret');
put('/run/tcg-stop-token', $boot['stopToken']);
$configPath = '/srv/tcg/public/admin/_app/release.php';
define('TCG_ENTRY', true);
$release = require $configPath;
$release['activationHash'] = hash('sha256', $boot['activationKey']);
put($configPath, "<?php\nif (!defined('TCG_ENTRY')) { http_response_code(404); exit; }\nreturn json_decode(base64_decode('" . base64_encode(json_encode($release, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)) . "'), true, 128, JSON_THROW_ON_ERROR);\n", 0644);
if (!chown($configPath, 'tcg') || !chgrp($configPath, 'tcg')) throw new RuntimeException('Demo configuration ownership failed');
// A new localhost-only certificate on every boot. Never a system CA.
$openssl = '/opt/tcg/openssl.cnf';
put($openssl, "[req]\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=127.0.0.1\n[ext]\nsubjectAltName=IP:127.0.0.1,DNS:localhost\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nbasicConstraints=critical,CA:FALSE\n");
$key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_RSA, 'private_key_bits' => 2048, 'config' => $openssl]);
$csr = openssl_csr_new(['commonName' => '127.0.0.1'], $key, ['config' => $openssl, 'digest_alg' => 'sha256']);
$certificate = openssl_csr_sign($csr, null, $key, 7, ['config' => $openssl, 'digest_alg' => 'sha256', 'x509_extensions' => 'ext']);
if (!$key || !$csr || !$certificate || !openssl_x509_export($certificate, $pem) || !openssl_pkey_export($key, $private, null, ['config' => $openssl])) throw new RuntimeException('TLS generation failed');
put('/run/tcg-cert.pem', $pem); put('/run/tcg-key.pem', $private);
$spki = openssl_pkey_get_details($key)['key'];
$der = base64_decode(preg_replace('/-----[^-]+-----|\s+/', '', $spki), true);
$module = glob('/usr/lib/apache2/*php*.so');
if (count($module) !== 1) throw new RuntimeException('PHP module missing');
$conf = "ServerRoot /usr/lib/apache2\nPidFile /run/apache2/httpd.pid\nServerName localhost\nListen 10.0.2.15:8443\n";
foreach (['mpm_prefork', 'authz_core', 'authz_host', 'unixd', 'dir', 'mime', 'log_config', 'ssl', 'socache_shmcb'] as $mod) $conf .= "LoadModule {$mod}_module /usr/lib/apache2/mod_{$mod}.so\n";
$conf .= "LoadModule php_module {$module[0]}\nUser tcg\nGroup tcg\nErrorLog /dev/console\nLogLevel warn\nTypesConfig /etc/apache2/mime.types\nDirectoryIndex index.html\nDocumentRoot /srv/tcg/public\nSSLEngine on\nSSLCertificateFile /run/tcg-cert.pem\nSSLCertificateKeyFile /run/tcg-key.pem\nSSLProtocol -all +TLSv1.2 +TLSv1.3\nSSLSessionCache none\n<Directory />\nRequire all denied\nAllowOverride None\n</Directory>\n<Directory /srv/tcg/public>\nRequire all granted\nOptions -Indexes -FollowSymLinks -MultiViews\nAllowOverride None\n</Directory>\n<FilesMatch \\.php$>\nSetHandler application/x-httpd-php\n</FilesMatch>\n<FilesMatch ^\\.>\nRequire all denied\n</FilesMatch>\n<Directory /srv/tcg/public/admin/_app>\nRequire all denied\n</Directory>\n";
put('/etc/apache2/httpd.conf', $conf, 0644);
// Public certificate only, carried over the VM's private console pipe.
echo 'TCG-TLS:' . json_encode(['certificate' => $pem, 'spki' => base64_encode(hash('sha256', $der, true))], JSON_UNESCAPED_SLASHES) . "\n";
echo 'TCG-READY' . "\n";
