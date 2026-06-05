FROM node:18-slim

WORKDIR /app

# Copia file essenziali
COPY package.json .
COPY src/ ./src/

# Installa dipendenze di produzione
RUN npm install --production

# Esponi la porta Railway (PORT)
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Start
CMD ["node", "src/server.js"]

# Fallback CMD (in caso l'ENTRYPOINT non funzioni)
CMD []
