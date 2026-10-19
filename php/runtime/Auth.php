<?php
declare(strict_types=1);
namespace TCG;
if (!defined('TCG_ENTRY')) { http_response_code(404); exit; }

final class Auth {
    private const IDLE = 1800;
    private const LIFETIME = 28800;
    public function __construct(private readonly Store $store) {}
    public static function https(): bool { return isset($_SERVER['HTTPS']) && in_array(strtolower((string)$_SERVER['HTTPS']), ['on', '1'], true); }
    public static function secure(): void {
        if (!self::https()) throw new Problem('Адміністративний доступ дозволений лише через HTTPS.', 403);
    }
    public function start(): void {
        self::secure();
        $settings = ['session.save_handler' => 'files', 'session.use_strict_mode' => '1', 'session.use_only_cookies' => '1', 'session.use_trans_sid' => '0', 'session.cookie_secure' => '1', 'session.cookie_httponly' => '1', 'session.cookie_samesite' => 'Strict', 'session.gc_maxlifetime' => (string) self::LIFETIME];
        foreach ($settings as $key => $value) {
            ini_set($key, $value);
            if ((string) ini_get($key) !== $value) throw new Problem('Хостинг не дозволяє захищені налаштування сесії.', 503);
        }
        session_name('TCGAdmin'); session_save_path($this->store->root . '/sessions');
        session_set_cookie_params(['lifetime' => 0, 'path' => '/admin/', 'secure' => true, 'httponly' => true, 'samesite' => 'Strict']);
        // Bounded server-side sessions even when the host disables its GC cron.
        $directory = $this->store->root . '/sessions'; $count = 0;
        foreach (glob($directory . '/sess_*') ?: [] as $file) {
            Files::noLinks($file);
            if (is_file($file) && filemtime($file) < time() - self::LIFETIME) { if (!unlink($file)) throw new Problem('Не вдалося очистити прострочені сесії.', 503); }
            else $count++;
        }
        $cookie = $_COOKIE['TCGAdmin'] ?? '';
        $existing = is_string($cookie) && preg_match('/^[A-Za-z0-9,-]{16,128}$/D', $cookie) && is_file($directory . '/sess_' . $cookie);
        if ($count >= 512 && !$existing) throw new Problem('Ліміт одночасних сесій вичерпано. Повторіть пізніше.', 429);
        if ($existing) Files::noLinks($directory . '/sess_' . $cookie);
        if (!session_start()) throw new Problem('Захищену сесію не створено.', 503);
        $now = time();
        if (isset($_SESSION['owner']) && (($now - ($_SESSION['seen'] ?? 0)) > self::IDLE || ($now - ($_SESSION['created'] ?? 0)) > self::LIFETIME)) $this->logout();
        $_SESSION['csrf'] ??= bin2hex(random_bytes(32));
        if (isset($_SESSION['owner'])) $_SESSION['seen'] = $now;
    }
    public function authenticated(): bool { return isset($_SESSION['owner']) && $this->store->configured() && hash_equals($this->store->owner()['id'], $_SESSION['owner']); }
    public function requireOwner(): void { if (!$this->authenticated()) throw new Problem('Потрібно увійти до адмінпанелі.', 401); }
    public function csrf(): string { return $_SESSION['csrf']; }
    public function requireCsrf(): void {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        $host = $_SERVER['HTTP_HOST'] ?? '';
        if (!preg_match('/^[a-z0-9.-]+(?::[0-9]{1,5})?$/iD', $host) || $origin !== 'https://' . $host || ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') throw new Problem('Джерело запиту не підтверджене.', 403);
        $token = $_SERVER['HTTP_X_TCG_CSRF'] ?? '';
        if (!is_string($token) || !hash_equals($this->csrf(), $token)) throw new Problem('Захисний токен недійсний. Увійдіть повторно.', 403);
    }
    public function limit(string $group, bool $failure = false): void {
        $key = hash('sha256', $group . ':' . ($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
        $this->store->locked(function () use ($key, $failure) {
            $path = $this->store->root . '/attempts.json';
            $rows = is_file($path) ? Files::json(Files::read($path)) : [];
            $cutoff = time() - 900;
            $rows = array_filter($rows, fn($row) => is_array($row) && ($row['since'] ?? 0) >= $cutoff);
            if (($rows[$key]['count'] ?? 0) >= 8) throw new Problem('Забагато невдалих спроб. Повторіть вхід через 15 хвилин.', 429);
            if ($failure) {
                $row = $rows[$key] ?? ['count' => 0, 'since' => time()]; $row['count']++; $rows[$key] = $row;
                if (count($rows) > 256) $rows = array_slice($rows, -256, null, true);
                Files::atomic($path, Files::encode($rows));
            }
        });
    }
    public function login(array $input): array {
        $this->limit('login');
        $owner = $this->store->owner();
        $username = $input['username'] ?? ''; $password = $input['password'] ?? '';
        $valid = is_string($username) && is_string($password) && strlen($password) <= 72 && password_verify($password, $owner['password']);
        if (!$valid || !hash_equals($owner['username'], $username)) { $this->limit('login', true); throw new Problem('Неправильний логін або пароль.', 401); }
        if (!session_regenerate_id(true)) throw new Problem('Не вдалося захистити сесію.', 503);
        $_SESSION = ['owner' => $owner['id'], 'csrf' => bin2hex(random_bytes(32)), 'created' => time(), 'seen' => time()];
        return ['authenticated' => true, 'csrf' => $this->csrf()];
    }
    public function logout(): void {
        $_SESSION = [];
        if (session_status() === PHP_SESSION_ACTIVE) {
            if (!session_regenerate_id(true)) throw new Problem('Не вдалося завершити сесію.', 503);
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
        }
    }
}
