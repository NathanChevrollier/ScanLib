# syntax=docker/dockerfile:1

# Le front est un paquet de fichiers statiques : on le construit ici, et Caddy
# le sert depuis un volume partage (voir infra/docker-compose.yml).
FROM node:22-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/providers/package.json packages/providers/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace=@scanlib/web --include-workspace-root

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN npm run build --workspace=@scanlib/web

FROM alpine:3.20 AS runtime
WORKDIR /dist
COPY --from=build /repo/apps/web/dist ./
# Le conteneur ne fait que deposer les fichiers dans le volume partage.
CMD ["sh", "-c", "cp -r /dist/. /srv/web/ && echo 'front deploye dans /srv/web'"]
