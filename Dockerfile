FROM node:18-alpine

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy app source
COPY . .

# Create logs directory
RUN mkdir -p logs

# Make setup script executable
RUN chmod +x ./scripts/setup-env.sh

# Set up production environment (if no .env file exists)
RUN if [ ! -f .env ]; then ./scripts/setup-env.sh --env production; fi

# Create a non-root user and switch to it
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs
RUN chown -R nodejs:nodejs /app
USER nodejs

# Expose the service port
EXPOSE 3000

# Start the service
CMD ["node", "src/index.js"] 