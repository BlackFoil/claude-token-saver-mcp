FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY tsconfig.json tsup.config.ts ./
COPY src/ src/

RUN npm run build

FROM node:20-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/dist/ dist/

RUN addgroup --system cts && adduser --system --ingroup cts cts
USER cts

ENV NODE_ENV=production
ENV OLLAMA_HOST=http://host.docker.internal:11434

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/server.js"]
