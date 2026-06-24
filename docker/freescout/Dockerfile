FROM nfrastack/freescout:latest

# Module download + activation runs at container start via cont-init.d.
# FreeScout is installed on first run (not baked into the base image),
# so /www/html is not populated at Docker build time.
COPY init-modules.sh /etc/cont-init.d/50-freescout-modules
RUN chmod +x /etc/cont-init.d/50-freescout-modules
