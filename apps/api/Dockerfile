FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install
COPY . .
EXPOSE 3000
CMD ["sh", "-c", "npm run migrate -w apps/api && npm run seed -w apps/api && npm run start -w apps/api"]
