# --- Stage 1: build the static assets -------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Vite reads VITE_API_URL at BUILD time and inlines it into the JS bundle,
# so it has to arrive as a build ARG, not a runtime env var.
ARG VITE_API_URL=http://localhost:5000
ENV VITE_API_URL=$VITE_API_URL

COPY . .
RUN npm run build

# --- Stage 2: serve the built files with nginx ------------------------------
# This stage starts fresh from a tiny image — none of the ~200MB of
# node_modules or the node runtime end up in the final image, only the
# static dist/ output from stage 1.
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
