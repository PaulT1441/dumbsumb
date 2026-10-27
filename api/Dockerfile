FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install dependencies first to benefit from layer caching
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js db.js ./

# Run as the unprivileged "node" user shipped with the image
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
