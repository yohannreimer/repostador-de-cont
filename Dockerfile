FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN npm ci

COPY apps ./apps
COPY packages ./packages

RUN npm run build -w @authority/shared \
  && npm run build -w @authority/api \
  && npm run build -w @authority/web

FROM node:22-alpine AS runtime-base
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist

FROM runtime-base AS api
COPY --from=build /app/apps/api/dist ./apps/api/dist
RUN mkdir -p /app/apps/api/uploads /app/apps/api/exports
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]

FROM runtime-base AS web
COPY --from=build /app/apps/web ./apps/web
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@authority/web"]
