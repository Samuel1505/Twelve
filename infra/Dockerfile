# One image, two process types (docs/ARCHITECTURE.md §5): `api` (HTTP + scan worker + attester) and `monitor`.
# Node 22 + pnpm for the services, Python 3.12 + uv for the analyzer, solc fetched and sha256-checked at build time.
# Build from the repo root (the commit is part of every report's tool identity, so it is required):
#   docker build --platform linux/amd64 -f infra/Dockerfile --build-arg TWELVE_GIT_COMMIT=$(git rev-parse HEAD) -t twelve .
FROM node:22-bookworm-slim

ARG TWELVE_GIT_COMMIT
RUN test -n "$TWELVE_GIT_COMMIT" || (echo "TWELVE_GIT_COMMIT build arg is required (reportHash reproducibility, I4)" >&2; exit 1)
ENV TWELVE_GIT_COMMIT=$TWELVE_GIT_COMMIT

ENV DEBIAN_FRONTEND=noninteractive \
    UV_PYTHON_INSTALL_DIR=/opt/uv-python \
    UV_LINK_MODE=copy \
    TWELVE_CACHE=/opt/twelve-cache
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.12.19 /uv /uvx /usr/local/bin/
RUN corepack enable

WORKDIR /app

# --- node deps (only what api + monitor need)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/monitor/package.json apps/monitor/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter @twelve/api... --filter @twelve/monitor...

# --- analyzer (Python 3.12 managed by uv; exact slither pin from uv.lock)
COPY analyzer/pyproject.toml analyzer/uv.lock analyzer/.python-version analyzer/
COPY analyzer/twelve analyzer/twelve
RUN cd analyzer && uv sync --frozen --no-dev \
    && ln -s "$(uv run --no-sync python -c "from twelve.fetch.solc_bin import ensure_solc; print(ensure_solc('0.8.30+commit.73712a01'))")" /usr/local/bin/solc-0.8.30 \
    && /usr/local/bin/solc-0.8.30 --version
ENV TWELVE_SOLC=/usr/local/bin/solc-0.8.30

# --- service sources
COPY packages packages
COPY apps/api apps/api
COPY apps/monitor apps/monitor

ENV NODE_ENV=production
# The attester key reaches only the api process through the platform's secret store (I11, I12). No .env in the image.
EXPOSE 8787
CMD ["pnpm", "--filter", "@twelve/api", "start"]
