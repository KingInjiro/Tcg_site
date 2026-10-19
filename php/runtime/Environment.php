<?php
declare(strict_types=1);
namespace TCG;
if (!defined('TCG_ENTRY')) { http_response_code(404); exit; }
final class Environment {
    public static function inspect(Store $store, array $config, bool $probe = false): array {
        $readable = true; $writable = true; $parents = [$store->publicRoot => true];
        foreach (array_merge($config['staticFiles'], $config['managed']) as $name => $_) {
            $path = $store->publicRoot . '/' . $name; Files::noLinks($path);
            if (!is_file($path) || !is_readable($path)) $readable = false;
        }
        foreach ($config['managed'] as $name => $_) {
            $parent = dirname($store->publicRoot . '/' . $name);
            while (!is_dir($parent) && $parent !== $store->publicRoot) $parent = dirname($parent);
            $parents[$parent] = true;
        }
        foreach (array_keys($parents) as $directory) {
            Files::noLinks($directory);
            if (!is_writable($directory)) { $writable = false; continue; }
            if ($probe) {
                $file = $directory . '/.tcg-probe-' . bin2hex(random_bytes(16));
                try { Files::atomic($file, 'tcg-environment-probe'); if (Files::read($file) !== 'tcg-environment-probe') throw new Problem('Перевірка запису не пройшла.', 503); }
                finally { if (is_file($file)) unlink($file); }
            }
        }
        $free = function_exists('disk_free_space') ? disk_free_space($store->root) : false;
        return ['php' => PHP_VERSION, 'https' => Auth::https(), 'privateStorage' => true, 'read' => $readable, 'write' => $writable,
            'freeBytes' => $free === false ? null : $free, 'freeSpaceKnown' => $free !== false,
            'extensions' => ['dom' => class_exists(\DOMDocument::class), 'fileinfo' => class_exists(\finfo::class), 'gd' => function_exists('imagecreatefromstring'), 'zip' => class_exists(\ZipArchive::class), 'mbstring' => function_exists('mb_strlen'), 'curl' => function_exists('curl_init'), 'openssl' => extension_loaded('openssl')],
            'limits' => ['upload' => ini_get('upload_max_filesize'), 'post' => ini_get('post_max_size'), 'memory' => ini_get('memory_limit'), 'privateBytes' => 40 * 1024 * 1024],
            'note' => 'Вільне місце файлової системи не підтверджує залишок квоти облікового запису хостингу.'];
    }
}
