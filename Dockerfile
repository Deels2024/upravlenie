FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DB_FILE=/app/data/app.db

WORKDIR /app

RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --home /app app

COPY --chown=app:app package.json ./
COPY --chown=app:app server.js ./
COPY --chown=app:app src ./src
COPY --chown=app:app public ./public
COPY --chown=app:app data/app-data.json ./data/app-data.json
COPY --chown=app:app scripts ./scripts

RUN mkdir -p /app/data /app/private_uploads /app/backups && chown -R app:app /app

USER app
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node","--no-warnings","server.js"]
