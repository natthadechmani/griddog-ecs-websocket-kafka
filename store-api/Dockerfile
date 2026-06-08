FROM node:16-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps

# Datadog-Tracer installation

COPY . .
RUN npm run build

FROM node:16-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --only=production --legacy-peer-deps
RUN npm install dd-trace@4.55.0 --legacy-peer-deps

COPY --from=build /app/dist ./dist
ENV PORT=4000
EXPOSE 4000

# Initialize Datadog trace agent
ENV NODE_OPTIONS="--require dd-trace/init" 
CMD ["node", "dist/main"]
