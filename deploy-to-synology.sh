#!/bin/bash
# Deploy Chor Dai Dee to Synology NAS
# Usage: ./deploy-to-synology.sh [synology-host] [synology-user]

set -e

# Configuration
SYNOLOGY_HOST="${1:-${SYNOLOGY_HOST}}"
SYNOLOGY_USER="${2:-${SYNOLOGY_USER:-admin}}"
DEPLOY_PATH="/volume1/docker/chor-dai-dee"
APP_NAME="chor-dai-dee"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if host is provided
if [ -z "$SYNOLOGY_HOST" ]; then
    echo -e "${RED}Error: Synology host not specified${NC}"
    echo "Usage: ./deploy-to-synology.sh <synology-host> [synology-user]"
    echo "Or set SYNOLOGY_HOST environment variable"
    exit 1
fi

echo -e "${GREEN}Starting deployment to $SYNOLOGY_HOST...${NC}"

# Step 1: Build server dependencies
echo -e "${YELLOW}Step 1: Installing server dependencies...${NC}"
cd server
npm install
cd ..

# Step 2: Build frontend
echo -e "${YELLOW}Step 2: Building client...${NC}"
cd client
npm install
npm run build
cd ..

# Step 3: Create deployment package
echo -e "${YELLOW}Step 3: Creating deployment package...${NC}"
tar -czf ${APP_NAME}.tar.gz \
    server/ \
    client/dist/ \
    Dockerfile \
    docker-compose.yml \
    .dockerignore \
    start-tailscale.sh

# Step 4: Create deployment directory on Synology
echo -e "${YELLOW}Step 4: Setting up Synology deployment directory...${NC}"
ssh $SYNOLOGY_USER@$SYNOLOGY_HOST "mkdir -p $DEPLOY_PATH"

# Step 5: Upload to Synology
echo -e "${YELLOW}Step 5: Uploading to Synology...${NC}"
scp -O ${APP_NAME}.tar.gz $SYNOLOGY_USER@$SYNOLOGY_HOST:$DEPLOY_PATH/

# Step 6: Extract and deploy on Synology
echo -e "${YELLOW}Step 6: Deploying on Synology...${NC}"
ssh $SYNOLOGY_USER@$SYNOLOGY_HOST << EOF
    cd $DEPLOY_PATH
    tar -xzf ${APP_NAME}.tar.gz
    rm ${APP_NAME}.tar.gz

    # Stop existing container if running
    docker-compose down 2>/dev/null || true

    # Build and start the container
    docker-compose up -d --build

    echo "Deployment complete! Container status:"
    docker-compose ps
EOF

# Step 7: Cleanup local files
echo -e "${YELLOW}Step 7: Cleaning up local files...${NC}"
rm ${APP_NAME}.tar.gz

echo -e "${GREEN}Deployment complete!${NC}"
echo -e "Access the app at: http://$SYNOLOGY_HOST:3000"
