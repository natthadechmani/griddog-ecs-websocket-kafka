FROM node:16-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

FROM node:16-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --only=production --legacy-peer-deps
COPY --from=build /app/.next ./.next
COPY --from=build /app/next.config.js ./next.config.js
ENV PORT=3001
EXPOSE 3001
CMD ["npm", "start"]
