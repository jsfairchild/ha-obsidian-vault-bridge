ARG BUILD_FROM
FROM ${BUILD_FROM}

RUN apt-get update \
    && apt-get install -y --no-install-recommends git openssh-client jq curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Pinned: obsidian-headless is in beta, so upgrades are deliberate.
RUN npm install -g obsidian-headless@0.0.14 && npm cache clean --force

COPY run.sh bridge.sh secret_scan.js anomaly_check.js /app/
RUN chmod +x /app/run.sh /app/bridge.sh

CMD ["/app/run.sh"]
