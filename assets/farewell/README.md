# Farewell sounds

Drop `.mp3` / `.wav` / `.ogg` / `.m4a` files in this folder. When the queue
finishes and the bot is about to leave the voice channel, one of these is
picked at random and played before disconnecting.

If the folder is empty, the bot just leaves silently as before.

This folder is gitignored — copy the files to the server manually:

```
scp -i C:/Users/naphat/.ssh/bot_hetzner ./*.mp3 \
  root@62.238.28.67:/opt/discord-music-bot/assets/farewell/
```
