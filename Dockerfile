# Production stage - uses pre-built client from client/dist
# Use Debian-based image (bookworm) instead of Alpine to ensure glibc compatibility for TensorFlow
FROM node:20-bookworm

WORKDIR /app

# Install dependencies for native modules (bcrypt, sqlite3) and Python AI environment
# We install python3, pip, and build tools
# We also install wget for the healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    make \
    g++ \
    sqlite3 \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
RUN python3 -m pip install --break-system-packages tensorflow==2.16.1 numpy joblib

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
