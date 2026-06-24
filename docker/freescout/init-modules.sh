#!/usr/bin/with-contenv bash
# FreeScout module activation — runs at every container start via cont-init.d
# Idempotent: enable + migrate are safe to re-run on restarts.
# Depends on: DB being reachable (Supabase Supavisor) and /www/html mounted.

cd /www/html || exit 0

if [ ! -d "Modules/Webhooks" ]; then
    echo "[init-modules] Webhooks directory not found — skipping"
    exit 0
fi

echo "[init-modules] Activating Webhooks module..."
php artisan module:enable Webhooks 2>&1 && echo "[init-modules] module:enable OK"
php artisan migrate --force              2>&1 && echo "[init-modules] migrate OK"
php artisan cache:clear                  2>&1 && echo "[init-modules] cache cleared"
echo "[init-modules] Done"
