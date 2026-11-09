# Deploys the public mock merchant (catalog + x402 paywall + flight feed + demo admin).
# Build from the repo root:  docker build -f services/mocks/Dockerfile .
FROM oven/bun:1.3 AS base
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared ./packages/shared
COPY services/mocks ./services/mocks
RUN bun install -g pnpm@10 && pnpm install --frozen-lockfile --filter @layover/mocks...
WORKDIR /app/services/mocks
ENV PORT=8080
EXPOSE 8080
CMD ["bun", "src/main.ts"]
