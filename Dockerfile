FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir /data && chown node:node /data
COPY --chown=node:node server.js accounts.js billing.js practice.js security.js prompts.js workspace.js oauth.js access.js question-focus.js storage.js quotas.js audio-duration.js mailer.js registration.js payments.js monitoring.js ./
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3100 COPILOTE_DB_PATH=/data/copilote.sqlite
EXPOSE 3100
VOLUME ["/data"]
CMD ["node", "server.js"]
