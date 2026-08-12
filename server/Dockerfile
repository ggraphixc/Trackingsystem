# Dravex sync server — Docker image for Render/Fly/Fly.io-style hosting.
#
# The server is zero-dependency Node (pg is an optional dep, installed here
# so Neon works when DATABASE_URL is set). HOST is overridden to 0.0.0.0 so
# the host platform can route traffic to it (local dev keeps 127.0.0.1).
FROM node:20-alpine

WORKDIR /app

# Install deps first for better layer caching. --omit=dev is a no-op here
# (there are no dev deps) but keeps images lean if that changes.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

ENV PORT=4173
ENV HOST=0.0.0.0
EXPOSE 4173

CMD ["node", "server.js"]
