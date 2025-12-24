FROM node:18-alpine

WORKDIR /app

# Install build dependencies for native modules (sqlite3, bcrypt)
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies and rebuild native modules for Alpine
RUN npm ci --only=production && npm rebuild

# Copy application files
COPY . .

# Expose port
EXPOSE 3000

# Start the server
CMD ["node", "index.js"]
