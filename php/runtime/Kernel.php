<?php
declare(strict_types=1);
namespace TCG;
if (!defined('TCG_ENTRY')) { http_response_code(404); exit; }
require_once __DIR__ . '/Files.php';
require_once __DIR__ . '/Auth.php';

final class Kernel {
    public static function serve(string $app): void {
        try {
        if (!function_exists('ini_set') || !function_exists('set_error_handler')) throw new Problem('Хостинг не дозволяє безпечне налаштування PHP.', 503);
        ini_set('display_errors', '0');
        header('X-Frame-Options: DENY'); header('Referrer-Policy: no-referrer');
        header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
        set_error_handler(function (int $severity, string $message, string $file, int $line): bool {
            if (!(error_reporting() & $severity)) return false;
            throw new \ErrorException($message, 0, $severity, $file, $line);
        });
            Auth::secure();
            self::requirements();
            $config = require $app . '/release.php';
            if (!is_array($config) || !preg_match('/^[a-f0-9]{64}$/D', $config['activationHash'] ?? '')) throw new Problem('Реліз не пройшов підготовку.', 503);
            $store = new Store(dirname($app, 2)); $store->prepare();
            $auth = new Auth($store); $auth->start();
            $method = $_SERVER['REQUEST_METHOD'] ?? '';
            $action = $_GET['action'] ?? 'session';
            if (!is_string($action)) throw new Problem('Неправильна операція.');
            if (!in_array($method, ['GET', 'POST'], true)) throw new Problem('Недозволений метод.', 405);
            $input = [];
            if ($method === 'POST') {
                $auth->requireCsrf();
                if (strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0])) !== 'application/json') throw new Problem('Потрібен JSON.', 415);
                if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 8 * 1024 * 1024) throw new Problem('Запит завеликий.', 413);
                $body = file_get_contents('php://input', false, null, 0, 8 * 1024 * 1024 + 1);
                if ($body === false || strlen($body) > 8 * 1024 * 1024) throw new Problem('Запит завеликий.', 413);
                $input = Files::json($body);
            }
            if ($method === 'GET' && $action === 'session') {
                self::respond(['authenticated' => $auth->authenticated(), 'setupRequired' => !$store->configured(), 'csrf' => $auth->csrf()]); return;
            }
            if ($method === 'POST' && $action === 'setup') { self::respond(self::setup($store, $auth, $config, $app, $input)); return; }
            if ($method === 'POST' && $action === 'login') { self::respond($auth->login($input)); return; }
            $auth->requireOwner();
            if ($method === 'POST' && $action === 'logout') { $auth->logout(); self::respond(['ok' => true]); return; }
            if ($method === 'GET' && $action === 'capabilities') {
                self::respond(['php' => PHP_VERSION, 'https' => true, 'privateStorage' => true, 'write' => true,
                    'extensions' => ['dom' => class_exists(\DOMDocument::class), 'fileinfo' => class_exists(\finfo::class), 'gd' => function_exists('imagecreatefromstring'), 'zip' => class_exists(\ZipArchive::class), 'mbstring' => function_exists('mb_strlen'), 'curl' => function_exists('curl_init'), 'openssl' => extension_loaded('openssl')],
                    'limits' => ['upload' => ini_get('upload_max_filesize'), 'post' => ini_get('post_max_size'), 'memory' => ini_get('memory_limit'), 'privateBytes' => 40 * 1024 * 1024]]); return;
            }
            if ($method === 'GET' && $action === 'tree') {
                self::respond($store->locked(function () use ($store) {
                    $state = $store->state(); $files = [];
                    foreach ($state['files'] as $path => $sha) $files[] = ['path' => $path, 'sha' => $sha, 'type' => 'blob'];
                    return ['head' => $state['head'], 'files' => $files];
                }, false)); return;
            }
            if ($method === 'GET' && $action === 'read') {
                $path = $_GET['path'] ?? '';
                if (!is_string($path) || !(Files::page($path) || Files::project($path))) throw new Problem('Цей файл не можна читати.', 403);
                self::respond($store->locked(function () use ($store, $path) { $state = $store->state(); return ['content' => isset($state['files'][$path]) ? $store->object($state['files'][$path]) : null]; }, false)); return;
            }
            if ($method === 'POST' && $action === 'save') {
                self::respond($store->locked(function () use ($store, $input) {
                    $state = $store->state(); $store->checkHead($state, $input['head'] ?? null);
                    $changes = $input['changes'] ?? null;
                    if (!is_array($changes) || !$changes || count($changes) > 100) throw new Problem('Неправильний список змін.');
                    $seen = []; $size = 0;
                    foreach ($changes as $file) {
                        $path = $file['path'] ?? ''; $content = $file['content'] ?? null;
                        if (!is_string($path) || !(Files::page($path) || Files::project($path)) || ($file['encoding'] ?? '') !== 'utf-8' || !is_string($content) || isset($seen[strtolower($path)])) throw new Problem('Недозволений або повторний файл.', 403);
                        $identity = Files::page($path) ? 'page:' . preg_replace('/\.html?$/', '', strtolower($path)) : strtolower($path);
                        if (isset($seen[$identity])) throw new Problem('Повторна адреса сторінки.', 409);
                        $seen[$identity] = true;
                        if (Files::page($path)) foreach (array_keys($state['files']) as $existing) {
                            if ($existing !== $path && Files::page($existing) && preg_replace('/\.html?$/', '', strtolower($existing)) === preg_replace('/\.html?$/', '', strtolower($path))) throw new Problem('Цю адресу сторінки вже зайнято.', 409);
                        }
                        $seen[strtolower($path)] = true; $size += strlen($content);
                        if (Files::page($path)) Files::html($content); else { if (strlen($content) > 4000000) throw new Problem('Дані редактора завеликі.', 413); Files::json($content); }
                    }
                    if ($size > 8 * 1024 * 1024) throw new Problem('Забагато змін.', 413);
                    $store->space($size);
                    foreach ($changes as $file) $state['files'][$file['path']] = $store->put($file['content']);
                    $state = $store->commit($state); $store->collect();
                    return ['ok' => true, 'head' => $state['head'], 'published' => false];
                })); return;
            }
            throw new Problem('Операцію не знайдено.', 404);
        } catch (Problem $e) { self::respond(['error' => $e->getMessage()], $e->status); }
        catch (\Throwable $e) { error_log('TCG administration failure: ' . get_class($e)); self::respond(['error' => 'Операцію не завершено. Чинний сайт збережено. Перевірте права, вільне місце й можливості PHP.'], 503); }
        finally { if (function_exists('session_status') && session_status() === PHP_SESSION_ACTIVE) session_write_close(); if (function_exists('restore_error_handler')) restore_error_handler(); }
    }
    private static function requirements(): void {
        foreach (['json_encode', 'json_decode', 'hash', 'hash_equals', 'random_bytes', 'password_hash', 'password_verify', 'session_start', 'session_regenerate_id', 'flock', 'rename', 'file_put_contents', 'file_get_contents', 'mkdir', 'fopen', 'fwrite', 'fflush', 'chmod'] as $function) if (!function_exists($function)) throw new Problem('Хостинг не підтримує обов’язковий захист або файлову операцію: ' . $function, 503);
    }
    private static function setup(Store $store, Auth $auth, array $config, string $app, array $input): array {
        $auth->limit('setup');
        $key = $input['activationKey'] ?? '';
        if (!is_string($key) || !hash_equals($config['activationHash'], hash('sha256', $key))) { $auth->limit('setup', true); throw new Problem('Неправильний ключ початкового налаштування.', 403); }
        $username = $input['username'] ?? ''; $password = $input['password'] ?? '';
        if (!is_string($username) || !preg_match('/^[A-Za-z0-9_-]{3,48}$/D', $username) || !is_string($password) || str_contains($password, "\0") || strlen($password) < 14 || strlen($password) > 72) throw new Problem('Логін: 3–48 латинських літер/цифр. Пароль: від 14 до 72 байтів, без нульових символів.');
        return $store->locked(function () use ($store, $app, $username, $password) {
            if ($store->configured()) throw new Problem('Початкове налаштування вже завершене.', 409);
            $seed = require $app . '/seed.php';
            if (!is_array($seed) || !isset($seed['index.html'])) throw new Problem('В архіві немає вихідних сторінок.', 503);
            $files = []; $size = 0;
            foreach ($seed as $path => $html) { if (!Files::page($path) || !is_string($html)) throw new Problem('Некоректні вихідні сторінки.', 503); Files::html($html); $size += strlen($html); }
            $store->space($size);
            foreach ($seed as $path => $html) $files[$path] = $store->put($html);
            $store->commit(['files' => $files, 'menu' => null, 'aliases' => []]);
            $owner = ['id' => bin2hex(random_bytes(32)), 'username' => $username, 'password' => password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]), 'created' => gmdate('c')];
            Files::atomic($store->root . '/owner.json', Files::encode($owner));
            return ['ok' => true, 'setupRequired' => false];
        });
    }
    private static function respond(array $data, int $status = 200): void {
        http_response_code($status);
        if (!function_exists('json_encode')) { http_response_code(503); echo '{"error":"Required PHP JSON support is unavailable."}'; return; }
        echo Files::encode($data);
    }
}
