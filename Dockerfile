# Dockerfile
# Builds the RoCourier Shopify App for production deployment
# Compatible with Railway, Render, Fly.io, and any Docker-based host

FROM node:20-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Cache bust — increment when you need a forced full rebuild
ARG CACHE_BUST=2
RUN echo "Cache bust: $CACHE_BUST"

# Copy source
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Remix
RUN NODE_OPTIONS=--max-old-space-size=1024 npm run build

# ─── Production image ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

RUN apk add --no-cache openssl

WORKDIR /app

# Only install production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy built files
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma
COPY shopify.app.toml ./

# Create non-root user and fix permissions
RUN addgroup -S rocourier && adduser -S rocourier -G rocourier \
    && chown -R rocourier:rocourier /app
USER rocourier

EXPOSE 3000

# Run migrations then start server
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
