#!/bin/bash
set -e
cd /opt/discord-music-bot
echo === git pull ===
git pull
echo === npm ci ===
npm ci --omit=dev
echo === restart service ===
systemctl restart discord-music-bot
sleep 3
systemctl is-active discord-music-bot
echo === last 10 log lines ===
journalctl -u discord-music-bot -n 10 --no-pager
