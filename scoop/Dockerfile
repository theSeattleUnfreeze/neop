FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build
ENV PORT=3847
EXPOSE 3847
# Container must listen on all interfaces; compose binds host to 127.0.0.1.
CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3847"]
