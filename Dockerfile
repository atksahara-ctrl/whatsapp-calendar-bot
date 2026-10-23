FROM ghcr.io/puppeteer/puppeteer:22.0.0

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["node", "bot.js"]
