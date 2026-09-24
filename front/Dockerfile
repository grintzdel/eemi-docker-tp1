# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS deps
WORKDIR /app/front
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM deps AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]

# VITE_API_URL est inline dans le bundle par Vite : c'est une variable de BUILD,
# pas de runtime. En prod elle vaut /api, que nginx proxifie vers l'API.
FROM deps AS build
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.29-alpine AS prod
COPY --from=build /app/front/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
