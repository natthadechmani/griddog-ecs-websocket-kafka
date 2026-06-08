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
RUN npm install dd-trace@4.55.0 --legacy-peer-deps
COPY --from=build /app/.next ./.next
COPY --from=build /app/next.config.js ./next.config.js
ENV PORT=3000
EXPOSE 3000

ENV NODE_OPTIONS="--require dd-trace/init" 
CMD ["npm", "start"]