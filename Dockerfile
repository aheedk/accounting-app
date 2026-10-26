# The API, as Azure App Service runs it (docs/plans/2026-10-25-azure-supabase-move.md).
# Built from the repo root, since the API needs the shared package, the
# migrations and bin/migrate.ts beside it. The web app and the phone app are not
# in the image.

FROM node:20-bookworm AS build
WORKDIR /app
# Every workspace's package.json, so npm ci agrees with the lockfile; only the
# API's and the shared package's dependencies are installed.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace @accounting/api --workspace @accounting/shared --include-workspace-root --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm -w @accounting/api run build

FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
# node_modules keeps its dev packages: the migrations run through tsx at start.
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared packages/shared
COPY --from=build /app/apps/api apps/api
COPY bin/migrate.ts bin/
COPY db/migrations db/migrations
# App Service sends traffic to WEBSITES_PORT; the API listens on PORT.
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["sh", "-c", "npm run migrate:prod && npm run start:api"]
