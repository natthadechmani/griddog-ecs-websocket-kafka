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
COPY --from=build /app/dist ./dist
ENV PORT=4001
EXPOSE 4001
CMD ["node", "dist/main"]
