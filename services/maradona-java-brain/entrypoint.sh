#!/bin/bash
# Simple entrypoint for Node.js MARADONA Brain

set -e

echo "🚀 Starting MARADONA Brain - Node.js V18.4"
echo "Environment: $NODE_ENV"
echo "Port: $PORT"

# Start the Node.js server
exec node src/server.js
  exit 1
fi

echo ""
echo "=== Starting application ==="
exec java -jar /app/app.jar
