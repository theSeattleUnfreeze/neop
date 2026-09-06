FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build
RUN chmod +x docker-entrypoint.sh
ENV PORT=3847
EXPOSE 3847
# Container listens on all interfaces; compose binds host to 127.0.0.1.
ENTRYPOINT ["./docker-entrypoint.sh"]
