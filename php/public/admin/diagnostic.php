<?php
// Keep this file parseable on PHP 5.6. It never loads the administration app.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
$version = preg_replace('/[^0-9A-Za-z.+_-]/', '', PHP_VERSION);
$supported = function_exists('version_compare') && version_compare(PHP_VERSION, '8.2.0', '>=') && version_compare(PHP_VERSION, '8.6.0', '<');
echo '{"php":"' . $version . '","supported":' . ($supported ? 'true' : 'false') . ',"minimum":"8.2","maximum":"8.5"}';
