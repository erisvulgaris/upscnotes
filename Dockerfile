# upscnotes — single Node container (Express + EJS + SQLite).
# Build: docker build -t upscnotes:latest .
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# deps first (layer cache)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# app code + public assets
COPY src ./src
COPY public ./public
COPY tools ./tools
COPY content ./content
COPY covers ./covers
COPY audio ./audio

# pre-imported SQLite DB seed (books + users) — copied to /app/data on first boot
COPY seed ./seed

# entrypoint: initialize data dir + start
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/server.js"]