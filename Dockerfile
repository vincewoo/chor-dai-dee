# Build stage for Client
# Set the base image for the build stage.
# Node 20 is used to match the runtime environment.
FROM node:20-bookworm as client-builder

# Build arguments for client-side environment variables
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

# Set working directory for client build
WORKDIR /app/client

# Copy client package files
COPY client/package*.json ./

# Install client dependencies
RUN npm ci

# Copy client source code
COPY client/ ./

# Build the client application
# This will output static files to /app/client/dist
RUN npm run build


# Production stage
# Use Debian-based image (bookworm) instead of Alpine to ensure glibc compatibility for TensorFlow and other native modules
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

# Install python dependencies for AI features
# Using --break-system-packages because we are in a container/venv-like env
RUN python3 -m pip install --break-system-packages tensorflow==2.16.1 numpy joblib

# Copy server package files and install dependencies
# We copy package.json first to leverage Docker cache
COPY server/package.json ./
COPY server/package-lock.json* ./
RUN npm install --omit=dev

# Copy server source code
COPY server/ ./

# Copy built client files from the builder stage
# Example: /app/client/dist -> /app/public
COPY --from=client-builder /app/client/dist ./public

# Create directory for SQLite database
# The app should be configured to write to /data/database.sqlite if mounting a volume there
RUN mkdir -p /data

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose the port
EXPOSE 3000

# Start the server
CMD ["node", "index.js"]
