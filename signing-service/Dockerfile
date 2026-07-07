# ============================================
# VERIX Signing Service - Dockerfile
# Despliegue en Railway, Fly.io o Cloud Run
# ============================================
FROM node:20-alpine

WORKDIR /app

# Instalar dependencias
COPY package*.json ./
RUN npm ci --only=production

# Copiar código
COPY server.js ./

# Puerto
EXPOSE 3000

# Iniciar
CMD ["node", "server.js"]
