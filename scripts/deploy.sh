#!/usr/bin/env bash
#
# 把静态站点同步到服务器，并在服务器本机做一次自检。
#
# 用法：
#   SERVER=1.2.3.4 SSH_USER=ubuntu SSH_KEY=~/.ssh/deploy.pem ./scripts/deploy.sh
#
# 可选环境变量：
#   APP_DIR    服务器上的目标目录，默认 /var/www/game-of-chaos
#   URL_PATH   站点对外路径前缀，默认 chaos（仅用于自检地址）
#
# 这个脚本只负责传文件。Caddy 的反向代理/静态站点配置不在这里改，
# 需要的片段见 README 的「部署」一节，改完自己 validate + reload。
set -euo pipefail

SERVER=${SERVER:?需要 SERVER，例如 SERVER=1.2.3.4}
SSH_USER=${SSH_USER:-ubuntu}
SSH_KEY=${SSH_KEY:-$HOME/.ssh/id_ed25519}
APP_DIR=${APP_DIR:-/var/www/game-of-chaos}
URL_PATH=${URL_PATH:-chaos}

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TARBALL=$(mktemp -t game-of-chaos-XXXXXX.tar.gz)
trap 'rm -f "$TARBALL"' EXIT

echo "==> 打包 $ROOT"
tar -czf "$TARBALL" \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=_probe.html \
  -C "$ROOT" .

echo "==> 上传到 $SSH_USER@$SERVER"
scp -q -i "$SSH_KEY" "$TARBALL" "$SSH_USER@$SERVER:/tmp/game-of-chaos.tar.gz"

echo "==> 解包到 $APP_DIR"
ssh -i "$SSH_KEY" "$SSH_USER@$SERVER" "APP_DIR='$APP_DIR' bash -s" <<'REMOTE'
set -euo pipefail
sudo mkdir -p "$APP_DIR"
sudo tar -xzf /tmp/game-of-chaos.tar.gz -C "$APP_DIR" --strip-components=1
sudo chown -R root:root "$APP_DIR"
sudo chmod -R a+rX "$APP_DIR"
rm -f /tmp/game-of-chaos.tar.gz
echo "文件数: $(find "$APP_DIR" -type f | wc -l)"
REMOTE

echo "==> 服务器本机自检"
ssh -i "$SSH_KEY" "$SSH_USER@$SERVER" "URL_PATH='$URL_PATH' bash -s" <<'REMOTE'
set -uo pipefail
echo -n "/$URL_PATH/       => "; curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1/$URL_PATH/"
echo -n "/$URL_PATH/js/app.js => "; curl -s -o /dev/null -w '%{http_code} %{content_type}\n' "http://127.0.0.1/$URL_PATH/js/app.js"
if ! sudo grep -q "game-of-chaos" /etc/caddy/Caddyfile; then
  echo "提醒：/etc/caddy/Caddyfile 里还没有 game-of-chaos 的站点片段，见 README 的「部署」一节。"
fi
REMOTE

echo "==> 完成"
