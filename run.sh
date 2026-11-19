#!/usr/bin/env bash

set -euo pipefail

APP_NAME="omegle-bot"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$ROOT_DIR"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 is not installed or not on PATH"
  exit 1
fi

if [ ! -f .env ]; then
  echo ".env is missing — copy .env.example to .env and fill it in"
  exit 1
fi

echo "Installing dependencies..."
# Dev dependencies are required: prisma and typescript are used to build.
npm ci --include=dev --no-audit --no-fund

echo "Applying database migrations..."
# --no-install: always use the project's pinned Prisma, never download another version.
npx --no-install prisma migrate deploy

echo "Removing old build output..."
rm -rf dist

echo "Building project..."
npm run build

echo "Deploying slash commands globally..."
npm run deploy:prod

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  echo "Restarting existing PM2 process: $APP_NAME"
  pm2 restart "$APP_NAME" --update-env
else
  echo "Starting new PM2 process: $APP_NAME"
  pm2 start ecosystem.config.js --only "$APP_NAME"
fi

pm2 save
