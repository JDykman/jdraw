# --- Stage 1: Build ---
FROM docker.io/library/node:20-alpine AS builder

WORKDIR /app

# Native module build tools (needed for better-sqlite3)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Prune dev dependencies
RUN npm prune --omit=dev

# --- Stage 2: Runtime ---
FROM docker.io/library/node:20-alpine

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

RUN addgroup -S appgroup && adduser -S appuser -G appgroup && \
    mkdir -p /data && chown appuser:appgroup /data

USER appuser

ENV NODE_ENV=production
ENV DB_PATH=/data/jdraw.db
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:3001/ || exit 1

CMD ["node", "dist-server/server/index.js"]
