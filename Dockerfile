# Hifi One production image. NOT YET BUILT OR TESTED: Docker was not available where this was written.
# Build it on a machine with Docker, run scripts/smoke-prod.mjs against the container, and report anything that fails.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --legacy-peer-deps

FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 STORAGE_DIR=/data/files
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home /app hifi && mkdir -p /data/files && chown -R hifi /data /app
COPY --from=build --chown=hifi /app ./
USER hifi
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrations are applied before the server starts; they are additive and safe to repeat.
CMD ["sh", "-c", "npx prisma migrate deploy && npx next start -p 3000"]
