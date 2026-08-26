FROM node:20-bookworm

# Install LibreOffice and required fonts
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    libreoffice \
    libreoffice-impress \
    fonts-dejavu \
    fonts-liberation && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy project
COPY . .

# Render provides the PORT environment variable
EXPOSE 3000

CMD ["npm", "start"]