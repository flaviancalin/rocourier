# Dockerfile
# Builds the RoCourier Shopify App for production deployment
# Compatible with Railway, Render, Fly.io, and any Docker-based host

FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Remix
RUN npm run build

# ─── Production image ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

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

# Create non-root user
RUN addgroup -S rocourier && adduser -S rocourier -G rocourier
USER rocourier

EXPOSE 3000

# Run migrations then start server
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
