# Imagen única para API y web (el compose decide qué comando corre cada servicio).
FROM node:22-slim
# Prisma necesita OpenSSL para su motor de consultas.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/api/prisma apps/api/prisma
RUN npm ci
COPY . .
# La URL de la API queda fija en el bundle del front al compilar.
ARG VITE_API_BASE=http://localhost:3001
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build -w apps/api && npm run build -w apps/web \
    && mkdir -p apps/api/uploads && chown -R node:node apps/api/uploads
# Sin root: la imagen oficial de Node trae el usuario `node`.
USER node
EXPOSE 3001 4173
CMD ["npm", "run", "start:cloud", "-w", "apps/api"]
