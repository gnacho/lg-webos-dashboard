/*
 * System notification subscriptions used by TV controls.
 * Strict ES5 for Node 0.12.2 on webOS 4.
 */

var luna = require('./luna');

function matchesEnergySaving(alert) {
  var info = alert && (alert.alertInfo || alert);
  var action = info && (info.onCloseAction || info.onFailAction || info.action);
  var params = info && (info.launchParams || info.launchParameters || info.params ||
                        (action && (action.launchParams || action.launchParameters || action.params)));
  var text;
  if (!info || info.sourceId !== 'com.webos.service.tvservice.noti') return false;
  if (alert.alertAction !== 'open' || (info.modal !== true && info.modal !== 'true')) return false;
  if (typeof params === 'string') {
    text = params;
  } else {
    try { text = JSON.stringify(params || {}); } catch (e) { return false; }
  }
  return /category\s*["']?\s*[:=]\s*["']?picture/i.test(text) &&
         /(?:key|settingKey|keys)\s*["']?\s*[:=]\s*(?:\[\s*)?["']?energySaving/i.test(text);
}

function init(opts) {
  opts = opts || {};
  var subscription = new luna.Subscription(
    'com.webos.notification/getAlertNotification',
    { subscribe: true },
    'com.webos.surfacemanager',
    {}
  );

  subscription.handlers.message = function (alert) {
    if (!matchesEnergySaving(alert)) return;
    console.log('notification: approving energy-saving confirmation popup');
    opts.luna('com.webos.service.networkinput/test/sendKeyCode', { keyCode: 28 }, function (response) {
      if (!response || !response.returnValue) {
        console.error('notification: could not approve energy-saving popup');
      }
    });
  };

  return {
    start: function () { subscription.start(); },
    stop: function () { subscription.stop(); },
    matchesEnergySaving: matchesEnergySaving
  };
}

module.exports = {
  init: init,
  matchesEnergySaving: matchesEnergySaving
};
