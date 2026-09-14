#!/bin/sh
#
# Read-only survey of the privacy and update surface on a rooted LG webOS TV.
#
# Answers the questions the dashboard cannot answer from one set: which update
# controls this firmware exposes, whether the screen is being sampled to a file,
# whether voice is transcribed to disk, and what is stacked over /etc/hosts.
#
# Writes nothing and changes nothing. Safe to run on a set in daily use.
#
# Identifiers are deliberately withheld: the advertising ID, the contents of the
# voice log and the TV's own addresses never appear in the output, so the result
# can be pasted into an issue as it stands.
#
#   scp scripts/privacy-probe.sh root@<tv>:/tmp/ && ssh root@<tv> sh /tmp/privacy-probe.sh
#
# Over the Homebrew Channel's telnet instead, paste the file in and run it.

LUNA=/usr/bin/luna-send

sec() { echo; echo "== $1 =="; }
row() { echo "  $1"; }

# Print indented lines, or a stand-in when there are none. Needed because the
# exit status of `grep | sed` is sed's, so the empty case cannot be tested for
# after the fact.
lines() {
  if [ -n "$1" ]; then
    echo "$1" | sed 's/^/    /'
  else
    row "    ${2:-none}"
  fi
}

# Luna answers are one long line; -w bounds a stalled bus the way tvweb does.
ask() {
  [ -x "$LUNA" ] || { row "$1 -> no luna-send"; return; }
  out=$("$LUNA" -n 1 -w 2000 -f "luna://$1" "${2:-\{\}}" 2>&1 | tr -d '\n' | cut -c1-400)
  row "$1 -> ${out:-(no answer)}"
}

# Mode, size and mtime, or a plain absent. stat is BusyBox here, so -c works but
# the GNU long options do not.
look() {
  if [ -e "$1" ]; then
    row "$1 -> $(stat -c '%a %s bytes, mtime %y' "$1" 2>/dev/null || ls -l "$1")"
  else
    row "$1 -> absent"
  fi
}

echo "privacy-probe $(date 2>/dev/null)"

sec "Set"
row "model:    $(cat /var/run/nyx/device_info.json 2>/dev/null | tr ',' '\n' | grep -i device_name | cut -d'"' -f4)"
row "firmware: $(grep -i webos_release /var/run/nyx/os_info.json 2>/dev/null | cut -d'"' -f4)"
row "kernel:   $(uname -r)"

# ---------------------------------------------------------------- updates
sec "Update surface"

# The Homebrew Channel's own switch. The flag is read at boot by its startup
# script, which bind-mounts a hosts table blackholing LG's update servers - so
# the flag being set and the block being live are two different questions.
look /var/luna/preferences/webosbrew_block_updates
ask org.webosbrew.hbchannel.service/getConfiguration

row "update hosts live in /etc/hosts: $(grep -c -E 'su\.lge\.com|snu\.lge\.com|su-ssl\.lge\.com|su-dev\.lge\.com' /etc/hosts 2>/dev/null) line(s)"

# Which update services this firmware registers. Enumerated from the bus rather
# than guessed at: the daemon is named differently across webOS generations.
row "update services on the bus:"
svc=""
for d in /usr/share/luna-service2/services /usr/share/luna-service2/roles \
         /var/palm/ls2/services /usr/palm/services; do
  [ -d "$d" ] || continue
  svc="$svc$(ls "$d" 2>/dev/null | grep -i -E 'update|swupdate|fota|upgrade')
"
done
lines "$(echo "$svc" | grep -v '^$')"

ask com.webos.service.update/getStatus
ask com.webos.service.swupdater/getStatus
ask com.webos.service.update/getCurrentStatus

# The TV's own "Allow Automatic Updates". The key name is what this is looking
# for: it is not published, and the category differs between firmwares.
row "settings keys mentioning update:"
for c in option general network; do
  o=$("$LUNA" -n 1 -w 2000 -f "luna://com.webos.settingsservice/getSystemSettings" \
      "{\"category\":\"$c\"}" 2>/dev/null | tr ',' '\n' | grep -i update | head -8)
  [ -n "$o" ] && echo "$o" | sed "s/^/    [$c] /"
done
ls /var/luna/preferences 2>/dev/null | grep -i -E 'update|fota' | sed 's/^/    pref: /'

# ---------------------------------------------------------------- capture
sec "Screen capture"

# Reported on webOS 10.3.1 as a 640x360 RGB24 frame rewritten every ~3s by
# com.webos.service.oledepl. 691200 bytes is that geometry exactly.
look /tmp/capture.rgb
if [ -e /tmp/capture.rgb ]; then
  a=$(stat -c '%Y %s' /tmp/capture.rgb 2>/dev/null)
  sleep 5
  b=$(stat -c '%Y %s' /tmp/capture.rgb 2>/dev/null)
  if [ "$a" = "$b" ]; then
    row "unchanged over 5s -> written on demand, or not being written now"
  else
    row "changed over 5s -> the screen is being sampled continuously"
  fi
  row "readable by others: $(stat -c '%a' /tmp/capture.rgb 2>/dev/null)"
fi

look /usr/bin/vtCaptureTestSuite
ask com.webos.service.capture/getStatus
row "other capture files under /tmp:"
lines "$(find /tmp -maxdepth 2 \( -name '*.rgb' -o -name '*capture*' \) 2>/dev/null | head -10)"

# ---------------------------------------------------------------- voice
sec "Voice"

# The audio is not expected on disk. The transcripts are: voiceconductor writes
# user_utterance and NL_* lines in plaintext. Counted, never printed - the
# contents are whatever the household said in front of the set.
for f in /tmp/app.voice.log /tmp/var/log/messages /var/log/messages; do
  look "$f"
  if [ -r "$f" ]; then
    row "  utterance lines: $(grep -c -E 'user_utterance|NL_TEXT|NL_INTENT' "$f" 2>/dev/null)"
  fi
done

row "voice binaries:"
for b in /usr/sbin/voiceinput_hidraw /usr/sbin/voiceinput /usr/sbin/voiceconductor; do
  [ -e "$b" ] && row "    $b present" || row "    $b absent"
done
row "voice processes: $(ps -eo args 2>/dev/null | grep -c '[v]oice')"

# The Magic Remote's microphone is a raw HID stream, not an ALSA device, so both
# paths have to be looked at separately.
row "hidraw devices:"
for h in /dev/hidraw*; do
  [ -e "$h" ] || continue
  n=$(cat "/sys/class/hidraw/$(basename "$h")/device/uevent" 2>/dev/null | grep HID_NAME | cut -d= -f2)
  row "    $h ${n:-(unnamed)}"
done
row "ALSA capture devices:"
lines "$(grep -i capture /proc/asound/pcm 2>/dev/null)"

# ---------------------------------------------------------------- telemetry
sec "Collection services"

# The four the dashboard already names, plus the ones reported on newer webOS
# that it does not. Presence here is what decides whether they are worth adding.
for p in acr acr2 admanager uploadd rdxd contentminer objectdetection adoverlay; do
  c=$(ps -eo args 2>/dev/null | grep -c "[/]$p")
  row "$p: $([ "$c" -gt 0 ] && echo running || echo 'not running')"
done

row "upstart jobs:"
lines "$(/sbin/initctl list 2>/dev/null | grep -i -E 'acr|upload|rdx|ad|update|voice')" \
      "initctl lists nothing (expected on webOS 9+)"

# Where the diagnostics daemons stage reports before sending them. A pending
# count is the closest thing to "has anything been submitted to LG".
row "diagnostics spools:"
for d in /var/spool/rdxd /var/log/reports /mnt/lg/cmn_data/rdxd /var/lib/rdxd /tmp/rdxd; do
  [ -d "$d" ] && row "    $d -> $(ls -1 "$d" 2>/dev/null | wc -l) entries" || row "    $d absent"
done

# ---------------------------------------------------------------- hosts
sec "Hosts table"

# Both this project and the Homebrew Channel bind-mount over /etc/hosts. Only
# the topmost table is in effect, so the stack is the answer, not the file.
row "mounts over /etc/hosts:"
lines "$(grep ' /etc/hosts ' /proc/mounts 2>/dev/null)"
row "sinkholed entries: $(grep -c -E '^(0\.0\.0\.0|127\.0\.0\.1)' /etc/hosts 2>/dev/null) IPv4, $(grep -c -E '^(::1|::)' /etc/hosts 2>/dev/null) IPv6"

# An IPv4-only sinkhole is bypassed whenever the resolver asks for an AAAA
# record, so whether the set answers a blocked name over IPv6 is the test.
if command -v getent >/dev/null 2>&1; then
  row "getent ad.lgsmartad.com: $(getent hosts ad.lgsmartad.com 2>/dev/null | tr '\n' ' ' | cut -c1-120)"
  row "getent su.lge.com:       $(getent hosts su.lge.com 2>/dev/null | tr '\n' ' ' | cut -c1-120)"
fi

echo
echo "done. Nothing was changed."
