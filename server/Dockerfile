# Tracker API image for Railway (or any container host). Build from the repo root:
#   docker build -f server/Dockerfile .
# Copies only what the API needs; secrets come from the host's environment variables, never from files.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev && npm cache clean --force
COPY server/server.js server/
COPY server/lib server/lib
COPY server/routes server/routes
COPY server/scripts server/scripts
COPY server/certs server/certs
COPY tools/manual/trackers/definitions.json tools/manual/trackers/definitions.json
USER node
EXPOSE 4000
CMD ["node", "server/server.js"]
