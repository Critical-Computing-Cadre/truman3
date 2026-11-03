# The API, and the command that brings the database up to date. See docs/guides/deploying.md.
FROM node:24.22.2-alpine AS install
RUN npm install --global pnpm@12.16.1
WORKDIR /app
# .dockerignore decides what gets here: only what the API needs, and never .env.
COPY . .
# Node runs the TypeScript directly, so there's no build step. It won't run TypeScript from inside
# node_modules, which is why this keeps the workspace layout instead of using `pnpm deploy`.
RUN pnpm install --frozen-lockfile --prod --filter "@truman3/api..."

FROM node:24.22.2-alpine
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY --from=install /app .
USER node
EXPOSE 3000
# To update the database instead, run this image with: node packages/db/src/migrate-cli.ts
CMD ["node", "apps/api/src/server.ts"]
