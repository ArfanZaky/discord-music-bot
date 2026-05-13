# Base image: Node + FFmpeg (untuk audio streaming)
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip \
    && pip3 install --break-system-packages yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

CMD ["sh", "-c", "npm install && npm start"]
