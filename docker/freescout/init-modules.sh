#!/usr/bin/with-contenv bash
# FreeScout Webhooks module - download + activate at container start.
# Idempotent: skips download if Modules/Webhooks already present.
# Runs after FreeScout has initialized its app directory.

WEBHOOKS_REF="${WEBHOOKS_REF:-master}"

# Locate FreeScout app root (nfrastack image uses /www/html)
APP_DIR=""
for DIR in /www/html /var/www/html /app; do
    if [ -f "$DIR/artisan" ]; then
        APP_DIR="$DIR"
        break
    fi
done

if [ -z "$APP_DIR" ]; then
    echo "[init-modules] artisan not found in known paths -- app may still be initializing, skipping"
    exit 0
fi

MODULE_DIR="$APP_DIR/Modules/Webhooks"

if [ ! -d "$MODULE_DIR" ]; then
    echo "[init-modules] Downloading Webhooks module (ref: $WEBHOOKS_REF)..."
    cd "$APP_DIR" || exit 0

    ZIP_URL="https://github.com/freescout-help-desk/freescout-webhooks/archive/refs/heads/${WEBHOOKS_REF}.zip"

    if command -v curl >/dev/null 2>&1; then
        curl -fsSL -o /tmp/webhooks.zip "$ZIP_URL" || { echo "[init-modules] curl download failed"; exit 1; }
    elif command -v wget >/dev/null 2>&1; then
        wget -q -O /tmp/webhooks.zip "$ZIP_URL" || { echo "[init-modules] wget download failed"; exit 1; }
    else
        echo "[init-modules] ERROR: neither curl nor wget available"
        exit 1
    fi

    unzip -q /tmp/webhooks.zip -d /tmp/ || { echo "[init-modules] unzip failed"; exit 1; }
    mkdir -p Modules
    rm -rf Modules/Webhooks
    mv "/tmp/freescout-webhooks-${WEBHOOKS_REF}" Modules/Webhooks
    chown -R www-data:www-data Modules/Webhooks 2>/dev/null || true
    rm -f /tmp/webhooks.zip
    echo "[init-modules] Download complete"
fi

echo "[init-modules] Activating Webhooks module..."
cd "$APP_DIR" || exit 0
php artisan module:enable Webhooks 2>&1 && echo "[init-modules] module:enable OK"
php artisan migrate --force              2>&1 && echo "[init-modules] migrate OK"
php artisan cache:clear                  2>&1 && echo "[init-modules] cache cleared"
echo "[init-modules] Done"
