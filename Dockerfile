# Build stage for Client
# Set the base image for the build stage.
# Node 20 is used to match the runtime environment.
FROM node:20-bookworm AS client-builder

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


# Build stage for the server's native modules.
# bcrypt and sqlite3 compile from source here, so make/g++/python3 live in this
# stage only -- the runtime image gets the finished node_modules and none of the
# ~300 MB toolchain. This matters because the server self-terminates when idle
# (min_machines_running = 0), so image size is paid back on every cold start.
FROM node:20-bookworm AS server-builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    make \
    g++ \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Copy server package files first to leverage Docker cache
COPY server/package.json ./
COPY server/package-lock.json* ./
RUN npm install --omit=dev


# Production stage
# Use Debian-based image (bookworm) instead of Alpine to ensure glibc compatibility for TensorFlow and other native modules
FROM node:20-bookworm

WORKDIR /app

# Runtime-only dependencies: python3 for the advanced-bot worker, sqlite3 for
# operational inspection, wget for the healthcheck. No compilers.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    sqlite3 \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies for AI features
# Using --break-system-packages because we are in a container/venv-like env.
# The CPU-only TensorFlow build is a fraction of the size of the default wheel,
# which drags in CUDA libraries this app never uses.
RUN python3 -m pip install --break-system-packages --no-cache-dir \
    tensorflow-cpu==2.16.1 numpy joblib

# Bring in the prebuilt server dependencies
COPY --from=server-builder /app/node_modules ./node_modules
COPY server/package.json ./
COPY server/package-lock.json* ./

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
