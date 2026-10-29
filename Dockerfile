# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM php:8.4-apache-bookworm AS app
WORKDIR /var/www/html
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ffmpeg git unzip libfreetype6-dev libjpeg62-turbo-dev libpng-dev \
    libonig-dev libsqlite3-dev libxml2-dev libzip-dev libwebp-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg --with-webp \
    && docker-php-ext-install -j$(nproc) gd mbstring pdo_mysql pdo_sqlite pcntl zip opcache \
    && pecl install redis-6.3.0 && docker-php-ext-enable redis \
    && a2enmod rewrite \
    && rm -rf /var/lib/apt/lists/*
COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer
COPY composer.json composer.lock ./
# Dev dependencies are intentional: this image also runs the isolated PHP tests.
RUN composer install --no-interaction --prefer-dist --no-scripts --no-autoloader
COPY . .
COPY --from=frontend /app/public/build ./public/build
COPY deploy/php.ini /usr/local/etc/php/conf.d/ytt.ini
COPY deploy/docker/apache.conf /etc/apache2/sites-available/000-default.conf
COPY deploy/docker/entrypoint.sh /usr/local/bin/ytt-entrypoint
RUN mkdir -p storage/app/campaigns-private storage/framework/cache/data \
    storage/framework/sessions storage/framework/views storage/logs bootstrap/cache \
    && composer dump-autoload --optimize --no-interaction \
    && chmod +x /usr/local/bin/ytt-entrypoint \
    && chown -R www-data:www-data storage bootstrap/cache
ENTRYPOINT ["ytt-entrypoint"]
CMD ["apache2-foreground"]
