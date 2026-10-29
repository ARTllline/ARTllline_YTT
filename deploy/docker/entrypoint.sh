#!/bin/sh
set -eu

if [ "${1:-}" = "init" ]; then
    mkdir -p storage/app/campaigns-private storage/framework/cache/data \
        storage/framework/sessions storage/framework/views storage/logs
    chown -R www-data:www-data storage
    # This is a dedicated Docker database; never use migrate:fresh or seed accounts.
    exec su -s /bin/sh www-data -c 'php artisan migrate --force --no-interaction'
fi

exec "$@"
