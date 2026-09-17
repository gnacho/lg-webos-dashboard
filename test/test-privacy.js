/**
 * test/test-privacy.js - Unit tests for the ad blocker's hosts table
 */

var assert = require('assert');
var mockEnv = require('./mocks/mock-env').createMockEnv();
mockEnv.install();

var privacy = require('../server/lib/privacy');

var tests = [];
function test(name, fn) { tests.push([name, fn]); }

var HBC_FLAG = '/var/luna/preferences/webosbrew_block_updates';
var UPDATE_HOSTS = ['snu.lge.com', 'su-dev.lge.com', 'su.lge.com', 'su-ssl.lge.com'];

function sinkholed(table, host) {
  return table.indexOf('0.0.0.0\t' + host) !== -1 && table.indexOf('::\t' + host) !== -1;
}

test('every blocked host is answered on both families', function () {
  ['ads', 'full'].forEach(function (mode) {
    var table = privacy.adBlockHostsTable(mode);
    var hosts = mode === 'full' ? privacy.ADBLOCK_DOMAINS : privacy.ADBLOCK_ADS;
    hosts.forEach(function (host) {
      assert.ok(sinkholed(table, host), mode + ': ' + host + ' is missing an IPv4 or IPv6 line');
    });
  });
});

test('the table still carries the marker the mount is detected by', function () {
  assert.ok(privacy.adBlockHostsTable('ads').indexOf('lg-webos-mqtt') !== -1);
});

test('localhost keeps its own entries', function () {
  var table = privacy.adBlockHostsTable('ads');
  assert.ok(table.indexOf('127.0.0.1\tlocalhost.localdomain\tlocalhost') !== -1);
  assert.ok(table.indexOf('::1\tlocalhost ip6-localhost ip6-loopback') !== -1);
});

test("LG's update servers are left out when the Homebrew flag is not set", function () {
  var table = privacy.adBlockHostsTable('full');
  UPDATE_HOSTS.forEach(function (host) {
    assert.ok(table.indexOf(host) === -1, host + ' should not be blocked unasked');
  });
});

test("they are carried over when it is, so this table does not undo it", function () {
  mockEnv.files[HBC_FLAG] = '';
  try {
    var table = privacy.adBlockHostsTable('ads');
    UPDATE_HOSTS.forEach(function (host) {
      assert.ok(sinkholed(table, host), host + ' should be blocked while the flag is set');
    });
  } finally {
    delete mockEnv.files[HBC_FLAG];
  }
});

// Card 1 device 0 is the set's own microphone on a C2; the rest of that card is
// speaker feedback and mixing, and card 0 is the codec's own capture paths.
var C2_PCM = [
  '00-10: lg115x.10 lg115x-codec-dai.10-10 :  : capture 1',
  '01-00: WoV PDM Mic snd-soc-dummy-dai-0 :  : capture 1',
  '01-01: SpeakerFeedback snd-soc-dummy-dai-1 :  : capture 1',
  '01-02: MixerCapture snd-soc-dummy-dai-2 :  : capture 1',
  '01-03: SoundEngineCapture snd-soc-dummy-dai-3 :  : capture 1',
  '01-04: BluetoothCapture snd-soc-dummy-dai-4 :  : capture 1'
].join('\n');

test('the microphone is picked out of the capture devices, and nothing else is', function () {
  mockEnv.files['/proc/asound/pcm'] = C2_PCM;
  try {
    var devs = privacy.micDevices();
    assert.strictEqual(devs.length, 1, 'expected one microphone, got ' + JSON.stringify(devs));
    assert.strictEqual(devs[0].dev, '/dev/snd/pcmC1D0c');
    assert.ok(/WoV PDM Mic/.test(devs[0].name), 'kept the card\'s own name');
  } finally {
    delete mockEnv.files['/proc/asound/pcm'];
  }
});

test('a set with no capture devices reports no microphone', function () {
  mockEnv.files['/proc/asound/pcm'] = null;
  try {
    assert.deepStrictEqual(privacy.micDevices(), []);
  } finally {
    delete mockEnv.files['/proc/asound/pcm'];
  }
});

var failures = 0;
tests.forEach(function (t) {
  try {
    t[1]();
    console.log('  ✓ ' + t[0]);
  } catch (e) {
    failures++;
    console.log('  ✗ ' + t[0] + '\n      ' + e.message);
  }
});
mockEnv.restore();
process.exit(failures ? 1 : 0);
