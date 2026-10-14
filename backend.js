// 決定頁面要連哪個後端：舊入口（Google Apps Script）或暫存站（Cloudflare）。
// 依據同網站的 config.json，每次都不快取地讀；讀不到就沿用這台裝置上次讀到的設定，從沒讀到過就用舊入口。
// 網址加 ?backend=station 或 ?backend=google 可以強制指定（彩排、退回演練用）。
// 規則依據：checkin-system/暫存簽到站_規劃.md「規則 6」。
(function (global) {
  'use strict';

  var DEFAULTS = {
    mode: 'google',
    stationEvents: [],
    google: 'https://script.google.com/macros/s/AKfycbwwoZnAoiftITok6hGpFkKGzaRX4WqshVEbbHL1d_DwRKrmm3LHBDayZfaDtc0aO-In/exec',
    station: 'https://checkin-station.jonathan-lee-8ec.workers.dev/api'
  };
  var STORE = 'checkin_backend_config';
  var override = new URLSearchParams(location.search).get('backend');
  var current = null, loadedAt = 0, pending = null;

  function clean(c) {
    c = c || {};
    function https(u, fallback) { return typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : fallback; }
    return {
      mode: c.mode === 'station' ? 'station' : 'google',
      stationEvents: Array.isArray(c.stationEvents) ? c.stationEvents.map(String) : [],
      google: https(c.google, DEFAULTS.google),
      station: https(c.station, DEFAULTS.station)
    };
  }

  function remembered() {
    try { var s = localStorage.getItem(STORE); return s ? clean(JSON.parse(s)) : null; } catch (e) { return null; }
  }

  function load() {
    if (pending) return pending;
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 5000);
    pending = fetch('config.json?t=' + Date.now(), { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error('config ' + r.status); return r.json(); })
      .then(function (c) {
        current = clean(c);
        try { localStorage.setItem(STORE, JSON.stringify(current)); } catch (e) {}
        return current;
      })
      .catch(function () { current = current || remembered() || clean(DEFAULTS); return current; })
      .then(function (c) { clearTimeout(timer); loadedAt = Date.now(); pending = null; return c; });
    return pending;
  }

  /** 讀過且未超過 maxAgeMs 就直接用；否則重讀。 */
  function fresh(maxAgeMs) {
    if (current && Date.now() - loadedAt < maxAgeMs) return Promise.resolve(current);
    return load();
  }

  /** eventCode 只有簽到頁會帶：列在 stationEvents 的場次在整體仍是舊入口時也走暫存站（彩排用）。 */
  function pick(config, eventCode) {
    var kind = override === 'station' || override === 'google' ? override
      : (config.mode === 'station' || (eventCode && config.stationEvents.indexOf(eventCode) !== -1) ? 'station' : 'google');
    return { kind: kind, url: kind === 'station' ? config.station : config.google };
  }

  global.CheckinBackend = { load: load, fresh: fresh, pick: pick, defaults: DEFAULTS };
})(window);
