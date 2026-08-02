FROM node:22.20-alpine AS build
WORKDIR /workspace
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
ARG VITE_DATA_SOURCE=api
ARG VITE_API_BASE_URL=
ENV VITE_DATA_SOURCE=${VITE_DATA_SOURCE} VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY frontend/deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/dist/client /usr/share/nginx/html
USER 101
EXPOSE 8080
