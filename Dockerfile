# Stage 1: Build Frontend
FROM node:24-bookworm-slim AS frontend-builder
WORKDIR /build

# 安装 pnpm
RUN npm install -g pnpm

# 拷贝依赖相关文件
COPY package.json pnpm-lock.yaml ./

# 使用 --ignore-scripts 安装依赖以避开高版本 pnpm 对编译脚本的安全拦截 (esbuild 平台依赖通过可选依赖自动按平台拉取，不运行 install 脚本也可正常打包)
RUN pnpm install --frozen-lockfile --ignore-scripts

# 拷贝所有前端源码与必要的 vendor 目录
COPY src/ ./src/
COPY public/ ./public/
COPY playground/ ./playground/
COPY tsconfig.json vite.config.ts eslint.config.js index.html app.html ./
COPY vendor/ ./vendor/

# 进行打包
RUN pnpm build

# Stage 2: Build the Go binary
FROM golang:1.20-bookworm AS backend-builder
# 安装 magic 开发库以编译后端 CGO
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY server-go/go.mod server-go/go.sum ./
RUN go mod download
COPY server-go/ ./
RUN CGO_ENABLED=1 GOOS=linux GOARCH=amd64 go build -o office-viewer-backend .

# Stage 3: Final runtime environment
FROM debian:bookworm-slim

# 安装运行所需的动态链接库 (OnlyOffice 原生所需要的系统基础库)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 \
    libxml2 \
    ca-certificates \
    fontconfig \
    libfontconfig1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 拷贝编译好的 Go 后端
COPY --from=backend-builder /build/office-viewer-backend /app/office-viewer-backend

# 拷贝 x2t 工具链到 /app/bin (包含 bin 下原有的所有 so 库，包含 DoctRenderer.config 与 xregexp-all-min.js)
COPY server-go/x2t/ /app/bin/

# 拷贝外挂物理字体到 /app/assets/fonts/
COPY fonts/ /app/assets/fonts/

# 拷贝前端打包的 dist 目录
COPY --from=frontend-builder /build/dist /app/dist

# 创建软链接，以使 DoctRenderer.config (配置为 ../sdkjs 和 ../dictionaries) 能够找到前端代码中对应的 sdkjs 资源
RUN ln -s /app/dist/vendor/onlyoffice/sdkjs /app/sdkjs && \
    ln -s /app/dist/vendor/onlyoffice/dictionaries /app/dictionaries

# 设置动态链接库路径，使 x2t 可以找到同目录下的 .so 依赖库
ENV LD_LIBRARY_PATH=/app/bin
ENV X2T_PATH=/app/bin/x2t
ENV TEMP_DIR=/app/temp
ENV PORT=3000

# [字体] 字体生成移至启动脚本：容器启动时由 docker-entrypoint.sh 根据字体目录
# 重新生成 x2t 版与 web 版字体产物。这样既能复用内置字体（未挂载 volume 时，
# /app/assets/fonts 即构建期 COPY 进来的内置字体），也能在挂载外挂字体时自动切换。
# 拷贝启动脚本（负责字体生成 + 服务启动）
COPY scripts/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# 暴露端口
EXPOSE 3000

# 启动：先由入口脚本生成字体产物，再 exec 后端
ENTRYPOINT ["/app/docker-entrypoint.sh"]
