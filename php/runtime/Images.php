<?php
declare(strict_types=1);
namespace TCG;
if (!defined('TCG_ENTRY')) { http_response_code(404); exit; }
final class Images {
    public static function editable(string $path): bool { return (bool)preg_match('~^images/editor/[a-z0-9-]+\.(png|jpe?g|gif|webp)$~D', $path); }
    public static function decode(array $file): string {
        if (!self::editable($file['path'] ?? '') || ($file['encoding'] ?? '') !== 'base64' || !is_string($file['content'] ?? null) || strlen($file['content']) > 2800000) throw new Problem('Некоректне або завелике зображення.', 400);
        $data = base64_decode($file['content'], true);
        if ($data === false || strlen($data) > 2 * 1024 * 1024 || str_contains($data, '<?') || str_contains($data, '<%')) throw new Problem('Небезпечне або пошкоджене зображення.');
        if (!class_exists(\finfo::class) || !function_exists('getimagesizefromstring') || !function_exists('imagecreatefromstring')) throw new Problem('Для безпечного завантаження зображень потрібні fileinfo і GD.', 503);
        $expected = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'gif' => 'image/gif', 'webp' => 'image/webp'][pathinfo($file['path'], PATHINFO_EXTENSION)];
        $mime = (new \finfo(FILEINFO_MIME_TYPE))->buffer($data); $size = @getimagesizefromstring($data);
        if ($mime !== $expected || !$size || ($size['mime'] ?? '') !== $expected || $size[0] < 1 || $size[1] < 1 || $size[0] > 4096 || $size[1] > 4096 || $size[0] * $size[1] > 8000000) throw new Problem('Тип або розміри зображення не пройшли перевірку.');
        $image = @imagecreatefromstring($data);
        if ($image === false) throw new Problem('Зображення не вдалося декодувати.');
        unset($image);
        return $data;
    }
    public static function response(string $data, string $path): array {
        $ext = pathinfo($path, PATHINFO_EXTENSION); $mime = 'image/' . (in_array($ext, ['jpg', 'jpeg'], true) ? 'jpeg' : $ext);
        $base64 = base64_encode($data);
        return ['base64' => $base64, 'dataURL' => 'data:' . $mime . ';base64,' . $base64, 'published' => false];
    }
}
