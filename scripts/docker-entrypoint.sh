#!/bin/sh
###
 # @Author: zhuzhigang zzhigang@airedgesoft.com
 # @Date: 2026-07-10 10:17:07
 # @LastEditors: zhuzhigang zzhigang@airedgesoft.com
 # @LastEditTime: 2026-07-10 10:45:52
 # @FilePath: /office-viewer-core/scripts/docker-entrypoint.sh
 # @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
### 
# ─── 外挂字体版容器启动脚本 ──────────────────────────────────────────────────
#
# 该镜像不内置任何字体。容器启动时根据外挂字体目录运行 allfontsgen，
# 直接把字体产物生成到各目标目录，随后启动 Go 后端服务。
#
# 服务端路径依据：
#   - 物理字体目录 assets/fonts  （main.go 中 fontDir，亦即 x2t 运行时读取字体处）
#   - ./AllFonts.js、font_selection.bin 位于 x2t 二进制同目录
#     （DoctRenderer.config 中 <allfonts>./AllFonts.js</allfonts>，相对 /app/bin）
#
# 运行示例：
#   docker run -p 3000:3000 -v $(pwd)/fonts:/app/assets/fonts <image>
#
# 字体目录同时作为 allfontsgen 的输入与 x2t 运行时读取物理字体的目录，无需拷贝。
set -eu

# ─── 配置 ─────────────────────────────────────────────────────────────────────
# 物理字体目录：allfontsgen 的输入，同时是 x2t 运行时读取字体的目录。
# 注意：main.go 中 x2t 字体路径硬编码为 assets/fonts（即 /app/assets/fonts），
# 所以此路径不可随意更改，仅在变量未设置时用于兜底默认值。外挂字体通过 volume 挂载到该路径：
#   docker run -v $(pwd)/fonts:/app/assets/fonts <image>
FONTS_DIR="${FONTS_DIR:-/app/assets/fonts}"

# 服务端目录（x2t 二进制与同目录的 AllFonts.js / font_selection.bin）
X2T_BIN_DIR="${X2T_BIN_DIR:-/app/bin}"

# Web 端目录
WEB_VENDOR_DIR="${WEB_VENDOR_DIR:-/app/dist/vendor/onlyoffice}"
WEB_COMMON_DIR="${WEB_COMMON_DIR:-${WEB_VENDOR_DIR}/sdkjs/common}"

echo "[entrypoint] FONTS_DIR=${FONTS_DIR}"

# ─── 字体生成 ─────────────────────────────────────────────────────────────────
# allfontsgen 各输出参数直接指向最终目标目录，生成后无需拷贝：
#   --allfonts       : x2t 原生版 AllFonts.js     -> ${X2T_BIN_DIR}/AllFonts.js
#   --allfonts-web   : web 版 AllFonts.js          -> ${WEB_COMMON_DIR}/AllFonts.js
#   --selection      : font_selection.bin（共用）  -> ${X2T_BIN_DIR}/font_selection.bin
#   --output-web     : web 字体分片目录            -> ${WEB_VENDOR_DIR}/fonts
#   --images         : 字体缩略图                  -> ${WEB_COMMON_DIR}/Images

if [ ! -d "${FONTS_DIR}" ] || [ -z "$(ls -A "${FONTS_DIR}" 2>/dev/null)" ]; then
    echo "[entrypoint] 警告: 字体目录 ${FONTS_DIR} 为空或不存在，跳过字体生成。"
    echo "[entrypoint] 请通过 -v <宿主机字体目录>:${FONTS_DIR} 挂载字体后再使用转换/预览功能。"
else
    # 确保目标目录存在；清理旧的 web 字体目录避免残留旧字体分片
    mkdir -p "${WEB_COMMON_DIR}/Images"
    mkdir -p "${WEB_VENDOR_DIR}/fonts"
    rm -rf "${WEB_VENDOR_DIR}/fonts/*"
    rm -f "${WEB_COMMON_DIR}/AllFonts.js.br"
    rm -f "${WEB_COMMON_DIR}/Images/fonts_thumbnail*"
    
    echo "[entrypoint] 开始生成字体产物（直接写入目标目录）..."
    "${X2T_BIN_DIR}/allfontsgen" \
        --use-system=false \
        --input="${FONTS_DIR}" \
        --allfonts="${X2T_BIN_DIR}/AllFonts.js" \
        --allfonts-web="${WEB_COMMON_DIR}/AllFonts.js" \
        --selection="${X2T_BIN_DIR}/font_selection.bin" \
        --output-web="${WEB_VENDOR_DIR}/fonts" \
        --images="${WEB_COMMON_DIR}/Images"

    echo "[entrypoint] 字体产物生成完成。"
fi

# ─── 启动服务 ─────────────────────────────────────────────────────────────────
echo "[entrypoint] 启动 office-viewer-backend ..."
exec /app/office-viewer-backend
