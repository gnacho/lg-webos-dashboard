#!/bin/sh
# Put the server this app carries in place, or bring it up to date, and make
# sure it is running. Run as root by the app's own launch page, through the
# Homebrew Channel's exec service, whenever the server does not answer with the
# version the app was built with. Safe to run any number of times.
#
# Does what deploy.sh does on the TV, from files that arrived inside the app
# rather than over SSH. Installs made either way share /var/lib/tvweb, so one
# made with deploy.sh is upgraded in place, config and all.
#
# Prints one JSON line last, which the launch page reads.

HERE=$(cd "$(dirname "$0")" && pwd)
SRC="$HERE/server"
D=/var/lib/tvweb
HOOKDIR=/var/lib/webosbrew/init.d

version_of() { sed -n "s/^var TVWEB_VERSION = '\([^']*\)';.*/\1/p" "$1" 2>/dev/null; }
running() { [ -x "$D/tvwebctl" ] && "$D/tvwebctl" status 2>/dev/null | grep -q '^running'; }
web_off() {
  [ -f "$D/config.json" ] && tr -d ' \t\r\n' < "$D/config.json" | grep -q '"web":{[^}]*"enabled":false'
}
result() {   # action, then whether the dashboard is switched off
  off=false; web_off && off=true
  printf '{"ok":true,"action":"%s","version":"%s","webOff":%s}\n' "$1" "$(version_of "$D/tvweb.js")" "$off"
}
fail() { printf '{"ok":false,"error":"%s"}\n' "$1"; exit 0; }

[ -f "$SRC/tvweb.js" ] || fail "the app has no server files in it"
want=$(version_of "$SRC/tvweb.js")
have=$(version_of "$D/tvweb.js")

# Already this version: only make sure it is up. At a cold boot the launch page
# can get here before the boot hook has started the server.
if [ -n "$have" ] && [ "$have" = "$want" ]; then
  running || "$D/tvwebctl" start >/dev/null 2>&1
  result started
  exit 0
fi

# Copied beside the install and renamed into place, never written over: BusyBox's
# shell reads a script as it runs it, so overwriting tvwebctl would corrupt the
# watchdog running out of it.
mkdir -p "$D" || fail "could not create $D"
S="$D/.hbc-stage"
rm -rf "$S"
cp -r "$SRC" "$S" || fail "could not copy the server files"
( cd "$S" && find . -type f ) | while read -r f; do
  case "$f" in ./50-tvweb.sh) continue ;; esac
  mkdir -p "$D/$(dirname "$f")"
  mv -f "$S/$f" "$D/$f"
done
chmod +x "$D/tvwebctl" 2>/dev/null
chmod 600 "$D/config.json" 2>/dev/null

# run-parts skips names containing a dot, so the copy in progress never runs.
mkdir -p "$HOOKDIR"
cp "$S/50-tvweb.sh" "$HOOKDIR/.50-tvweb.new" &&
  chmod +x "$HOOKDIR/.50-tvweb.new" &&
  mv -f "$HOOKDIR/.50-tvweb.new" "$HOOKDIR/50-tvweb"
rm -rf "$S"

# Installed by this app rather than deploy.sh, which decides where updates come
# from: the Homebrew Channel, not the server's own updater.
: > "$D/.from-homebrew-channel"

[ "$(version_of "$D/tvweb.js")" = "$want" ] || fail "the new files did not take"
"$D/tvwebctl" restart >/dev/null 2>&1
if [ -n "$have" ]; then result upgraded; else result installed; fi
