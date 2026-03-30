FROM node:20-alpine AS backend-builder
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
ARG NEXT_PUBLIC_API_BASE=http://localhost:8000
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
RUN npm run build

FROM node:20-alpine AS backend
WORKDIR /app
COPY --from=backend-builder /app/dist ./dist
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/package.json ./
EXPOSE 8000
CMD ["node", "dist/index.js"]

FROM node:20-alpine AS frontend
WORKDIR /app
COPY --from=frontend-builder /app/.next ./.next
COPY --from=frontend-builder /app/node_modules ./node_modules
COPY --from=frontend-builder /app/package.json ./
COPY --from=frontend-builder /app/public ./public 2>/dev/null || true
EXPOSE 3000
CMD ["npm", "run", "start"]
