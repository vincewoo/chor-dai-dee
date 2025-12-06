# Build stage for client
FROM node:20-alpine AS client-builder

WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy server files
COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm ci --only=production

# Copy server source
COPY server/ ./

# Copy built client files
COPY --from=client-builder /app/client/dist ../client/dist

# Expose the port
EXPOSE 3000

# Start the server
CMD ["node", "index.js"]
