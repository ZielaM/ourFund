#!/bin/sh
set -e

echo "Applying database migrations..."
(cd /migrate && node node_modules/prisma/build/index.js migrate deploy)

exec "$@"
