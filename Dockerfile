FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy built files
COPY dist/ ./dist/

# Set environment variables (users override these)
ENV LIGHTNING_WALLET_API_URL=https://lightningfaucet.com/api/agent
ENV LIGHTNING_WALLET_API_KEY=

# Run the MCP server
ENTRYPOINT ["node", "dist/index.js"]
