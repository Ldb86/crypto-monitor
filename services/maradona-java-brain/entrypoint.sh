#!/bin/bash
set -e

echo "=== Runtime Debug Info ==="
echo "Working directory: $(pwd)"
echo "User: $(whoami)"
echo "Java version:"
java -version

echo ""
echo "=== Checking JAR file ==="
if [ -f /app/app.jar ]; then
  echo "✓ /app/app.jar exists"
  echo "  Size: $(du -h /app/app.jar | cut -f1)"
  echo "  Permissions: $(ls -l /app/app.jar | awk '{print $1, $3, $4}')"
  echo "  Can read: $(test -r /app/app.jar && echo 'YES' || echo 'NO')"
else
  echo "✗ /app/app.jar NOT FOUND!"
  echo "  Files in /app:"
  ls -la /app/
  exit 1
fi

echo ""
echo "=== Starting application ==="
exec java -jar /app/app.jar
