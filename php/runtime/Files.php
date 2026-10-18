<?php
declare(strict_types=1);
namespace TCG;
if (!defined('TCG_ENTRY')) { http_response_code(404); exit; }

final class Problem extends \RuntimeException {
    public function __construct(string $message, public readonly int $status = 400) { parent::__construct($message); }
}

final class Files {
    public static function json(string $text): array {
        try { $data = json_decode($text, true, 128, JSON_THROW_ON_ERROR); }
        catch (\JsonException $e) { throw new Problem('Пошкоджений JSON.'); }
        if (!is_array($data)) throw new Problem('Очікується JSON-об’єкт.');
        return $data;
    }
    public static function encode(array $data): string {
        return json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }
    public static function noLinks(string $path): void {
        if ($path === '' || str_contains($path, "\0")) throw new Problem('Недозволений шлях.');
        $current = DIRECTORY_SEPARATOR;
        foreach (explode(DIRECTORY_SEPARATOR, ltrim($path, DIRECTORY_SEPARATOR)) as $part) {
            if ($part === '' || $part === '.' || $part === '..') throw new Problem('Недозволений шлях.');
            $current = rtrim($current, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $part;
            clearstatcache(true, $current);
            if (is_link($current)) throw new Problem('Символічні посилання заборонені.', 403);
        }
    }
    public static function directory(string $path): void {
        self::noLinks($path);
        if (!is_dir($path) && !mkdir($path, 0700, true) && !is_dir($path)) throw new Problem('Не вдалося створити приватне сховище.', 503);
        if (!is_writable($path)) throw new Problem('Немає прав запису до сховища.', 503);
    }
    public static function read(string $path): string {
        self::noLinks($path);
        $data = file_get_contents($path);
        if ($data === false) throw new Problem('Не вдалося прочитати файл.', 503);
        return $data;
    }
    public static function atomic(string $path, string $data): void {
        self::noLinks($path);
        $directory = dirname($path);
        if (!is_dir($directory) || !is_writable($directory)) throw new Problem('Немає прав запису.', 503);
        $temporary = $directory . '/.write-' . bin2hex(random_bytes(16));
        $handle = fopen($temporary, 'x+b');
        if (!$handle) throw new Problem('Не вдалося створити тимчасовий файл.', 503);
        try {
            chmod($temporary, 0600);
            $offset = 0; $length = strlen($data);
            while ($offset < $length) {
                $written = fwrite($handle, substr($data, $offset));
                if ($written === false || $written === 0) throw new Problem('Запис перервано. Чинний файл не змінено.', 503);
                $offset += $written;
            }
            if (!fflush($handle)) throw new Problem('Запис не підтверджено.', 503);
            if (function_exists('fsync') && !fsync($handle)) throw new Problem('Синхронізацію запису не підтверджено.', 503);
            fclose($handle); $handle = null;
            self::noLinks($path);
            if (!hash_equals(hash('sha256', $data), hash_file('sha256', $temporary))) throw new Problem('Перевірка запису не пройшла.', 503);
            if (!rename($temporary, $path)) throw new Problem('Не вдалося застосувати запис.', 503);
        } finally {
            if (is_resource($handle)) fclose($handle);
            if (is_file($temporary)) unlink($temporary);
        }
    }
    public static function page(string $name): bool {
        if (!preg_match('~^(?:(?:Docs|ListPage)/)?[A-Za-z0-9_-]+\.html?$~D', $name)) return false;
        if (preg_match('~^(?:test_|temp\.)~i', $name)) return false;
        return !preg_match('~^(?:admin|api|images|themes|derived|php|assets)\.html?$~i', $name);
    }
    public static function project(string $name): bool {
        return str_starts_with($name, '.tcg-editor/') && str_ends_with($name, '.json') && self::page(substr($name, 12, -5));
    }
    public static function html(string $html): void {
        if (strlen($html) > 2000000 || !preg_match('//u', $html) || preg_match('/[\x00-\x08\x0b\x0e-\x1f]/', $html) || str_contains($html, "\xef\xbf\xbd") || !preg_match('/<(?:html|head|body)(?:\s|>)/i', $html)) throw new Problem('Файл не є справною UTF-8 HTML-сторінкою.');
        // Public HTML must never become executable PHP on a differently configured host.
        if (preg_match('/<\?(?:php|=)|<%/i', $html)) throw new Problem('Серверний код у сторінках заборонений.');
    }
}

final class Store {
    public readonly string $root;
    public readonly string $publicRoot;
    private $lock = null;
    public function __construct(string $publicRoot) {
        Files::noLinks($publicRoot);
        $public = realpath($publicRoot);
        $document = realpath($_SERVER['DOCUMENT_ROOT'] ?? '');
        if (!$public || !$document || $public !== $document || dirname($public) === $public) throw new Problem('Цей реліз встановлюється у корені окремого домену. Приватна папка має бути поза document root.', 503);
        $this->publicRoot = $public;
        $this->root = dirname($public) . '/.tcg-' . substr(hash('sha256', $public), 0, 20);
        Files::noLinks($this->root);
        if (str_starts_with($this->root . '/', $document . '/')) throw new Problem('Приватне сховище не ізольоване.', 503);
    }
    public function prepare(): void {
        Files::directory($this->root);
        foreach (['sessions', 'objects', 'versions'] as $dir) Files::directory($this->root . '/' . $dir);
        $probe = $this->root . '/.probe-' . bin2hex(random_bytes(12));
        try { Files::atomic($probe, 'tcg'); if (Files::read($probe) !== 'tcg') throw new Problem('Сховище не пройшло перевірку.', 503); }
        finally { if (is_file($probe)) unlink($probe); }
    }
    public function locked(callable $operation, bool $exclusive = true): mixed {
        if ($this->lock !== null) throw new Problem('Вкладена транзакція заборонена.', 503);
        $path = $this->root . '/operation.lock'; Files::noLinks($path);
        $handle = fopen($path, 'c+b');
        if (!$handle || !flock($handle, ($exclusive ? LOCK_EX : LOCK_SH) | LOCK_NB)) {
            if (is_resource($handle)) fclose($handle);
            throw new Problem('Інша операція ще триває. Повторіть запит.', 409);
        }
        $this->lock = $handle;
        try { return $operation(); }
        finally { flock($handle, LOCK_UN); fclose($handle); $this->lock = null; }
    }
    public function configured(): bool { Files::noLinks($this->root . '/owner.json'); return is_file($this->root . '/owner.json'); }
    public function owner(): array {
        if (!$this->configured()) throw new Problem('Спочатку завершіть захищене налаштування.', 409);
        return Files::json(Files::read($this->root . '/owner.json'));
    }
    public function state(): array { return Files::json(Files::read($this->root . '/state.json')); }
    public function object(string $sha): string {
        if (!preg_match('/^[a-f0-9]{64}$/D', $sha)) throw new Problem('Пошкоджене посилання на версію.', 503);
        $data = Files::read($this->root . '/objects/' . $sha);
        if (!hash_equals($sha, hash('sha256', $data))) throw new Problem('Контрольна сума документа не збігається.', 503);
        return $data;
    }
    public function put(string $data): string {
        $sha = hash('sha256', $data); $path = $this->root . '/objects/' . $sha;
        Files::noLinks($path);
        if (!is_file($path)) Files::atomic($path, $data);
        return $sha;
    }
    public function commit(array $state): array {
        unset($state['head']); ksort($state['files']);
        $state['head'] = hash('sha256', Files::encode($state));
        Files::atomic($this->root . '/state.json', Files::encode($state));
        return $state;
    }
    public function checkHead(array $state, mixed $head): void {
        if (!is_string($head) || !hash_equals($state['head'], $head)) throw new Problem('Сайт змінився після відкриття редактора. Ваші правки не перезаписано.', 409);
    }
    public function collect(): void {
        $used = array_fill_keys(array_values($this->state()['files']), true);
        foreach (glob($this->root . '/versions/*.json') ?: [] as $version) foreach (Files::json(Files::read($version))['files'] ?? [] as $sha) $used[$sha] = true;
        foreach (glob($this->root . '/objects/*') ?: [] as $object) {
            Files::noLinks($object);
            if (!isset($used[basename($object)]) && is_file($object)) unlink($object);
        }
    }
    public function space(int $needed = 0): void {
        $total = 0;
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($this->root, \FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $entry) { if ($entry->isLink()) throw new Problem('Небезпечне посилання у сховищі.', 503); if ($entry->isFile()) $total += $entry->getSize(); }
        $free = function_exists('disk_free_space') ? disk_free_space($this->root) : false;
        if ($total + $needed > 40 * 1024 * 1024 || ($free !== false && $free < $needed + 1024 * 1024)) throw new Problem('Недостатньо місця. Приватне сховище обмежене 40 МБ.', 507);
    }
}
