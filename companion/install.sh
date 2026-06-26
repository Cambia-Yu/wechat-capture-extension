#!/bin/bash
# 微信文章抓取器 — 一键安装飞书同步服务（后台自启，永久自动）
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER="$SCRIPT_DIR/feishu_sync_server.py"
PLIST="$HOME/Library/LaunchAgents/com.wechat-capture.feishu-sync.plist"
PYTHON=$(which python3 2>/dev/null || echo /usr/bin/python3)

# Prefer the user's local lark-cli. WorkBuddy's bundled copy is a fallback.
LARK_CLI=""
for p in "$HOME/.local/bin/lark-cli" "$HOME/.workbuddy/binaries/node/cli-connector-packages/bin/lark-cli" "$(which lark-cli 2>/dev/null || true)" /usr/local/bin/lark-cli /opt/homebrew/bin/lark-cli; do
    [ -x "$p" ] && { LARK_CLI="$p"; break; }
done

# 探测 node 路径
NODE_DIR=""
for d in "$HOME/.workbuddy/binaries/node/versions"/*/bin "$HOME/.local/bin" /usr/local/bin /opt/homebrew/bin; do
    [ -x "$d/node" ] && { NODE_DIR="$d"; break; }
done

echo "=== 微信文章抓取器 · 飞书同步 ==="
echo "python3: $PYTHON"
echo "node:    ${NODE_DIR}/node"
echo "lark-cli:${LARK_CLI:- not found}"
echo ""

# 清理
lsof -ti :8765 2>/dev/null | xargs kill -9 2>/dev/null || true
launchctl unload "$PLIST" 2>/dev/null || true; sleep 1

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.wechat-capture.feishu-sync</string>
    <key>ProgramArguments</key>
    <array>
        <string>$PYTHON</string>
        <string>$SERVER</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$(dirname "${LARK_CLI:-/usr/local/bin/lark-cli}"):${NODE_DIR}:$(dirname "$PYTHON"):/usr/local/bin:/usr/bin:/bin</string>
        <key>WECHAT_CAPTURE_LARK_CLI</key>
        <string>${LARK_CLI}</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/wechat-capture-feishu-sync.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/wechat-capture-feishu-sync.err</string>
</dict>
</plist>
EOF

launchctl load "$PLIST"; sleep 2

if echo -e "GET /health HTTP/1.0\r\n\r\n" | nc -w 2 127.0.0.1 8765 2>/dev/null | grep -q '"larkCli": true'; then
    echo "✅ 安装成功！服务已后台运行，开机自启。"
else
    echo "⚠️  服务已启动但 lark-cli 未检测到。"
    echo "   错误日志: tail /tmp/wechat-capture-feishu-sync.err"
fi

echo ""
echo "管理: launchctl unload $PLIST  (停止)"
echo "      launchctl load $PLIST    (启动)"
echo "      卸载: unload + rm $PLIST"
