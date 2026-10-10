#!/bin/sh
# Creates .env.hq (gitignored) with the first HQ admin login, then sets it on Railway.
# Re-running keeps the existing .env.hq.
set -e
cd "$(dirname "$0")/.."
grep -qx ".env.hq" .gitignore || echo ".env.hq" >> .gitignore
if [ ! -f .env.hq ]; then
  umask 077
  {
    echo "HQ_ADMIN_EMAIL=flaviann.calin@gmail.com"
    echo "HQ_ADMIN_PASSWORD=Picklo$(openssl rand -hex 6)7a"
    echo "HQ_SESSION_SECRET=$(openssl rand -hex 32)"
  } > .env.hq
fi
. ./.env.hq
railway variables -s rocourier --skip-deploys \
  --set "HQ_ADMIN_EMAIL=$HQ_ADMIN_EMAIL" \
  --set "HQ_ADMIN_PASSWORD=$HQ_ADMIN_PASSWORD" \
  --set "HQ_SESSION_SECRET=$HQ_SESSION_SECRET" > /dev/null
echo "HQ setat pe Railway pentru $HQ_ADMIN_EMAIL. Parola e in ~/Downloads/rocourier/.env.hq"
