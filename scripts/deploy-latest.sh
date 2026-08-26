#!/usr/bin/env bash

set -Eeuo pipefail

readonly repository="Riordon666/buliangren-fortress-board"
readonly release_tag="deploy-latest"
readonly archive_name="buliangren-linux-x64.tar.gz"
readonly checksum_name="${archive_name}.sha256"
readonly expected_node_version="v24.13.0"
readonly expected_architecture="x86_64"

source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
runtime_dir="$(readlink -m "${RUNTIME_DIR:-/www/wwwroot/buliangren-runtime}")"
runtime_parent="$(dirname "$runtime_dir")"
staging_dir="${runtime_dir}.next"
previous_dir="${runtime_dir}.previous"
deploy_port="${DEPLOY_PORT:-3001}"
deploy_owner="${DEPLOY_OWNER:-www:www}"
release_base="https://github.com/${repository}/releases/download/${release_tag}"

die() {
  printf '部署失败：%s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"
}

read_marker() {
  tr -d '\r\n' < "$1"
}

for command_name in curl tar sha256sum git node uname mktemp readlink cp mv chown mkdir rm tr grep; do
  require_command "$command_name"
done

case "$runtime_dir" in
  /www/wwwroot/*) ;;
  *) die "运行目录必须位于 /www/wwwroot 的专用子目录内：$runtime_dir" ;;
esac

case "$runtime_dir" in
  /www/wwwroot/buliangren-fortress-board|/www/wwwroot/buliangren-fortress-board/*)
    die "运行目录不能覆盖源码或持久化数据目录：$runtime_dir"
    ;;
esac

[[ ! -L "$runtime_dir" ]] || die "运行目录不能是符号链接：$runtime_dir"
[[ "$staging_dir" == /www/wwwroot/* && "$previous_dir" == /www/wwwroot/* ]] || die "临时目录校验失败"
[[ -f "$runtime_dir/.env.production" ]] || die "缺少 $runtime_dir/.env.production，请先保留数据库与上传目录配置"

if command -v ss >/dev/null 2>&1 && ss -ltnH "sport = :$deploy_port" | grep -q .; then
  die "端口 $deploy_port 仍在监听，请先在宝塔停止 Node 项目"
fi

server_node_version="$(node --version)"
server_architecture="$(uname -m)"
[[ "$server_node_version" == "$expected_node_version" ]] || die "服务器 Node 为 $server_node_version，需要 $expected_node_version"
[[ "$server_architecture" == "$expected_architecture" ]] || die "服务器架构为 $server_architecture，需要 $expected_architecture"

expected_commit="$(git -C "$source_root" rev-parse HEAD)"
temp_dir="$(mktemp -d)"
trap 'rm -rf -- "$temp_dir"' EXIT

download_file() {
  local label="$1"
  local source_url="$2"
  local destination="$3"

  printf '\n%s\n' "$label"
  curl --fail --location --show-error --progress-bar \
    --connect-timeout 20 --max-time 600 --retry 2 --retry-delay 2 \
    --write-out $'\n下载完成：%{size_download} 字节，用时 %{time_total} 秒\n' \
    --output "$destination" "$source_url"
}

printf '开始下载 GitHub Linux 成品包。单次最长等待 10 分钟，失败会自动重试 2 次。\n'
download_file '【1/2】主程序包（约 24 MB）' \
  "$release_base/$archive_name" "$temp_dir/$archive_name"
download_file '【2/2】SHA256 校验文件' \
  "$release_base/$checksum_name" "$temp_dir/$checksum_name"

(
  cd "$temp_dir"
  sha256sum --check "$checksum_name"
)

if tar -tzf "$temp_dir/$archive_name" | grep -Eq '(^|/)\.\.(/|$)|^/'; then
  die "压缩包包含不安全路径"
fi

package_dir="$temp_dir/package"
mkdir -p "$package_dir"
tar -xzf "$temp_dir/$archive_name" -C "$package_dir" --no-same-owner

for required_path in server.js node_modules .next/BUILD_ID .next/server .next/static public BUILD_COMMIT NODE_VERSION BUILD_ARCH; do
  [[ -e "$package_dir/$required_path" ]] || die "成品包缺少：$required_path"
done

package_commit="$(read_marker "$package_dir/BUILD_COMMIT")"
package_node_version="$(read_marker "$package_dir/NODE_VERSION")"
package_architecture="$(read_marker "$package_dir/BUILD_ARCH")"

[[ "$package_commit" == "$expected_commit" ]] || die "Release 尚未更新到当前提交。当前源码 $expected_commit，成品 $package_commit，请稍后重试"
[[ "$package_node_version" == "$expected_node_version" ]] || die "成品 Node 为 $package_node_version，需要 $expected_node_version"
[[ "$package_architecture" == "$expected_architecture" ]] || die "成品架构为 $package_architecture，需要 $expected_architecture"

mkdir -p "$runtime_parent"
rm -rf -- "$staging_dir"
cp -a "$package_dir" "$staging_dir"
cp -a "$runtime_dir/.env.production" "$staging_dir/.env.production"
chown -R "$deploy_owner" "$staging_dir"

rm -rf -- "$previous_dir"
if [[ -d "$runtime_dir" ]]; then
  mv "$runtime_dir" "$previous_dir"
fi

if ! mv "$staging_dir" "$runtime_dir"; then
  if [[ -d "$previous_dir" && ! -e "$runtime_dir" ]]; then
    mv "$previous_dir" "$runtime_dir"
  fi
  die "替换运行目录失败，已尝试恢复上一版本"
fi

printf '\n部署完成。\n'
printf '提交：%s\n' "$package_commit"
printf 'Node：%s\n' "$package_node_version"
printf '架构：%s\n' "$package_architecture"
printf '运行目录：%s\n' "$runtime_dir"
printf '上一版本：%s\n' "$previous_dir"
printf '请回到宝塔启动 Node 项目。\n'
