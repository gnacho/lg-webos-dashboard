# Custom home screen — design (shelved)

A plan for replacing LG's home screen with a plain launcher: the inputs and the
apps on the TV, in one scrollable list, in the dashboard's typography, with a
switch back to the stock home.

**Status: investigated on hardware, not built, and shelved.** The display swap
works — our scene can render in place of LG's home — but it could not be made
reliable or predictable on webOS 9, because the home app is managed by system
snapshot machinery too deep to control from where we sit. A home screen we
cannot deterministically show and cleanly revert is not shippable, so the
feature is dropped. The [Outcome](#outcome-why-it-was-shelved) records exactly
what failed; the rest is kept as an accurate account of the mechanism and data
sources, so the finding is not re-discovered from scratch.

## Outcome: why it was shelved

Tested on a C2 (webOS 9.2.2), read-only probes plus reversible swaps, recovering
the set with reboots. Four findings, together disqualifying:

1. **The display swap works — once.** A scene we bind-mounted over
   `com.webos.app.home` rendered full screen as the home. This is what made it
   look promising.
2. **The boot hook runs too late to matter.** The Homebrew Channel's
   `init.d` hook fires at ~26 s into boot; the home app is already running and
   already snapshotted by ~5 s. Mounting our files at that point does not get
   our scene loaded — the running home is the stock one, restored from its
   snapshot.
3. **The snapshot machinery defeats a controlled swap.** The home is a frozen
   CRIU image owned by `sam` (`/usr/sbin/sam`, via `libcriu`), driven by
   `preload-manager.service`, over a deeper `libsnapshot-boot` /
   `snapshot-boot-*` layer. CRIU restores the process by its **original PID**, so
   killing and relaunching brings the frozen scene back rather than reading disk.
   Bind-mounting a preload config with the home removed from the snapshot
   allow-list does not help at runtime, because the daemon already holds the
   stock config in memory.
4. **Even a forced cold start showed the wrong scene.** Restarting
   `preload-manager.service`, clearing the checkpoint and relaunching produced a
   genuinely new process — and it still displayed a *stale scene from an earlier
   test* instead of the file then on disk. The home's state could not be
   deterministically controlled. Only removing every staged file and rebooting
   gave a clean, predictable result — which is fine for recovery but useless as
   a feature.

The boot-time-swap idea (accept a reboot to switch modes, mount before the home
starts) does not rescue it: (2) shows there is no hook point early enough, and
(3)/(4) show the snapshot layer wins even when the mount is in place. Making this
work would mean managing `sam`'s CRIU checkpoints and the `snapshot-boot`
services directly — deep, undocumented, per-firmware system internals, for a
feature that replaces something the owner depends on daily. Not a good trade.

### If it is ever revisited

- A capable path would have to intervene before `sam` snapshots the home
  (< 5 s), or drive the snapshot services to rebuild from our files
  deterministically. Neither was found from a Homebrew-rooted userspace.
- The lesser alternative that avoids the whole problem is a launcher shipped as
  its **own** app the owner opens, not a replacement of the Home key. It is
  reliable because it never touches the snapshot machinery — but it does not
  achieve the goal of replacing the interruptive full-screen home, so it was not
  pursued.

What follows is the mechanism and data-source research, accurate and still
useful if the snapshot obstacle is ever solved.

## Scope

webOS 9 and newer only — the sets whose home screen takes over the whole screen.
webOS 4 (the B8) is deliberately out of scope, and the reason is structural, not
effort:

- On webOS 9 the home screen is a native QML app, `com.webos.app.home`, in its
  own directory. It can be replaced the same way the screen saver is: a bind
  mount of our files over that directory. Verified on a C2 (webOS 9.2.2) — a
  scene we supplied rendered full screen in place of LG's.
- On webOS 4 there is no home app. The card bar is drawn by the compositor
  (`surface-manager-starfish`) itself. There is no directory to mount over;
  replacing it would mean modifying the compositor, which composites the entire
  display, so a mistake takes out all on-screen UI rather than one app. Not
  worth the risk, and the B8's overlay does not interrupt viewing the way the
  full-screen home does.

The dashboard already hides the OLED Care tab on non-OLED sets; the Home tab is
hidden the same way on anything without a replaceable `com.webos.app.home`.

### Which versions — capability, not version number

The feature is gated on what the TV *is*, not on its webOS number. A version
cutoff is both too strict, excluding sets that would work, and too loose,
trusting a number on a set LG may have restructured. Three layers, safest
first:

1. **Capability check.** The home is the native QML app this design handles:
   `com.webos.app.home` present, `appinfo.json` `type: native` with a `home`
   window type, and a `qml/main.qml` to replace. Any of these missing — an
   older webOS 4 set, or a future one that reworked the home — and the feature
   is hidden. This is what keeps an untested newer version safe by default: if
   it changed the structure, it simply is not offered.
2. **Confirmed models.** Sets actually verified (recorded in the code and the
   tested-sets table) get the plain enable.
3. **Capable but unconfirmed** — a newer set that kept the structure but has not
   been tested. Offered, but not made the boot-persistent default until a
   **self-test** passes: a temporary swap with a guaranteed auto-revert that
   confirms our scene renders (compositor capture) before committing. If it does
   not render, the feature refuses and reverts. The dashboard says the model is
   not yet verified and that turning it off never needs the TV, only a browser.

The self-test's auto-revert is the safety floor: the temporary swap schedules
its own revert on the TV, so even if the dashboard or the network drops
mid-test, the set returns to the stock home on its own.


## How the stock home works

Established by reading `/etc/palm/*` and the app's own files on the C2:

- `com.webos.app.home` is a native binary (`/usr/bin/com.webos.app.home`) that
  loads a QML scene from `/usr/palm/applications/com.webos.app.home/qml/main.qml`.
  The binary drives the window; the QML declares signals (`showWindow`,
  `hideWindow`, `activateWindow`, `setWindowProperty` …) that the binary
  connects to and calls. A replacement scene must declare the same signals and
  emit `showWindow()` once loaded, or the window never becomes visible.
- It is listed in `sam-conf-tv.json` under `BootTimeApps` and launched at boot;
  the Home key relaunches it. `bootd.json` names it as `firstAppInHome`.
- **It is snapshotted.** The preload manager (`webos-preload-manager-conf.json`,
  `allowedApps: { "com.webos.app.home": true }`) freezes the running process
  with CRIU into `/tmp/checkpoint/com.webos.app.home` and restores it on the
  next launch. CRIU restores a process **with its original PID**, so killing it
  and relaunching brings back the same PID from the frozen image — the file on
  disk is not re-read. This is the one genuinely awkward part of the mechanism
  and is covered under [Snapshot handling](#snapshot-handling).

## Data sources

Both the app grid and the input list are already available to QML through LG's
own service models, in `/usr/lib/qml/WebOSServices` (provided by
`libwebosserviceplugin.so`). The replacement scene binds to the same live models
LG's home uses, so the list updates itself when an app is installed or removed or
an input is plugged in. No polling, no data layer of our own.

### Apps

`LaunchPointsModel` (QML), backed by
`com.webos.applicationManager/listLaunchPoints`. On the C2 it returned 32
entries. Each carries what a tile needs:

| field | use |
| :--- | :--- |
| `id` | what to launch |
| `title` | the label |
| `icon`, `largeIcon`, `extraLargeIcon` | absolute PNG paths on the TV |
| `iconColor`, `bgColor` | the tile's own colours, for a fallback tile |
| `systemApp`, `removable`, `unmovable` | whether it is a built-in or a user app |

Launch with `com.webos.applicationManager/launch { "id": "<id>" }`.

### Inputs

`com.webos.service.eim/getAllInputStatus` (and the `InputAlertModel`), which
returned HDMI 1–4 on the C2, each with `label` (`HDMI 1`), `appId`
(`com.webos.app.hdmi1`), `connected`, and an `icon`. An input is launched the
same way as an app — its `appId` is a launchable app — so inputs and apps share
one launch path. `connected` lets a disconnected input be dimmed or hidden.

### Current input / running

`RunningModel` and `com.webos.applicationManager/getForegroundAppInfo` give
what is playing now, so the list can mark the current source.

## The swap mechanism

The same approach as the screen saver, which is already in the codebase
(`server/lib/screensavers.js`, the `50-tvweb.sh` boot hook):

1. Stage our home under `/var/lib/tvweb/home/` — `appinfo.json` copied from the
   stock one (kept native so the binary still hosts it), and `qml/main.qml` plus
   assets as ours.
2. `mount --bind /var/lib/tvweb/home /usr/palm/applications/com.webos.app.home`.
3. Handle the snapshot (below), then relaunch home.

Reverting is unmounting, clearing the snapshot, and relaunching — stock home
returns with no file on the read-only system partition ever changed.

### Snapshot handling

The problem: with the stock snapshot in place, relaunching home restores the old
frozen process by its original PID instead of reading our swapped-in files. In
testing this made a naive swap look like it had failed, and clearing it needed a
reboot.

The fix, in order of preference:

1. **Stop home being snapshotted at all.** Bind-mount a copy of
   `webos-preload-manager-conf.json` with `allowedApps: {}` over
   `/etc/palm/webos-preload-manager-conf.json`. `/etc` is a read-only overlay,
   but individual files in it can be bind-mounted over — this is exactly how the
   Homebrew Channel and our own ad blocker replace `/etc/hosts`. With home off
   the allow-list, every launch is a clean cold start that reads our
   `main.qml`. Fully reversible by unmounting.
2. **Clear the stale image on swap.** Whether or not (1) is in place, remove
   `/tmp/checkpoint/com.webos.app.home` when swapping, so no frozen copy of the
   previous scene can be restored. `/tmp` is cleared at boot anyway, so this
   only matters within a session.

(1) + (2) together give a reliable swap without a reboot. This needs verifying
on the hardware before it is relied on — see [Testing](#testing).

### Persistence and boot order

The screen saver's boot hook already re-applies its bind mount after upstart has
run, because `/dev` and the mounts do not survive a restart. The home swap joins
the same hook: on boot, if the feature is on, bind-mount the home directory and
the preload conf before the home app is first launched. The hook runs from
`/var/lib/webosbrew/init.d`, which the Homebrew Channel runs early; the stock
home is a boot-time app, so the mount must be in place first. If the timing
turns out to be too tight, the fallback is to let the stock home start once and
restage on our server's startup, as the screen saver does.

### Revert / safety

- The dashboard's switch calls a `home` control that unmounts both binds, clears
  the checkpoint, and relaunches — stock home back within seconds.
- The boot hook only mounts when a marker file says the feature is on, so a
  power cycle with the feature off always yields the stock home.
- Nothing is written to the read-only system partitions. The worst case — a
  broken `main.qml` — is a home screen that does not draw, recoverable by
  turning the feature off from the dashboard (which does not depend on the home
  screen) or by a reboot with the marker removed.
- A guard before enabling: confirm `com.webos.app.home` exists and is the native
  QML app this design assumes. On anything else the feature stays hidden.

## Tiered plan

### Tier 1 — MVP

The smallest thing that is genuinely usable and safe to switch on and off.

- A single scrollable list: connected inputs first, then apps, from the live
  models.
- Each row: the app's own icon and its title in our typography, on the true
  black background, matching the dashboard's look.
- OK launches; the list keeps focus and the remote's arrows move through it.
- Enable / disable from a new **Home** tab in the dashboard, and the same over
  MQTT as a switch, consistent with the screen saver.
- Snapshot handled per above; boot hook re-applies; revert proven.

Out of scope for Tier 1: reordering, hiding, backgrounds, settings beyond
on/off. It replaces the home with a plain, fast, complete launcher and nothing
more.

### Tier 2 — customisable

- **App visibility.** Hide entries from the list (the LG bloat, say), stored on
  the TV, edited from the dashboard. The list still comes from the live model;
  the hidden set is a filter over it, so installs and removals still flow
  through.
- **Ordering.** A chosen order, with new apps appended, again stored on the TV.
- **Sections.** Optionally separate "Inputs" and "Apps" rather than one run, and
  optionally a favourites row.
- **Appearance.** Dim/bright to match the screen saver, and the light/dark
  theme the dashboard already has.

Visibility and order are per-TV JSON in `/var/lib/tvweb`, edited through the
dashboard the way the ad-block and OLED settings already are — no new storage
model.

### Tier 3 — fuller launcher

Only if wanted, and each item is independently droppable:

- Recents, from `RunningModel` / the launch history.
- A clock and the panel readings the screen saver already gathers, as a header.
- Quick tiles for the dashboard's own common actions (screen off, an input, a
  picture mode).
- Per-app artwork overrides for a consistent grid, since LG's icons vary.

## Risks and open questions

- **Snapshot timing at boot** is the main unknown. If home starts before our
  mount lands, the first home after a cold boot is LG's until a relaunch. The
  restage-on-startup fallback covers it but needs testing.
- **webOS spread.** "webOS 9+" is the tested claim from one C2. Newer sets
  (webOS 22/23/24) very likely keep `com.webos.app.home` as a native QML app,
  but each needs the same one-command check before the feature is offered, and
  the tested-sets table should record which are confirmed.
- **The home key and system overlays.** LG's home integrates with the settings
  panel, notifications and the account menu. The MVP does not, and should not
  pretend to; those keys should still reach LG's own overlays, which are
  separate apps, not part of the home scene. To confirm.
- **QML version.** The C2's home imports QtQuick 2.12; the screen savers already
  target the older QtQuick on the B8, but this feature is webOS 9+ only, so
  2.12 is a safe floor. No B8 constraint applies here.
- **Updates.** A firmware update restores the stock home (it rewrites the system
  partition and the mount is gone), exactly as it restores the stock screen
  saver. The dashboard should say so, once, as it does for the screen saver.

## Testing

Per set, before the feature is offered on it:

1. The stock `com.webos.app.home` is the native QML app (one luna/appinfo check).
2. Swap in, cold start, our scene draws full screen (compositor capture, as in
   this investigation).
3. Launch an app and an input from the list; both foreground correctly.
4. Disable snapshotting via the preload-conf bind; confirm a relaunch reads a
   changed `main.qml` without a reboot.
5. Revert leaves the stock home working, with no leftover mounts or checkpoint.
6. Reboot with the feature on yields our home; reboot with it off yields LG's.

The investigation that produced this design used only read-only probes plus one
reversible swap, and recovered the set with a reboot; the checkpoint behaviour
above is why the reboot was needed and why Tier 1 must prove step 4 first.
