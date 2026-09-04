# ==============================================================================
# 1. DEPENDENCY INSTALLATION STAGE
# ==============================================================================
FROM node:22-alpine AS deps
WORKDIR /app

# Install native dependencies required by Prisma engine
RUN apk add --no-cache libc6-compat openssl

COPY package.json package-lock.json ./
COPY prisma ./prisma/

RUN npm ci

# ==============================================================================
# 2. BUILD STAGE
# ==============================================================================
FROM node:22-alpine AS builder
WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma Client & compile TypeScript to dist/
RUN npx prisma generate
RUN npm run build

# Prune devDependencies to keep image lean
RUN npm prune --production

# ==============================================================================
# 3. PRODUCTION RUNNER STAGE
# ==============================================================================
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Prisma engine on Alpine requires openssl; dumb-init manages PID 1 signals
RUN apk add --no-cache openssl dumb-init curl

# Prepare uploads directory and ensure node user permissions
RUN mkdir -p /app/uploads && chown -R node:node /app

# Copy production artifacts
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/package.json ./package.json

COPY --chown=node:node docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER node

EXPOSE 3001

ENTRYPOINT ["/usr/bin/dumb-init", "--", "./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
