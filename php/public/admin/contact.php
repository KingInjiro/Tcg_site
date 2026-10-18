<?php
// No fabricated success when no mail service has been configured or verified.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('HTTP/1.1 503 Service Unavailable');
echo '{"error":"Надсилання через сайт не налаштоване. Скористайтеся телефоном або електронною поштою на сторінці контактів. Дані залишилися у формі."}';
