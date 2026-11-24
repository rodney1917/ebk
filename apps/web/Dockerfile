# Build from the repository root:  docker build -f apps/web/Dockerfile .
FROM node:22-bookworm-slim AS build
WORKDIR /repo
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL NODE_ENV=production
COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspaces --include-workspace-root --include=dev
COPY packages/core packages/core
COPY apps/web apps/web
RUN npm run build -w @ebk/core && npm run build -w @ebk/web

FROM nginx:1.27-alpine
COPY infra/nginx/ebk.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
