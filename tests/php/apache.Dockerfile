# CI-only real Apache; none of these tools are installed on hosting.
ARG PHP_VERSION=8.3
FROM php:${PHP_VERSION}-apache
ARG TCG_UID=1001
ARG TCG_GID=1001
RUN apt-get update && apt-get install -y --no-install-recommends libpng-dev libjpeg62-turbo-dev libwebp-dev libfreetype6-dev \
    && docker-php-ext-configure gd --with-jpeg --with-webp --with-freetype && docker-php-ext-install gd \
    && a2enmod ssl && groupmod -o -g ${TCG_GID} www-data && usermod -o -u ${TCG_UID} -g ${TCG_GID} www-data \
    && rm -rf /var/lib/apt/lists/*
COPY tests/php/apache.conf /etc/apache2/sites-enabled/000-default.conf
RUN printf 'Listen ${TCG_HTTP_PORT}\nListen ${TCG_HTTPS_PORT}\n' > /etc/apache2/ports.conf
