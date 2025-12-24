FROM node:18-alpine

WORKDIR /app

# Install build dependencies for native modules (sqlite3, bcrypt)
# Add sqlite-dev for SQLite headers needed to compile sqlite3 module
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite-dev

# Copy package files
COPY package*.json ./

# Install dependencies - this will build native modules from source for Alpine
RUN npm ci --only=production

# Copy application files
COPY . .

# Expose port
EXPOSE 3000

# Start the server
CMD ["node", "index.js"]
