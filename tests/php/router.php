<?php
// TEST FIXTURE ONLY. Not copied into any production package.
// A real Node TLS listener strips incoming markers and signs only TLS requests.
$marker = $_SERVER['HTTP_X_TCG_FIXTURE_TRANSPORT'] ?? '';
if (in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true) && hash_equals(getenv('TCG_FIXTURE_SECRET'), $marker)) $_SERVER['HTTPS'] = 'on';
return false;
