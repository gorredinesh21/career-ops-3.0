# career-ops dashboard — zero-build Node static server over real data snapshots.
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --no-save js-yaml --ignore-scripts
COPY dashboard-web/ ./dashboard-web/
COPY data/ ./data/
ENV PORT=8080
WORKDIR /app/dashboard-web
CMD exec node server.mjs
