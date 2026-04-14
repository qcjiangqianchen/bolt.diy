# ---- build stage ----
FROM node:22-bookworm-slim AS build
WORKDIR /app

# CI-friendly env
ENV HUSKY=0
ENV CI=true

# Use pnpm
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Ensure git and system CA bundles are available for build/runtime network access
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Accept (optional) build-time public URL for Remix/Vite (Coolify can pass it)
ARG VITE_PUBLIC_APP_URL
ENV VITE_PUBLIC_APP_URL=${VITE_PUBLIC_APP_URL}

# Install deps efficiently
COPY package.json pnpm-lock.yaml* ./
RUN pnpm fetch

# Copy source and build
COPY . .
# install with dev deps (needed to build)
RUN pnpm install --offline --frozen-lockfile

# Build the Remix app (SSR + client)
RUN NODE_OPTIONS=--max-old-space-size=4096 pnpm run build

# ---- production dependencies stage ----
FROM build AS prod-deps

# Keep only production deps for runtime
RUN pnpm prune --prod --ignore-scripts


# ---- production stage ----
FROM prod-deps AS bolt-ai-production
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5173
ENV HOST=0.0.0.0
ENV FLYCTL_PATH=/usr/local/bin/flyctl
ENV PATH="/root/.fly/bin:/usr/local/bin:${PATH}"

# Non-sensitive build arguments
ARG VITE_LOG_LEVEL=debug
ARG DEFAULT_NUM_CTX

# Set non-sensitive environment variables
ENV WRANGLER_SEND_METRICS=false \
    VITE_LOG_LEVEL=${VITE_LOG_LEVEL} \
    DEFAULT_NUM_CTX=${DEFAULT_NUM_CTX} \
    RUNNING_IN_DOCKER=true

# Note: API keys should be provided at runtime via docker run -e or docker-compose
# Example: docker run -e OPENAI_API_KEY=your_key_here ...

# Install runtime tools required by startup scripts and ensure CA trust store exists
RUN apt-get update && apt-get install -y --no-install-recommends curl bash ca-certificates \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Wrangler is still required for in-app Cloudflare deployment flows.
RUN npm install -g wrangler@4.44.0

# Fly.io CLI is required by the in-app Fly deployment endpoint.
RUN curl -fsSL https://fly.io/install.sh | bash && \
  ln -sf /root/.fly/bin/flyctl /usr/local/bin/flyctl

# Copy built files and scripts
COPY --from=prod-deps /app/build /app/build
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/package.json /app/package.json
COPY --from=prod-deps /app/public /app/public
COPY --from=prod-deps /app/server.mjs /app/server.mjs
COPY --from=prod-deps /app/bindings.sh /app/bindings.sh
COPY docker/certs /usr/local/share/ca-certificates/custom

# Pre-configure wrangler to disable metrics
RUN mkdir -p /root/.config/.wrangler && \
    echo '{"enabled":false}' > /root/.config/.wrangler/metrics.json

# Normalize line endings and make bindings script executable
RUN sed -i 's/\r$//' /app/bindings.sh && chmod +x /app/bindings.sh

# Refresh trust store after copying any custom root CAs
RUN update-ca-certificates || true

EXPOSE 5173

# Healthcheck for deployment platforms
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD curl -fsS http://localhost:5173/ || exit 1

# Refresh trust store again at container startup in case certs are mounted/updated
CMD ["bash", "-lc", "update-ca-certificates >/dev/null 2>&1 || true; pnpm run dockerstart:node"]


# ---- development stage ----
FROM build AS development

# Non-sensitive development arguments
ARG VITE_LOG_LEVEL=debug
ARG DEFAULT_NUM_CTX

# Set non-sensitive environment variables for development
ENV VITE_LOG_LEVEL=${VITE_LOG_LEVEL} \
    DEFAULT_NUM_CTX=${DEFAULT_NUM_CTX} \
    RUNNING_IN_DOCKER=true \
    FLYCTL_PATH=/usr/local/bin/flyctl

ENV PATH="/root/.fly/bin:/usr/local/bin:${PATH}"

# Note: API keys should be provided at runtime via docker run -e or docker-compose
# Example: docker run -e OPENAI_API_KEY=your_key_here ...

RUN apt-get update && apt-get install -y --no-install-recommends curl bash ca-certificates \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g wrangler@4.44.0

RUN curl -fsSL https://fly.io/install.sh | bash && \
  ln -sf /root/.fly/bin/flyctl /usr/local/bin/flyctl

RUN mkdir -p /app/run
CMD ["pnpm", "run", "dev", "--host"]
