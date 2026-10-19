<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
if (!function_exists('version_compare') || version_compare(PHP_VERSION, '8.2.0', '<') || version_compare(PHP_VERSION, '8.6.0', '>=')) {
    header('HTTP/1.1 503 Service Unavailable');
    echo '{"error":"Отправка через сайт пока недоступна. Свяжитесь с нами по контактам на сайте."}'; exit;
}
define('TCG_ENTRY', true);
require dirname(__FILE__) . '/_app/Files.php';
require dirname(__FILE__) . '/_app/Auth.php';
require dirname(__FILE__) . '/_app/Mail.php';
\TCG\Mail::serve(dirname(__FILE__) . '/_app');
