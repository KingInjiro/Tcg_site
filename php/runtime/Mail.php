<?php
declare(strict_types=1);
namespace TCG;
if (!defined('TCG_ENTRY')) { http_response_code(404); exit; }
require_once __DIR__ . '/vendor/phpmailer/src/Exception.php';
require_once __DIR__ . '/vendor/phpmailer/src/SMTP.php';
require_once __DIR__ . '/vendor/phpmailer/src/PHPMailer.php';
final class Mail {
    public function __construct(private readonly Store $store) {}
    private function config(): array {
        $file = $this->store->root . '/mail.json';
        return is_file($file) ? Files::json(Files::read($file)) : ['enabled' => false];
    }
    public function settings(): array { $settings = $this->config(); $settings['hasPassword'] = ($settings['password'] ?? '') !== ''; unset($settings['password']); return $settings; }
    public function save(array $input): array {
        $config = $this->config();
        $host = $input['host'] ?? ''; $port = $input['port'] ?? 465; $security = $input['security'] ?? 'smtps';
        $user = $input['username'] ?? ''; $password = $input['password'] ?? ($config['password'] ?? '');
        if ($password === '') $password = $config['password'] ?? '';
        if (!is_string($host) || !preg_match('/^[a-z0-9][a-z0-9.-]{0,251}[a-z0-9]$/iD', $host) || !is_int($port) || $port < 1 || $port > 65535 || !in_array($security, ['smtps', 'starttls'], true) || !is_string($user) || $user === '' || strlen($user) > 254 || preg_match('/[\x00-\x1f]/', $user) || !is_string($password) || $password === '' || strlen($password) > 2048 || str_contains($password, "\0")) throw new Problem('Перевірте SMTP-сервер, порт, шифрування та облікові дані.');
        foreach (['from', 'to'] as $key) if (!is_string($input[$key] ?? null) || strlen($input[$key]) > 254 || !filter_var($input[$key], FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $input[$key])) throw new Problem('Вкажіть коректні адреси відправника й одержувача.');
        $settings = ['enabled' => ($input['enabled'] ?? false) === true, 'host' => strtolower($host), 'port' => $port, 'security' => $security, 'username' => $user, 'password' => $password, 'from' => $input['from'], 'to' => $input['to']];
        Files::atomic($this->store->root . '/mail.json', Files::encode($settings));
        return ['ok' => true, 'message' => 'Налаштування збережено. Перевірте захищене SMTP-з’єднання перед увімкненням форм.'];
    }
    private function transport(array $config): \PHPMailer\PHPMailer\PHPMailer {
        if (!extension_loaded('openssl') || !function_exists('stream_socket_client')) throw new Problem('PHP не підтримує потрібне захищене SMTP-з’єднання.', 503);
        $mail = new \PHPMailer\PHPMailer\PHPMailer(true); $mail->isSMTP();
        $mail->Host = $config['host']; $mail->Port = $config['port']; $mail->SMTPAuth = true;
        $mail->Username = $config['username']; $mail->Password = $config['password'];
        $mail->SMTPSecure = $config['security'] === 'smtps' ? $mail::ENCRYPTION_SMTPS : $mail::ENCRYPTION_STARTTLS;
        $mail->SMTPAutoTLS = false; $mail->SMTPDebug = 0; $mail->Timeout = 8; $mail->getSMTPInstance()->Timelimit = 12;
        $mail->SMTPOptions = ['ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'allow_self_signed' => false, 'peer_name' => $config['host']]];
        $mail->CharSet = 'UTF-8'; $mail->isHTML(false); $mail->setFrom($config['from'], 'TCG'); $mail->addAddress($config['to']);
        return $mail;
    }
    public function verify(): array {
        $config = $this->config(); if (empty($config['host'])) throw new Problem('Спочатку збережіть налаштування SMTP.');
        $mail = $this->transport($config);
        try {
            if (!$mail->smtpConnect()) throw new \RuntimeException('SMTP not accepted');
            $config['verifiedAt'] = gmdate('c'); Files::atomic($this->store->root . '/mail.json', Files::encode($config));
            return ['ok' => true, 'message' => 'TLS і SMTP-авторизацію перевірено. Лист не надсилався; це ще не підтверджує доставку в поштову скриньку.'];
        } catch (\Throwable $e) { throw new Problem('Не вдалося підтвердити захищене SMTP-з’єднання. Перевірте сервер, порт, сертифікат та облікові дані.', 502); }
        finally { $mail->smtpClose(); }
    }
    private function consume(string $nonce): void {
        $this->store->locked(function () use ($nonce) {
            $file = $this->store->root . '/contact-attempts.json'; $data = is_file($file) ? Files::json(Files::read($file)) : [];
            $cutoff = time() - 600; $data = array_filter($data, fn($row) => ($row['time'] ?? 0) > $cutoff);
            $ip = 'ip-' . hash('sha256', $_SERVER['REMOTE_ADDR'] ?? 'unknown');
            if (isset($data[$nonce]) || ($data[$ip]['count'] ?? 0) >= 5 || count($data) > 512) throw new Problem('Лимит отправки исчерпан. Попробуйте позже.', 429);
            $data[$nonce] = ['time' => time()]; $row = $data[$ip] ?? ['count' => 0, 'time' => time()]; $row['count']++; $data[$ip] = $row;
            Files::atomic($file, Files::encode($data));
        });
    }
    public function contact(array $input, ?string $token, string $origin): array {
        $config = $this->config();
        if (empty($config['enabled']) || empty($config['verifiedAt'])) throw new Problem('Отправка через сайт пока недоступна. Данные остались в форме. Свяжитесь с нами по контактам на сайте.', 503);
        $key = $this->store->owner()['id'];
        if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') { $payload = time() . '.' . bin2hex(random_bytes(16)); return ['token' => $payload . '.' . hash_hmac('sha256', $origin . "\n" . $payload, $key)]; }
        if (!is_string($token) || !preg_match('/^([0-9]{10})\.([a-f0-9]{32})\.([a-f0-9]{64})$/D', $token, $match) || time() < (int)$match[1] || time() - (int)$match[1] > 600 || !hash_equals(hash_hmac('sha256', $origin . "\n" . $match[1] . '.' . $match[2], $key), $match[3])) throw new Problem('Срок действия формы истёк. Попробуйте ещё раз.', 403);
        $labels = ['Name' => 'Имя', 'Title' => 'Должность', 'Company' => 'Организация', 'Telephone' => 'Телефон', 'Phone' => 'Телефон', 'FAX' => 'Факс', 'Email' => 'Эл. почта', 'Address' => 'Адрес / текст запроса', 'Заметки' => 'Заметки', 'Category' => 'Категория', 'SendProductLiterature' => 'Литература о продукте', 'SendServiceLiterature' => 'Литература об услуге', 'SendCompanyLiterature' => 'Литература об организации', 'SalesContactRequested' => 'Связь с продавцом'];
        $fields = $input['fields'] ?? null; $page = $input['page'] ?? '';
        if (!empty($input['website']) || !in_array($page, ['/feedback/', '/1CPrice/', '/price01/', '/price1C/'], true) || !is_array($fields) || array_is_list($fields)) throw new Problem('Некорректная форма.');
        $lines = [];
        foreach ($fields as $name => $value) {
            if (!isset($labels[$name]) || !is_string($value) || strlen($value) > 5000 || preg_match('/[\x00-\x08\x0b\x0c\x0e-\x1f]/', $value)) throw new Problem('Некорректное значение поля.');
            if (trim($value) !== '') $lines[] = $labels[$name] . ': ' . trim($value);
        }
        if (trim($fields['Name'] ?? '') === '' || !filter_var($fields['Email'] ?? '', FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $fields['Email']) || strlen($fields['Email']) > 254) throw new Problem('Укажите имя и корректный адрес электронной почты.');
        $this->consume($match[2]); $mail = $this->transport($config);
        try {
            $mail->addReplyTo($fields['Email']); $mail->Subject = 'TCG: обращение с ' . $page; $mail->Body = "Страница: " . $page . "\n\n" . implode("\n", $lines);
            if (!$mail->send()) throw new \RuntimeException('SMTP rejected message');
            return ['ok' => true, 'message' => 'Сообщение принято почтовым сервером. Спасибо за обращение.'];
        } catch (\Throwable $e) { throw new Problem('Не удалось подтвердить отправку. Данные остались в форме. Повторите позже или воспользуйтесь контактами на сайте.', 502); }
        finally { $mail->smtpClose(); }
    }
    public static function serve(string $app): void {
        try {
            ini_set('display_errors', '0'); Auth::secure();
            $store = new Store(dirname($app, 2)); if (!$store->configured()) throw new Problem('Отправка через сайт пока недоступна.', 503);
            $host = $_SERVER['HTTP_HOST'] ?? ''; if (!preg_match('/^[a-z0-9.-]+(?::[0-9]{1,5})?$/iD', $host)) throw new Problem('Недозволений запит.', 403);
            $origin = 'https://' . $host; $method = $_SERVER['REQUEST_METHOD'] ?? '';
            if (!in_array($method, ['GET', 'POST'], true)) throw new Problem('Метод не поддерживается.', 405);
            $caller = $_SERVER['HTTP_ORIGIN'] ?? '';
            if ($method === 'GET' && $caller === '') { $ref = parse_url($_SERVER['HTTP_REFERER'] ?? ''); $caller = isset($ref['scheme'], $ref['host']) ? $ref['scheme'] . '://' . $ref['host'] . (isset($ref['port']) ? ':' . $ref['port'] : '') : ''; }
            if ($caller !== $origin || ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') throw new Problem('Запрос с этого адреса запрещён.', 403);
            $input = [];
            if ($method === 'POST') {
                if (strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0])) !== 'application/json') throw new Problem('Неподдерживаемый формат запроса.', 415);
                $body = file_get_contents('php://input', false, null, 0, 16385); if ($body === false || strlen($body) > 16384) throw new Problem('Сообщение слишком большое.', 413); $input = Files::json($body);
            }
            $result = (new self($store))->contact($input, $_SERVER['HTTP_X_TCG_TOKEN'] ?? null, $origin); echo Files::encode($result);
        } catch (Problem $e) { http_response_code($e->status); echo Files::encode(['error' => $e->getMessage()]); }
        catch (\Throwable $e) { http_response_code(503); echo '{"error":"Не удалось подтвердить отправку. Данные остались в форме."}'; }
    }
}
