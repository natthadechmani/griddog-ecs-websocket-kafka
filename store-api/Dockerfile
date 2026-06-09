FROM node:16-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:16-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist
ENV PORT=4000
ENV NODE_OPTIONS="--require dd-trace/init"
EXPOSE 4000

CMD ["node", "dist/main"]
