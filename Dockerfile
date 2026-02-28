# =========================
# Build Stage
# =========================
FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable

# Copy dependency manifests first (cache optimization)
COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build TypeScript
RUN pnpm build


# =========================
# Runtime Stage
# =========================
FROM node:20-alpine

WORKDIR /app

RUN corepack enable

# Copy deps + build output
COPY package.json pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

EXPOSE 4000

CMD ["pnpm", "start"]