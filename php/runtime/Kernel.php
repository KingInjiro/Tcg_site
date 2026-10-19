<?php
declare(strict_types=1);
namespace TCG;
if (!defined('TCG_ENTRY')) { http_response_code(404); exit; }
require_once __DIR__ . '/Files.php';
require_once __DIR__ . '/Auth.php';
require_once __DIR__ . '/Images.php';
require_once __DIR__ . '/Environment.php';

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
            require_once __DIR__ . '/Pages.php';
            require_once __DIR__ . '/Publisher.php';
            require_once __DIR__ . '/Mail.php';
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
                self::respond(['authenticated' => $auth->authenticated(), 'setupRequired' => !$store->configured(), 'csrf' => $auth->csrf(), 'publicationReady' => true]); return;
            }
            if ($method === 'POST' && $action === 'setup') { self::respond(self::setup($store, $auth, $config, $app, $input)); return; }
            if ($method === 'POST' && $action === 'login') { self::respond($auth->login($input)); return; }
            $auth->requireOwner();
            $publisher = new Publisher($store, $config);
            if (is_file($store->root . '/publication.json')) $store->locked(fn() => $publisher->recover());
            if ($method === 'POST' && $action === 'publish') {
                self::respond($store->locked(function () use ($store, $publisher, $input) { $state = $store->state(); $store->checkHead($state, $input['head'] ?? null); return $publisher->publish($state); })); return;
            }
            if ($method === 'GET' && $action === 'mail-settings') { self::respond((new Mail($store))->settings()); return; }
            if ($method === 'POST' && $action === 'mail-settings') { self::respond($store->locked(fn() => (new Mail($store))->save($input))); return; }
            if ($method === 'POST' && $action === 'mail-verify') { self::respond($store->locked(fn() => (new Mail($store))->verify())); return; }
            $pages = new Pages($store);
            if ($method === 'GET' && $action === 'versions') { self::respond(['versions' => $store->locked(fn() => $pages->versions(), false)]); return; }
            if ($method === 'GET' && $action === 'menu') { self::respond(['items' => $store->locked(fn() => $pages->menu($store->state()), false)]); return; }
            if ($method === 'POST' && in_array($action, ['delete', 'rename', 'restore', 'menu'], true)) {
                self::respond($store->locked(function () use ($action, $store, $pages, $input) {
                    $state = $store->state(); $store->checkHead($state, $input['head'] ?? null);
                    if ($action === 'restore') { if (!is_string($input['version'] ?? null)) throw new Problem('Вкажіть резервну версію.'); $state = $pages->restore($state, $input['version']); }
                    elseif ($action === 'menu') { if (!is_array($input['items'] ?? null)) throw new Problem('Вкажіть пункти меню.'); $state = $pages->menu($state, $input['items']); }
                    else {
                        $path = $input['path'] ?? null; if (!is_string($path) || ($input['confirm'] ?? null) !== $path) throw new Problem('Потрібне підтвердження адреси.');
                        $newPath = $action === 'rename' ? ($input['newPath'] ?? null) : null;
                        if ($action === 'rename' && !is_string($newPath)) throw new Problem('Вкажіть нову адресу.');
                        $state = $pages->change($state, $path, $newPath);
                    }
                    $store->collect(); return ['head' => $state['head'], 'published' => false];
                })); return;
            }
            if ($method === 'POST' && $action === 'logout') { $auth->logout(); self::respond(['ok' => true]); return; }
            if ($method === 'GET' && $action === 'capabilities') {
                self::respond(Environment::inspect($store, $config)); return;
            }
            if ($method === 'GET' && $action === 'tree') {
                self::respond($store->locked(function () use ($store, $config) {
                    $state = $store->state(); $files = [];
                    foreach ($state['files'] as $path => $sha) $files[] = ['path' => $path, 'sha' => $sha, 'type' => 'blob'];
                    foreach ($config['assets'] ?? [] as $path) if (preg_match('/\.(?:png|jpe?g|gif|webp)$/i', $path) && !isset($state['files'][$path])) $files[] = ['path' => $path, 'type' => 'blob'];
                    $published = is_file($store->root . '/published-state.json') ? Files::json(Files::read($store->root . '/published-state.json')) : null;
                    return ['head' => $state['head'], 'unpublished' => ($published['head'] ?? null) !== $state['head'], 'files' => $files, 'draftImages' => array_values(array_filter(array_keys($state['files']), fn($path) => Images::editable($path)))];
                }, false)); return;
            }
            if ($method === 'GET' && $action === 'image') {
                $path = $_GET['path'] ?? '';
                if (!is_string($path) || !Images::editable($path)) throw new Problem('Недозволене зображення.', 403);
                self::respond($store->locked(function () use ($store, $path) { $state = $store->state(); if (!isset($state['files'][$path])) throw new Problem('Зображення не знайдене.', 404); return Images::response($store->object($state['files'][$path]), $path); }, false)); return;
            }
            if ($method === 'GET' && $action === 'read') {
                $path = $_GET['path'] ?? '';
                if (!is_string($path) || !(Files::page($path) || Files::project($path))) throw new Problem('Цей файл не можна читати.', 403);
                self::respond($store->locked(function () use ($store, $path) { $state = $store->state(); return ['content' => isset($state['files'][$path]) ? $store->object($state['files'][$path]) : null]; }, false)); return;
            }
            if ($method === 'POST' && $action === 'save') {
                self::respond($store->locked(function () use ($store, $input, $config) {
                    $state = $store->state(); $store->checkHead($state, $input['head'] ?? null);
                    $changes = $input['changes'] ?? null;
                    if (!is_array($changes) || !$changes || count($changes) > 100) throw new Problem('Неправильний список змін.');
                    $seen = []; $size = 0; $writes = [];
                    foreach ($changes as $file) {
                        $path = $file['path'] ?? ''; $content = $file['content'] ?? null;
                        if (!is_string($path) || !(Files::page($path) || Files::project($path) || Images::editable($path)) || !is_string($content) || isset($seen[strtolower($path)])) throw new Problem('Недозволений або повторний файл.', 403);
                        if (Images::editable($path)) {
                            if (in_array($path, $config['assets'] ?? [], true)) throw new Problem('Початкові ресурси можна замінювати лише новим зображенням.', 403);
                            $content = Images::decode($file);
                        } elseif (($file['encoding'] ?? '') !== 'utf-8') throw new Problem('Неправильне кодування.');
                        $identity = Files::page($path) ? 'page:' . preg_replace('/\.html?$/', '', strtolower($path)) : strtolower($path);
                        if (isset($seen[$identity])) throw new Problem('Повторна адреса сторінки.', 409);
                        $seen[$identity] = true;
                        if (Files::page($path)) foreach (array_keys($state['files']) as $existing) {
                            if ($existing !== $path && Files::page($existing) && preg_replace('/\.html?$/', '', strtolower($existing)) === preg_replace('/\.html?$/', '', strtolower($path))) throw new Problem('Цю адресу сторінки вже зайнято.', 409);
                        }
                        $seen[strtolower($path)] = true; $size += strlen($content);
                        if (Files::page($path)) Files::html($content); elseif (Files::project($path)) { if (strlen($content) > 4000000) throw new Problem('Дані редактора завеликі.', 413); Files::json($content); }
                        $writes[$path] = $content;
                    }
                    if ($size > 8 * 1024 * 1024) throw new Problem('Забагато змін.', 413);
                    $store->space($size);
                    $pages = new Pages($store); $pages->remember($state, 'Перед збереженням');
                    foreach ($writes as $path => $content) $state['files'][$path] = $store->put($content);
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
        foreach (['json_encode', 'json_decode', 'hash', 'hash_equals', 'random_bytes', 'password_hash', 'password_verify', 'session_start', 'session_regenerate_id', 'spl_autoload_register', 'flock', 'rename', 'file_put_contents', 'file_get_contents', 'mkdir', 'fopen', 'fwrite', 'fflush', 'chmod'] as $function) if (!function_exists($function)) throw new Problem('Хостинг не підтримує обов’язковий захист або файлову операцію: ' . $function, 503);
    }
    private static function setup(Store $store, Auth $auth, array $config, string $app, array $input): array {
        $auth->limit('setup');
        $key = $input['activationKey'] ?? '';
        if (!is_string($key) || !hash_equals($config['activationHash'], hash('sha256', $key))) { $auth->limit('setup', true); throw new Problem('Неправильний ключ початкового налаштування.', 403); }
        $username = $input['username'] ?? ''; $password = $input['password'] ?? '';
        if (!is_string($username) || !preg_match('/^[A-Za-z0-9_-]{3,48}$/D', $username) || !is_string($password) || str_contains($password, "\0") || strlen($password) < 14 || strlen($password) > 72) throw new Problem('Логін: 3–48 латинських літер/цифр. Пароль: від 14 до 72 байтів, без нульових символів.');
        return $store->locked(function () use ($store, $app, $username, $password, $config) {
            if ($store->configured()) throw new Problem('Початкове налаштування вже завершене.', 409);
            if (!class_exists(\DOMDocument::class) || !class_exists(\finfo::class) || !function_exists('imagecreatefromstring')) throw new Problem('Для повного редактора й безпечних зображень потрібні PHP DOM, fileinfo та GD.', 503);
            $environment = Environment::inspect($store, $config, true);
            if (!$environment['read'] || !$environment['write']) throw new Problem('Немає доступу до всіх файлів або прав запису до публічних папок. Активацію зупинено.', 503);
            $seed = require $app . '/seed.php';
            if (!is_array($seed) || !isset($seed['index.html'])) throw new Problem('В архіві немає вихідних сторінок.', 503);
            $files = []; $size = 0;
            foreach ($seed as $path => $html) { if (!Files::page($path) || !is_string($html)) throw new Problem('Некоректні вихідні сторінки.', 503); Files::html($html); $size += strlen($html); }
            $store->space($size);
            foreach ($seed as $path => $html) $files[$path] = $store->put($html);
            $initial = $store->commit(['files' => $files, 'menu' => null, 'aliases' => []]);
            $config = require $app . '/release.php';
            Files::atomic($store->root . '/published-state.json', Files::encode($initial));
            Files::atomic($store->root . '/published.json', Files::encode($config['managed']));
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
