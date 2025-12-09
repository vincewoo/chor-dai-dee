# Production stage - uses pre-built client from client/dist
FROM node:20-alpine

WORKDIR /app

# Install dependencies for native modules (bcrypt, sqlite3) and Python AI environment
# We install python3, pip, and build tools
# Then we install the python dependencies: tensorflow, numpy, joblib
RUN apk add --no-cache python3 py3-pip make g++ sqlite && \
    python3 -m pip install --break-system-packages tensorflow==2.16.1 numpy joblib

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
