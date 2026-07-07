# Stage 1: Build the Go binary
FROM --platform=linux/amd64 golang:1.20-bookworm AS builder

# 安装 magic 开发库以编译后端 CGO
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# 从构建上下文的 server-go 目录拷贝依赖和源码
COPY server-go/go.mod server-go/go.sum ./
RUN go mod download

COPY server-go/main.go ./
RUN CGO_ENABLED=1 GOOS=linux GOARCH=amd64 go build -o office-viewer-backend main.go

# Stage 2: Final runtime environment
# 使用 debian:bookworm-slim，其内置的 GLIBC 2.36 能够完美满足 x2t 下所有 so 所链接的 GLIBC 2.34+ 需求
FROM --platform=linux/amd64 debian:bookworm-slim

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
COPY --from=builder /build/office-viewer-backend /app/office-viewer-backend

# 拷贝 x2t 工具链到 /app/bin (包含 bin 下原有的所有 so 库，包含 DoctRenderer.config 与 xregexp-all-min.js)
COPY server-go/x2t/ /app/bin/

# 拷贝外挂物理字体到 /app/assets/fonts/
COPY fonts/ /app/assets/fonts/

# 拷贝 sdkjs 到 /app/sdkjs/ 目录，以供 DoctRenderer.config 正常引用
COPY vendor/onlyoffice/sdkjs/ /app/sdkjs/

# 设置动态链接库路径，使 x2t 可以找到同目录下的 .so 依赖库
ENV LD_LIBRARY_PATH=/app/bin:$LD_LIBRARY_PATH
ENV X2T_PATH=/app/bin/x2t
ENV TEMP_DIR=/app/temp
ENV PORT=3000

# 暴露端口
EXPOSE 3000

# 启动服务
CMD ["/app/office-viewer-backend"]
