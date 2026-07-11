# Builds and serves the @oauth-spa-kit/nuxt playground (packages/nuxt/playground)
# as a standalone Nitro node-server -- meant for deploying it somewhere real
# (e.g. playground.ronford.dev) to click through the login flow against a
# real IdP, not just local dev. Build from the repo root:
#
#   docker build -f packages/nuxt/playground/Dockerfile -t oauth-spa-kit-playground .
#
# CI builds and pushes this on every push to master (see
# .github/workflows/docker-playground.yml) to
# ghcr.io/ehncraft/oauth-spa-kit-playground, tagged with the short commit
# SHA and :latest -- tags are always derived from the commit, never set by
# hand.
#
# Required at runtime (see nuxt.config.ts's module comment for the full
# list and format): PLAYGROUND_OAUTH_AUTHORITY, PLAYGROUND_OAUTH_CLIENT_ID,
# PLAYGROUND_OAUTH_PRIVATE_KEY_JWK, PLAYGROUND_OAUTH_REDIRECT_URI,
# PLAYGROUND_OAUTH_POST_LOGOUT_REDIRECT_URI, PLAYGROUND_SESSION_PASSWORD
# (>=32 chars, a real secret -- the checked-in placeholder is refused
# whenever PLAYGROUND_OAUTH_AUTHORITY is set), and NITRO_SSL_CERT +
# NITRO_SSL_KEY (PEM contents) -- this image serves HTTPS only, see
# docker-entrypoint.mjs.

FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages

RUN pnpm install --frozen-lockfile

# @oauth-spa-kit/nuxt's tsconfig.json references the playground's generated
# .nuxt/tsconfig.*.json for #imports to resolve -- see ci.yml.
RUN pnpm --filter=@oauth-spa-kit/nuxt run dev:prepare
RUN pnpm build
RUN pnpm --filter=@oauth-spa-kit/nuxt run dev:build

# Distroless: no shell, no package manager, no root user by default (":nonroot"
# tag). Nothing to install here -- just the built output -- so its minimal
# surface is exactly what a production runtime needs.
FROM gcr.io/distroless/nodejs24-debian13:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
COPY --from=build --chown=nonroot:nonroot /app/packages/nuxt/playground/.output ./.output
COPY --chown=nonroot:nonroot docker-entrypoint.mjs ./

EXPOSE 3000

# HTTPS only -- Nitro terminates TLS itself from NITRO_SSL_CERT/NITRO_SSL_KEY
# (PEM contents as env vars, supplied by the deployment's own secret store;
# never baked into the image). docker-entrypoint.mjs refuses to start rather
# than fall back to plain HTTP if either is missing -- see that file.
CMD ["docker-entrypoint.mjs"]
