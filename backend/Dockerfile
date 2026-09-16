# syntax=docker/dockerfile:1
#
# Two targets sharing one dependency layer:
#   api      — plain Node web server, runs behind the Lambda Web Adapter in
#              Lambda and directly under `docker compose` locally. The
#              adapter binary in /opt/extensions is inert outside Lambda —
#              nothing invokes a Lambda extension in plain `docker run`.
#   migrator — a real Lambda handler (not a server), so it uses the AWS base
#              image instead of the adapter.
#
# Node 22 to match .nvmrc. Both targets build arm64 natively on GitHub's free
# ubuntu-24.04-arm runners (D2) — this stage list has no QEMU emulation step.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# --- api ---------------------------------------------------------------
FROM node:22-bookworm-slim AS api

# Pinned to an exact tag, never :latest — see CLAUDE.md on third-party image
# trust. Multi-arch (x86_64 and arm64); Docker resolves the right layer for
# --platform linux/arm64 automatically.
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:1.0.1 /lambda-adapter /opt/extensions/lambda-adapter

WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY certs ./certs

ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

# The base image bundles npm's own CLI and its transitive deps (tar, pacote,
# sigstore, ...) — found by actually running the CI scan locally before
# wiring it up, not anticipated in the plan. Nothing in this image ever
# invokes `npm`/`npx` (dependencies were already installed in the `deps`
# stage; the runtime CMD is a plain `node` call), so removing it drops those
# CVEs by deleting the unreachable code rather than suppressing the finding.
RUN rm -rf \
      /usr/local/lib/node_modules/npm \
      /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm \
      /usr/local/bin/npx \
      /usr/local/bin/corepack

# The image ships a non-root `node` user (uid 1000) out of the box.
# Everything the app does is stdout logging and outbound network calls — no
# reason to run as root, and Lambda's filesystem is read-only outside /tmp
# anyway.
USER node

EXPOSE 5000
CMD ["node", "src/lambda.js"]

# --- migrator ------------------------------------------------------------
# Handler, not a server: the AWS base image (not the adapter) is the right
# shape here, and it comes with the Lambda Runtime Interface Client built in.
FROM public.ecr.aws/lambda/nodejs:22 AS migrator

# This base image's OpenSSL packages had a HIGH CVE with a fix already in the
# AL2023 repos, just not yet baked into this base image tag — `dnf update` on
# exactly those packages picks it up without pulling in an unbounded set of
# other package changes.
RUN dnf update -y openssl-fips-provider-latest openssl-snapsafe-libs && \
    dnf clean all

# Same reasoning as the api stage: npm's bundled CLI is never invoked here
# either (the Lambda Runtime Interface Client calls the handler directly).
RUN rm -rf \
      /var/lang/lib/node_modules/npm \
      /var/lang/lib/node_modules/corepack \
      /var/lang/bin/npm \
      /var/lang/bin/npx \
      /var/lang/bin/corepack

COPY --from=deps /app/node_modules ${LAMBDA_TASK_ROOT}/node_modules
COPY src ${LAMBDA_TASK_ROOT}/src
COPY migrations ${LAMBDA_TASK_ROOT}/migrations
COPY certs ${LAMBDA_TASK_ROOT}/certs

CMD ["src/migrator.handler"]
