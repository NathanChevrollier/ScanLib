# syntax=docker/dockerfile:1

# --- Etape 1 : dependances + build --------------------------------------
FROM node:22-alpine AS build
WORKDIR /repo

# Les manifestes d'abord : la couche d'installation reste en cache tant que
# les dependances ne bougent pas.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/providers/package.json packages/providers/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace=@scanlib/api --include-workspace-root

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN npm run build --workspace=@scanlib/api

# --- Etape 2 : dependances de production seulement -----------------------
FROM node:22-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/providers/package.json packages/providers/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace=@scanlib/api --include-workspace-root

# --- Etape 3 : image finale ---------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache tini && addgroup -S scanlib && adduser -S scanlib -G scanlib

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
COPY apps/api/package.json ./package.json

USER scanlib
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
