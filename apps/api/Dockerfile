# Build from the repository root:  docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspaces --include-workspace-root
COPY packages/core packages/core
COPY apps/api apps/api
RUN npm run build -w @ebk/core \
 && npx -w @ebk/api prisma generate \
 && npm run build -w @ebk/api

# Production-only dependencies (the "build" stage keeps prisma CLI + tsx for the migrate job).
FROM build AS prune
RUN npm prune --omit=dev --workspaces --include-workspace-root

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssl tini && rm -rf /var/lib/apt/lists/* \
 && groupadd -r ebk && useradd -r -g ebk -d /repo ebk
COPY --from=prune --chown=ebk:ebk /repo/node_modules node_modules
COPY --from=build --chown=ebk:ebk /repo/packages/core/package.json packages/core/package.json
COPY --from=build --chown=ebk:ebk /repo/packages/core/dist packages/core/dist
COPY --from=build --chown=ebk:ebk /repo/apps/api/package.json apps/api/package.json
COPY --from=build --chown=ebk:ebk /repo/apps/api/dist apps/api/dist
COPY --from=build --chown=ebk:ebk /repo/apps/api/prisma apps/api/prisma
USER ebk
WORKDIR /repo/apps/api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
# Migrations run as a separate one-off step in deployment (see DEPLOYMENT.md), not on every boot.
CMD ["node", "dist/main.js"]
