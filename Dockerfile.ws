# Litewrite WebSocket Collaboration Server Dockerfile

FROM node:22-slim
WORKDIR /app

# Install build tools for native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Copy dependency files
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --legacy-peer-deps --omit=dev

# Install tsx for TypeScript execution
RUN npm install tsx

# Copy server code and dependent libraries
COPY server ./server
COPY lib ./lib
COPY tsconfig.json ./

# Expose port
EXPOSE 1234

ENV NODE_ENV=production
ENV WS_PORT=1234

# Start WebSocket server
CMD ["npx", "tsx", "server/ws-server.ts"]
