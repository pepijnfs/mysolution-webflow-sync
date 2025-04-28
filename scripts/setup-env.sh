#!/bin/bash

# Setup environment script for Mysolution Job Sync

# Default values
ENV_FILE=".env"
ENV_TEMPLATE=".env.example"
ENV_TYPE="development"

# Help message
display_help() {
  echo "Usage: $0 [options]"
  echo
  echo "Setup environment configuration for Mysolution Job Sync"
  echo
  echo "Options:"
  echo "  -h, --help           Display this help message"
  echo "  -e, --env [type]     Environment type (development, production)"
  echo "  -f, --file [path]    Path to output .env file (default: .env)"
  echo "  -t, --template [path] Path to template file (default: .env.example)"
  echo
}

# Process command line arguments
while [[ $# -gt 0 ]]; do
  key="$1"
  case $key in
    -h|--help)
      display_help
      exit 0
      ;;
    -e|--env)
      ENV_TYPE="$2"
      shift
      shift
      ;;
    -f|--file)
      ENV_FILE="$2"
      shift
      shift
      ;;
    -t|--template)
      ENV_TEMPLATE="$2"
      shift
      shift
      ;;
    *)
      echo "Unknown option: $1"
      display_help
      exit 1
      ;;
  esac
done

# Check if template file exists
if [ ! -f "$ENV_TEMPLATE" ]; then
  echo "Template file $ENV_TEMPLATE not found!"
  exit 1
fi

# Create directories if they don't exist
mkdir -p logs

# Copy template to .env file
cp "$ENV_TEMPLATE" "$ENV_FILE"
echo "Created $ENV_FILE from template $ENV_TEMPLATE"

# Set environment-specific configurations
case $ENV_TYPE in
  development)
    echo "Configuring for development environment"
    sed -i.bak "s/NODE_ENV=.*/NODE_ENV=development/" "$ENV_FILE"
    sed -i.bak "s/LOG_LEVEL=.*/LOG_LEVEL=debug/" "$ENV_FILE"
    ;;
  production)
    echo "Configuring for production environment"
    sed -i.bak "s/NODE_ENV=.*/NODE_ENV=production/" "$ENV_FILE"
    sed -i.bak "s/LOG_LEVEL=.*/LOG_LEVEL=info/" "$ENV_FILE"
    sed -i.bak "s/LOG_CONSOLE=.*/LOG_CONSOLE=false/" "$ENV_FILE"
    ;;
  *)
    echo "Unknown environment type: $ENV_TYPE"
    echo "Using default settings"
    ;;
esac

# Remove backup file created by sed
rm -f "$ENV_FILE.bak"

echo "Environment setup complete. Please update $ENV_FILE with your actual credentials."
echo "Required variables to set:"
grep -E "^[A-Z_]+=your_" "$ENV_FILE"

exit 0 