# Production stage - uses pre-built client from client/dist
FROM node:20-alpine

WORKDIR /app

# Install dependencies for native modules (bcrypt, sqlite3)
RUN apk add --no-cache python3 make g++ sqlite

# Copy server package files and install dependencies
COPY server/package.json ./
COPY server/package-lock.json* ./
RUN npm install --omit=dev

# Copy server source
COPY server/ ./

# Copy pre-built client files to be served by express
COPY client/dist/ ./public/

# Create directory for SQLite database
RUN mkdir -p /data

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose the port
EXPOSE 3000

# Start the server
CMD ["node", "index.js"]
