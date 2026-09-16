# career-ops dashboard — zero-build Node static server over real data snapshots.
# (Installed in isolation: the repo root package.json has unrelated peer conflicts.)
FROM node:20-alpine
WORKDIR /app
RUN npm init -y >/dev/null && npm install js-yaml@4 --ignore-scripts --no-audit --no-fund
COPY dashboard-web/ ./dashboard-web/
COPY data/ ./data/
ENV PORT=8080
WORKDIR /app/dashboard-web
CMD exec node server.mjs
