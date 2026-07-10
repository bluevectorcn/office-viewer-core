#!/bin/sh
# ─── 镜像构建脚本 ─────────────────────────────────────────────────────────────
#
# 构建两种类型的 office-viewer-core 镜像：
#
#   1. full      基于 Dockerfile：内置字体，开箱即用，同时支持运行时挂载外挂字体。
#   2. slim      基于 Dockerfile.fonts：不含字体（镜像最小），必须挂载外挂字体使用。
#
# 受限于 x2t 原生二进制为 x86-64 ELF，仅构建 linux/amd64 架构。
#
# 用法:
#   ./scripts/docker-build.sh <full|slim|all> [image[:tag]]
#
# 示例:
#   ./scripts/docker-build.sh full                                # 构建内置字体镜像
#   ./scripts/docker-build.sh slim                                # 构建外挂字体瘦身镜像
#   ./scripts/docker-build.sh all                                 # 构建两种镜像
#   ./scripts/docker-build.sh full office-viewer:latest           # 指定镜像名与 tag
#   ./scripts/docker-build.sh slim ghcr.io/user/ov:v1 slim        # 推送到远端仓库
#
# 可选环境变量:
#   PLATFORM   构建平台，默认 linux/amd64
#   NO_CACHE   设为 1 时使用 --no-cache
#   PUSH       设为 1 时构建完成后推送（需镜像名指向可推送的仓库）
set -eu

# ─── 配置 ─────────────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLATFORM="${PLATFORM:-linux/amd64}"
DEFAULT_TAG="latest"
DEFAULT_IMAGE="office-viewer"

# 构建参数
BUILD_FLAGS="--platform=${PLATFORM}"
if [ "${NO_CACHE:-0}" = "1" ]; then
    BUILD_FLAGS="${BUILD_FLAGS} --no-cache"
fi
if [ "${PUSH:-0}" = "1" ]; then
    BUILD_FLAGS="${BUILD_FLAGS} --push"
fi

# ─── 函数 ─────────────────────────────────────────────────────────────────────
usage() {
    cat <<EOF
用法: $0 <full|slim|all> [image[:tag]]

类型:
  full   内置字体镜像 (Dockerfile)        —— 开箱即用 + 兼容外挂字体
  slim   外挂字体瘦身镜像 (Dockerfile.fonts) —— 必须挂载字体使用，镜像最小
  all    构建上述两种

示例:
  $0 full
  $0 slim
  $0 all
  $0 full office-viewer:latest
  $0 slim ghcr.io/user/ov:v1

环境变量:
  PLATFORM  构建平台，默认 linux/amd64（x2t 仅支持 amd64）
  NO_CACHE  设为 1 时禁用缓存
  PUSH      设为 1 时推送镜像
EOF
    exit 1
}

resolve_image() {
    # $1 = 类型 (full/slim)，$2 = 可选的 image[:tag]
    local_type="$1"
    shift
    if [ "$#" -ge 1 ]; then
        echo "$1"
    else
        # 未指定镜像名时，按类型附加后缀以区分：slim 类型用 :slim tag
        case "${local_type}" in
            slim) echo "${DEFAULT_IMAGE}:${SLIM_TAG}" ;;
            *)    echo "${DEFAULT_IMAGE}:${DEFAULT_TAG}" ;;
        esac
    fi
}

build_full() {
    target_image=$(resolve_image full "$@")
    echo "┌─ 构建 full 镜像（内置字体）"
    echo "│  Dockerfile : Dockerfile"
    echo "│  镜像       : ${target_image}"
    echo "│  平台       : ${PLATFORM}"
    echo "└──────────────────────────────────────────"
    docker build ${BUILD_FLAGS} \
        -f "${REPO_ROOT}/Dockerfile" \
        -t "${target_image}" \
        "${REPO_ROOT}"
    echo "✓ full 镜像构建完成: ${target_image}"
}

build_slim() {
    target_image=$(resolve_image slim "$@")
    echo "┌─ 构建 slim 镜像（外挂字体，镜像最小）"
    echo "│  Dockerfile : Dockerfile.fonts"
    echo "│  镜像       : ${target_image}"
    echo "│  平台       : ${PLATFORM}"
    echo "└──────────────────────────────────────────"
    docker build ${BUILD_FLAGS} \
        -f "${REPO_ROOT}/Dockerfile.fonts" \
        -t "${target_image}" \
        "${REPO_ROOT}"
    echo "✓ slim 镜像构建完成: ${target_image}"
}

# ─── 主流程 ───────────────────────────────────────────────────────────────────
SLIM_TAG="slim"

BUILD_TYPE="${1:-}"
if [ -z "${BUILD_TYPE}" ]; then
    usage
fi
shift || true

case "${BUILD_TYPE}" in
    full)
        build_full "$@"
        ;;
    slim)
        build_slim "$@"
        ;;
    all)
        build_full "$@"
        build_slim "$@"
        ;;
    -h|--help|help)
        usage
        ;;
    *)
        echo "错误: 未知类型 '${BUILD_TYPE}'"
        echo
        usage
        ;;
esac
