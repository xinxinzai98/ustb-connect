#!/bin/bash
set -euo pipefail
SOURCE_APP=__BKQL_SOURCE_APP__
OWNER_UID=__BKQL_OWNER_UID__
ROOT='/Library/Application Support/BKQL Connect'
PLIST='/Library/LaunchDaemons/local.bkql.campusconnect.plist'
LABEL='local.bkql.campusconnect'

if [[ "$(id -u)" != 0 ]]; then
  printf '此操作只安装 BKQL 自己的系统后台。管理员密码由系统 sudo 接收。\n'
  exec /usr/bin/sudo /bin/bash "$0" --elevated
fi
[[ "$OWNER_UID" =~ ^[1-9][0-9]*$ ]] || { printf '用户身份无效\n'; exit 1; }
[[ "$SOURCE_APP" == *.app && -f "$SOURCE_APP/Contents/MacOS/USTB Connect" ]] || { printf '应用路径无效\n'; exit 1; }
[[ ! -L "$ROOT" ]] || { printf '系统目录为链接，拒绝安装\n'; exit 1; }
/bin/mkdir -p "$ROOT"
/usr/sbin/chown root:wheel "$ROOT"
/bin/chmod 755 "$ROOT"
/bin/launchctl bootout "system/$LABEL" 2>/dev/null || true
if [[ -e "$ROOT/Service.app.previous" ]]; then /bin/rm -rf "$ROOT/Service.app.previous"; fi
if [[ -e "$ROOT/Service.app" ]]; then /bin/mv "$ROOT/Service.app" "$ROOT/Service.app.previous"; fi
/usr/bin/ditto "$SOURCE_APP" "$ROOT/Service.app"
/usr/sbin/chown -R root:wheel "$ROOT/Service.app"
/bin/chmod -R go-w "$ROOT/Service.app"
if [[ ! -f "$ROOT/controller.token" ]]; then /usr/bin/openssl rand -hex 32 > "$ROOT/controller.token"; fi
/usr/sbin/chown "$OWNER_UID" "$ROOT/controller.token"
/bin/chmod 400 "$ROOT/controller.token"
cat > "$ROOT/service.sh" <<'BKQL_SERVICE'
#!/bin/bash
export ELECTRON_RUN_AS_NODE=1
exec '/Library/Application Support/BKQL Connect/Service.app/Contents/MacOS/USTB Connect' '/Library/Application Support/BKQL Connect/Service.app/Contents/Resources/app/src/headless.cjs'
BKQL_SERVICE
/usr/sbin/chown root:wheel "$ROOT/service.sh"
/bin/chmod 700 "$ROOT/service.sh"
cat > "$PLIST" <<'BKQL_PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>local.bkql.campusconnect</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>/Library/Application Support/BKQL Connect/service.sh</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>30</integer>
<key>ProcessType</key><string>Background</string>
<key>Umask</key><integer>63</integer>
<key>StandardErrorPath</key><string>/Library/Application Support/BKQL Connect/service-error.log</string>
</dict></plist>
BKQL_PLIST
/usr/sbin/chown root:wheel "$PLIST"
/bin/chmod 644 "$PLIST"
/bin/launchctl bootstrap system "$PLIST"
OWNER_NAME=$(/usr/bin/id -nu "$OWNER_UID")
OWNER_HOME=$(/usr/bin/dscl . -read "/Users/$OWNER_NAME" NFSHomeDirectory 2>/dev/null | /usr/bin/sed 's/^NFSHomeDirectory: //' || true)
if [[ "$OWNER_HOME" == /* && -d "$OWNER_HOME/Desktop" ]]; then
  /usr/bin/install -m 755 -o "$OWNER_UID" "$ROOT/Service.app/Contents/Resources/app/service/STOP-AUTO-RECONNECT.command" "$OWNER_HOME/Desktop/停止北科自动联网.command"
fi
printf '\nBKQL 系统后台已安装。返回界面连接后台、导入账号并启用监测。\n'
printf '未主动登录校园网，未修改 Wi-Fi、DNS、路由或防火墙。\n'
