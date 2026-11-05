#!/usr/bin/env bash
# One-time setup for automatic deploys (run by the owner from the repo root):  deploy/setup-ci-secrets.sh
# Creates an SSH key used only by GitHub Actions, authorises it on the VPS, stores it as repository secrets,
# turns deploys on, and deletes the local copy of the private key. Nothing secret is printed.
set -euo pipefail
REPO=${REPO:-Ghanz08/glideslope}
SSH_HOST=${SSH_HOST:-ghani-main} # ~/.ssh/config alias for the VPS
VPS_IP=${VPS_IP:-203.0.113.10}
VPS_USER=${VPS_USER:-civo}

dir=$(mktemp -d); trap 'rm -rf "$dir"' EXIT
ssh-keygen -q -t ed25519 -N "" -C "glideslope-ci-deploy" -f "$dir/key"
ssh "$SSH_HOST" 'mkdir -p ~/.ssh && grep -v glideslope-ci-deploy ~/.ssh/authorized_keys > ~/.ssh/ak.tmp 2>/dev/null; cat ~/.ssh/ak.tmp - > ~/.ssh/authorized_keys; rm -f ~/.ssh/ak.tmp; chmod 600 ~/.ssh/authorized_keys' < "$dir/key.pub"
ssh-keyscan -t ed25519,ecdsa,rsa "$VPS_IP" 2>/dev/null > "$dir/known_hosts"

gh secret set VPS_SSH_KEY -R "$REPO" < "$dir/key"
gh secret set VPS_KNOWN_HOSTS -R "$REPO" < "$dir/known_hosts"
gh secret set VPS_HOST -R "$REPO" -b "$VPS_IP"
gh secret set VPS_USER -R "$REPO" -b "$VPS_USER"
gh variable set DEPLOY_ENABLED -R "$REPO" -b true
echo "Siap. Deploy berikutnya: push ke main, atau  gh workflow run ci -R $REPO --ref main"
