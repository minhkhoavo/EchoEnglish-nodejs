# ---------- Builder ----------
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++ git && npm i -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build
RUN pnpm prune --prod

# ---------- Runner ----------
FROM node:20-alpine AS runner
WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 4000
CMD ["node", "dist/index.js"]
