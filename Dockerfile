FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy built files
COPY dist/ ./dist/

# Set environment variables (users override these)
ENV LIGHTNING_FAUCET_API_URL=https://lightningfaucet.com/api/agent
ENV LIGHTNING_FAUCET_OPERATOR_KEY=
ENV LIGHTNING_FAUCET_AGENT_KEY=

# Run the MCP server
ENTRYPOINT ["node", "dist/index.js"]
