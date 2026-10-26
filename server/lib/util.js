/*
 * Small helpers shared by the server's modules.
 * Strict ES5 for Node 0.12.2 on webOS 4.
 */
var fs = require('fs');
var path = require('path');
var os = require('os');

// An integer from config or a request, or dflt when there is none.
function toInt(v, dflt) {
  var n = parseInt(v, 10);
  return isNaN(n) ? dflt : n;
}

// node 0.12 has no { recursive: true }.
function mkdirp(dir) {
  if (fs.existsSync(dir)) return;
  mkdirp(path.dirname(dir));
  try { fs.mkdirSync(dir); } catch (e) {}
}

// A file's text, trimmed, or null when it cannot be read.
function readTrimmed(filePath) {
  try { return fs.readFileSync(filePath, 'utf8').trim(); }
  catch (e) { return null; }
}

function interfaces() {
  try { return os.networkInterfaces() || {}; } catch (e) { return {}; }
}

// Whether an os.networkInterfaces() entry is of IP version 4 or 6: node 0.12
// gives the family as 'IPv4' or 'IPv6', later versions as 4 or 6.
function isFamily(entry, version) {
  var family = String(entry.family);
  return family === 'IPv' + version || family === String(version);
}

// The interface carrying the TV's IPv4 local address, and that address, or null.
function localInterface(ifaces) {
  var best = null;
  for (var name in ifaces) {
    if (!ifaces.hasOwnProperty(name)) continue;
    var list = ifaces[name] || [];
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      if (!isFamily(entry, 4) || entry.internal) continue;
      // Wired first where a TV has both, otherwise the first that answers.
      if (!best || /^eth/.test(name)) best = { name: name, ip4: entry.address };
    }
  }
  return best;
}

// The TV's IPv4 local address, whatever the server is bound to.
function localAddress4() {
  var local = localInterface(interfaces());
  return local ? local.ip4 : null;
}

function splitHextets(text) {
  return text ? text.split(':') : [];
}

/*
 * An IPv6 address as its eight hextets, as numbers, or null when it is not
 * one. A "::" stands for the run of zero hextets the address leaves out.
 */
function ipv6Hextets(address) {
  var withoutZone = String(address).split('%')[0];
  var sides = withoutZone.split('::');
  if (sides.length > 2) return null;

  var written = splitHextets(sides[0]);
  if (sides.length === 2) {
    var after = splitHextets(sides[1]);
    var leftOut = 8 - written.length - after.length;
    if (leftOut < 1) return null;
    for (var i = 0; i < leftOut; i++) written.push('0');
    written = written.concat(after);
  }
  if (written.length !== 8) return null;

  var hextets = [];
  for (var j = 0; j < written.length; j++) {
    if (!/^[0-9a-f]{1,4}$/i.test(written[j])) return null;
    hextets.push(parseInt(written[j], 16));
  }
  return hextets;
}

// fc00::/7: the first seven bits are 1111110.
function isUniqueLocal(hextets) {
  return (hextets[0] & 0xfe00) === 0xfc00;
}

// An EUI-64 interface identifier is a MAC address with ff:fe put in its
// middle. The identifier is the last four hextets, so ff is the low byte of
// the sixth hextet and fe the high byte of the seventh.
function isEui64(hextets) {
  return (hextets[5] & 0xff) === 0xff && (hextets[6] >> 8) === 0xfe;
}

/*
 * The TV's IPv6 local address, a unique local address (fc00::/7) on the
 * interface localAddress4() uses, or null. A global address goes with the
 * ISP's prefix and a link-local one with the link, so neither names the TV.
 * Of two, the EUI-64 one is kept: the other is a temporary address, which
 * rotates.
 */
function localAddress6() {
  var ifaces = interfaces();
  var local = localInterface(ifaces);
  if (!local) return null;
  var list = ifaces[local.name] || [];
  var chosen = null, chosenIsEui64 = false;
  for (var i = 0; i < list.length; i++) {
    var entry = list[i];
    if (!isFamily(entry, 6) || entry.internal) continue;
    var hextets = ipv6Hextets(entry.address);
    if (!hextets || !isUniqueLocal(hextets)) continue;
    var eui64 = isEui64(hextets);
    if (!chosen || (eui64 && !chosenIsEui64)) {
      chosen = entry.address;
      chosenIsEui64 = eui64;
    }
  }
  return chosen;
}

// Milliseconds on CLOCK_MONOTONIC, which a step of the wall clock does not move.
function monotonicMs() {
  var t = process.hrtime();
  return t[0] * 1000 + t[1] / 1e6;
}

// node 0.12 has no Buffer.from or Buffer.alloc.
function toBuffer(data, enc) {
  return typeof Buffer.from === 'function' ? Buffer.from(data, enc) : new Buffer(data, enc);
}

// Buffer#equals arrived in node 0.11.13; webOS 2 runs 0.10.
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function allocBuffer(n) {
  if (typeof Buffer.alloc === 'function') return Buffer.alloc(n);
  var b = new Buffer(n);
  b.fill(0);
  return b;
}

// A file's parsed JSON, or dflt when it is missing or does not parse.
function readJson(filePath, dflt) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (e) { return dflt; }
}

// Written beside the file and renamed over it, so a reader never sees half of
// it. Indented, for a file someone may edit, unless compact. Throws on failure.
function writeJsonAtomic(filePath, obj, mode, compact) {
  var tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, compact ? JSON.stringify(obj) : JSON.stringify(obj, null, 2), 'utf8');
  if (mode !== undefined) fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, filePath);
}

// Removes a file that may not be there.
function unlinkQuiet(filePath) {
  try { fs.unlinkSync(filePath); } catch (e) {}
}

function existsQuiet(filePath) {
  try { return fs.existsSync(filePath); } catch (e) { return false; }
}

/*
 * Listens on host and calls back with the address bound. A dual-stack '::'
 * listener falls back to '0.0.0.0' on a kernel without IPv6, passing the error
 * that caused it.
 */
function listenDualStack(server, port, host, cb) {
  function onError(err) {
    server.removeListener('listening', onListening);
    if (host === '::' && (err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL')) {
      return listenDualStack(server, port, '0.0.0.0', function (e, took) {
        if (e) return cb(e);
        cb(null, took, err);
      });
    }
    cb(err);
  }
  function onListening() {
    server.removeListener('error', onError);
    cb(null, host);
  }
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, host);
}

/*
 * A colour as '#rrggbb' in lower case, from '#rgb' or '#rrggbb' as an
 * appinfo.json gives it, or null for anything else. Android's
 * Color.parseColor takes no three-digit form, so it is spelled out.
 */
function hexColor(v) {
  var m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(typeof v === 'string' ? v.trim() : '');
  if (!m) return null;
  var h = m[1].toLowerCase();
  if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
  return '#' + h;
}

// host:port as a URL writes it, with an IPv6 address in brackets.
function hostPort(host, port) {
  return (String(host).indexOf(':') !== -1 ? '[' + host + ']' : host) + ':' + port;
}

module.exports = {
  toInt: toInt,
  mkdirp: mkdirp,
  readTrimmed: readTrimmed,
  localAddress4: localAddress4,
  localAddress6: localAddress6,
  monotonicMs: monotonicMs,
  toBuffer: toBuffer,
  allocBuffer: allocBuffer,
  sameBytes: sameBytes,
  readJson: readJson,
  writeJsonAtomic: writeJsonAtomic,
  unlinkQuiet: unlinkQuiet,
  existsQuiet: existsQuiet,
  listenDualStack: listenDualStack,
  hostPort: hostPort,
  hexColor: hexColor
};
