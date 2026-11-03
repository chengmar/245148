FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY public ./public
ENV HOST=0.0.0.0 PORT=3210 NODE_ENV=production
EXPOSE 3210
USER node
CMD ["node","src/server.js"]
