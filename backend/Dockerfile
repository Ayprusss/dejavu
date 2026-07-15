# Small, secure base image. "-alpine" trims the OS down to the essentials.
FROM node:20-alpine

WORKDIR /app

# Copy only the dependency manifests first so Docker can cache this layer.
# As long as package*.json don't change, `npm ci` won't rerun on every
# code edit — this is the single biggest speedup for Docker dev loops.
COPY package*.json ./
RUN npm ci --omit=dev

# Now copy the actual source.
COPY src ./src

EXPOSE 5000

# Runtime env vars (SUPABASE_URL, STRIPE_SECRET_KEY, etc.) are injected by
# docker-compose / `docker run -e`, not read from a .env file baked into
# the image — so we call node directly instead of the dotenv-wrapped
# npm scripts from package.json.
CMD ["node", "src/server.js"]
