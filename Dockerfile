# The API, and the command that brings the database up to date. See docs/guides/deploying.md.
# The base image is named by its digest as well as its tag, so the same bytes are built on every
# time. Dependabot proposes a new one when Node has an update.
FROM node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS install
RUN npm install --global pnpm@12.16.1
WORKDIR /app
# .dockerignore decides what gets here: only what the API needs, and never .env.
COPY . .
# Node runs the TypeScript directly, so there's no build step. It won't run TypeScript from inside
# node_modules, which is why this keeps the workspace layout instead of using `pnpm deploy`.
RUN pnpm install --frozen-lockfile --prod --filter "@truman3/api..." --filter "@truman3/cli..."

FROM node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY --from=install /app .
USER node
EXPOSE 3000
# To update the database instead, run this image with: node packages/db/src/migrate-cli.ts
# To create a team or a researcher, with no way into the database from outside: node apps/cli/src/admin.ts
CMD ["node", "apps/api/src/server.ts"]
