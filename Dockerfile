# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS build
WORKDIR /app
RUN --mount=type=cache,target=/var/cache/apk apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm install --no-audit --no-fund
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
