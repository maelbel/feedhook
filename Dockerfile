# syntax=docker/dockerfile:1

# Exact Node version (Dependabot proposes updates). Node 24 ships node:sqlite,
# so the image needs no compiler and no native module.
ARG NODE_IMAGE=node:24.22.0-alpine

# ---- 1. Build: install everything, compile, then keep production deps only
FROM ${NODE_IMAGE} AS build
WORKDIR /app

# Dependencies first: this layer is reused as long as the lockfile is unchanged.
COPY package.json package-lock.json ./
# --ignore-scripts: no install script from a dependency runs at build time.
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build \
 && npm prune --omit=dev --ignore-scripts \
 && npm cache clean --force

# ---- 2. Runtime: only what is needed to run, owned by root, run as `node`
FROM ${NODE_IMAGE} AS runtime

LABEL org.opencontainers.image.title="feedhook" \
      org.opencontainers.image.description="Posts new RSS/Atom feed items to Discord webhooks" \
      org.opencontainers.image.source="https://github.com/maelbel/feedhook" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    DATA_DIR=/data \
    FEEDS_FILE=/app/feeds.yaml

WORKDIR /app

# Application files belong to root and are read-only for the `node` user:
# even a compromised process cannot change the code it runs.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json feeds.yaml ./

# The only writable place: the SQLite database (mounted as a volume).
RUN mkdir -p /data && chown node:node /data && chmod 700 /data

# Unprivileged user provided by the Node image (uid 1000).
USER node

# `docker stop` sends SIGTERM: feedhook lets the current post finish,
# then closes the database.
STOPSIGNAL SIGTERM

# No EXPOSE: feedhook opens no port, it only makes outbound requests.
CMD ["node", "dist/main.js"]
