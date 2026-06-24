FROM nfrastack/freescout:latest

# Install FreeScout Webhooks module
# Source: https://github.com/freescout-help-desk/freescout-webhooks
ARG WEBHOOKS_REF=master
RUN cd /www/html \
    && curl -fsSL -o /tmp/webhooks.zip \
         "https://github.com/freescout-help-desk/freescout-webhooks/archive/refs/heads/${WEBHOOKS_REF}.zip" \
    && unzip -q /tmp/webhooks.zip -d /tmp/ \
    && mkdir -p Modules \
    && rm -rf Modules/Webhooks \
    && mv "/tmp/freescout-webhooks-${WEBHOOKS_REF}" Modules/Webhooks \
    && chown -R www-data:www-data Modules/Webhooks \
    && rm -f /tmp/webhooks.zip

# Run module activation at container start (idempotent — safe on every restart)
COPY init-modules.sh /etc/cont-init.d/50-freescout-modules
RUN chmod +x /etc/cont-init.d/50-freescout-modules
