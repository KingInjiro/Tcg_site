<?php
// No PHP 8 syntax here: version checks must happen before requiring new code.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
if (!function_exists('version_compare') || version_compare(PHP_VERSION, '8.2.0', '<') || version_compare(PHP_VERSION, '8.6.0', '>=')) {
    header('HTTP/1.1 503 Service Unavailable');
    echo '{"error":"Для адмінпанелі потрібен PHP 8.2–8.5. Публічний сайт продовжує працювати."}';
    exit;
}
define('TCG_ENTRY', true);
require dirname(__FILE__) . '/_app/Kernel.php';
\TCG\Kernel::serve(dirname(__FILE__) . '/_app');
