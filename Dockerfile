FROM node:20-bookworm

# Install LibreOffice and fonts required for PowerPoint rendering
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libreoffice \
        libreoffice-impress \
        fonts-dejavu \
        fonts-liberation \
        fonts-noto-core \
        fonts-noto-cjk \
        fonts-noto-color-emoji && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies
COPY package*.json ./

RUN npm ci --omit=dev

# Copy project files
COPY . .

# Render uses the PORT environment variable
EXPOSE 3000

CMD ["npm", "start"]
