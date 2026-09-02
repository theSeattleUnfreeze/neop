FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
COPY package.json pnpm-lock.yaml* package-lock.json* ./
RUN if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; \
    elif [ -f package-lock.json ]; then npm ci; \
    else pnpm install; fi
COPY . .
RUN pnpm run build || npm run build
ENV PORT=3847
EXPOSE 3847
# Container must listen on all interfaces; compose binds host to 127.0.0.1.
CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3847"]
