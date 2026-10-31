#!/usr/bin/env bash
# リッチメニューを作成し、全ユーザーのデフォルトに設定する。
# 使い方: CHANNEL_TOKEN=xxxx LIFF_ID=2000000000-xxxxxxxx ./setup.sh
# 注意: 既存のデフォルトリッチメニューがあれば置き換わる。
set -euo pipefail
cd "$(dirname "$0")"
: "${CHANNEL_TOKEN:?CHANNEL_TOKEN を指定してください}"
: "${LIFF_ID:?LIFF_ID を指定してください}"
API=https://api.line.me/v2/bot
AUTH="Authorization: Bearer ${CHANNEL_TOKEN}"

if [ ! -f menu.png ]; then
  CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=2500,843 \
    --screenshot="$PWD/menu.png" "file://$PWD/menu.html" >/dev/null 2>&1
fi

echo "現在のデフォルト:"; curl -s -H "$AUTH" "$API/user/all/richmenu" ; echo

BODY=$(cat <<EOF
{
  "size": {"width": 2500, "height": 843},
  "selected": true,
  "name": "hijoshoku-menu",
  "chatBarText": "非常食の登録・消費",
  "areas": [
    {"bounds": {"x": 0, "y": 0, "width": 1250, "height": 843},
     "action": {"type": "uri", "label": "購入", "uri": "https://liff.line.me/${LIFF_ID}?mode=buy"}},
    {"bounds": {"x": 1250, "y": 0, "width": 1250, "height": 843},
     "action": {"type": "uri", "label": "消費", "uri": "https://liff.line.me/${LIFF_ID}?mode=use"}}
  ]
}
EOF
)
ID=$(curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" -d "$BODY" "$API/richmenu" | python3 -c 'import sys,json;print(json.load(sys.stdin)["richMenuId"])')
echo "created: $ID"
curl -s -X POST -H "$AUTH" -H "Content-Type: image/png" --data-binary @menu.png \
  "https://api-data.line.me/v2/bot/richmenu/$ID/content" >/dev/null
curl -s -X POST -H "$AUTH" "$API/user/all/richmenu/$ID" >/dev/null
echo "デフォルトに設定しました: $ID"
