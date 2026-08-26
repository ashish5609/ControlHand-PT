FROM node:20-bookworm

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libreoffice \
        libreoffice-impress \
        poppler-utils \
        fonts-dejavu \
        fonts-liberation \
        fonts-noto-core \
        fonts-noto-cjk \
        fonts-noto-color-emoji && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
