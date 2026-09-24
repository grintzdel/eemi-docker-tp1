# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS deps
WORKDIR /app/api
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# dev et prod tournent tous deux en uid 1000 (node). C'est ce qui garde le volume
# uploads coherent : Docker ne recopie les droits de l'image que dans un volume
# vide, donc un volume ecrit en root par le dev resterait illisible en prod.
FROM deps AS dev
COPY --chown=node:node . .
RUN mkdir -p uploads dist && chown node:node /app/api uploads dist
USER node
EXPOSE 3000
CMD ["./docker-dev.sh"]

FROM deps AS build
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS prod
ENV NODE_ENV=production
WORKDIR /app/api
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev
COPY --from=build /app/api/dist ./dist
RUN mkdir -p uploads && chown node:node uploads
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
