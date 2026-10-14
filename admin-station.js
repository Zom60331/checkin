// 管理頁的「暫存站狀態」：使用暫存站時，列出各場的同步進度（尚未寫回試算表的筆數、上次同步、關閉與清除）。
// 讀暫存站的 status 動作需要控制台密碼，沿用這台瀏覽器登入控制台時存下的那組。
// Google 端更完整的紀錄在主控表「同步狀態」分頁。
(function () {
  'use strict';

  var PHASE = { open: '開放中', closing: '關閉中：收回與核對', purged: '已清除' };
  var latest = null;

  function consolePass() {
    try { return localStorage.getItem('console_pass') || ''; } catch (e) { return ''; }
  }

  function ask(config, body) {
    return fetch(config.station, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  var panel = document.createElement('section');
  panel.className = 'st-panel hidden';
  panel.innerHTML = '<div class="st-head"><h2>暫存站</h2><span class="st-mode"></span>' +
    '<button class="ghost" type="button">更新</button></div><div class="st-body"></div>';
  var anchor = $('list').previousElementSibling || $('list');
  anchor.parentNode.insertBefore(panel, anchor);
  panel.querySelector('button').addEventListener('click', refresh);

  function render(config, res) {
    var body = panel.querySelector('.st-body');
    if (!res || res.status !== 'success') {
      body.innerHTML = '<p class="cms-muted">' + esc((res && res.message) || '讀不到暫存站狀態') + '</p>';
      return;
    }
    var events = res.events.filter(function (e) { return e.sync.state !== 'purged'; })
      .concat(res.events.filter(function (e) { return e.sync.state === 'purged'; }).slice(0, 3));
    if (events.length === 0) { body.innerHTML = '<p class="cms-muted">暫存站上目前沒有場次。</p>'; return; }
    body.innerHTML = '<table class="st-table"><tr><th>場次</th><th>狀態</th><th>尚未寫回</th><th>上次同步</th></tr>' +
      events.map(function (e) {
        var s = e.sync;
        var last = s.lastAt ? String(s.lastAt).slice(5) + (s.lastOk === false ? '（失敗：' + esc(s.lastMessage || '') + '）' : '') : '尚未同步';
        return '<tr class="' + (s.lastOk === false || s.pending > 20 ? 'warn' : '') + '"><td>' + esc(e.name || e.code) +
          '<div class="cms-muted">' + esc(e.code) + '</div></td><td>' + esc(PHASE[s.state] || s.state) + '</td><td>' +
          (s.state === 'purged' ? '—' : s.pending) + '</td><td>' + last + '</td></tr>';
      }).join('') + '</table><p class="cms-muted">資料時間 ' + esc(res.time) + '。Google 端的完整紀錄在主控表「同步狀態」分頁。</p>';
  }

  function refresh() {
    return CheckinBackend.load().then(function (config) {
      var uses = config.mode === 'station' || config.stationEvents.length > 0;
      panel.classList.toggle('hidden', !uses);
      panel.querySelector('.st-mode').textContent = config.mode === 'station' ? '全部場次使用中'
        : '僅彩排場次：' + config.stationEvents.join('、');
      if (!uses) return null;
      if (!consolePass()) {
        panel.querySelector('.st-body').innerHTML = '<p class="cms-muted">需要控制台密碼才能查看：請先在這台瀏覽器登入一次控制台。</p>';
        return null;
      }
      return ask(config, { action: 'status', pass: consolePass() }).then(function (res) {
        latest = res && res.status === 'success' ? res : null;
        render(config, res);
        return latest;
      });
    }).catch(function () {
      panel.querySelector('.st-body').innerHTML = '<p class="cms-muted">連不到暫存站</p>';
      return null;
    });
  }

  /** 給報到總表用：這場在暫存站的同步狀態；沒用暫存站或讀不到時回 null。 */
  window.StationStatus = {
    forEvent: function (code) {
      return refresh().then(function (res) {
        if (!res) return null;
        var hit = res.events.filter(function (e) { return e.code === code; })[0];
        return hit ? hit.sync : null;
      });
    }
  };

  if (!DEMO) refresh();
})();
