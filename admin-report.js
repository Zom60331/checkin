// 報到總表：活動後列出已到／未到（姓名＋訂單編號），排成一個畫面方便截圖。
// 後端動作 adminAttendance：管理密碼、只讀，不看場次是否啟用。
(function () {
  'use strict';

  var originalApi = api;
  api = function (p) {
    return DEMO && p.action === 'adminAttendance' ? demoReport(p) : originalApi(p);
  };

  var view = { el: null, ev: null, data: null, show: 'all', sort: 'order', timer: null, request: 0 };

  function open(ev) {
    close();
    view.ev = ev;
    view.data = null;
    view.el = document.createElement('div');
    view.el.className = 'rp-overlay';
    view.el.innerHTML =
      '<div class="rp-bar">' +
        '<div class="rp-seg" data-group="show">' +
          '<button data-v="all">全部</button><button data-v="absent">只看未到</button><button data-v="arrived">只看已到</button>' +
        '</div>' +
        '<div class="rp-seg" data-group="sort">' +
          '<button data-v="order">依訂單編號</button><button data-v="name">依姓名</button>' +
        '</div>' +
        '<span class="rp-hint"></span>' +
        '<button class="ghost" data-x="reload">重新讀取</button>' +
        '<button data-x="close">關閉</button>' +
      '</div>' +
      '<div class="rp-sheet"></div>';
    document.body.appendChild(view.el);

    view.el.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.x === 'close') { close(); return; }
      if (btn.dataset.x === 'reload') { load(); return; }
      var group = btn.parentNode.dataset.group;
      if (group) { view[group] = btn.dataset.v; render(); }
    });
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    load();
  }

  function close() {
    view.request++;
    if (!view.el) return;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    clearTimeout(view.timer);
    view.el.remove();
    view.el = null;
  }

  function onKey(e) { if (e.key === 'Escape') close(); }
  function onResize() { clearTimeout(view.timer); view.timer = setTimeout(fit, 120); }

  function sheet() { return view.el.querySelector('.rp-sheet'); }
  function hint(text) { view.el.querySelector('.rp-hint').textContent = text; }

  function load() {
    var el = view.el;
    var request = ++view.request;
    sheet().innerHTML = '<div class="rp-state">讀取名單與簽到紀錄中…</div>';
    hint('');
    fetchReport(view.ev, request).then(function (res) {
      if (view.el !== el || view.request !== request) return;
      if (res.status === 'needConsolePass') { askConsolePass(res.wrong); return; }
      if (res.status !== 'success') {
        sheet().innerHTML = '<div class="rp-state bad">' + esc(res.message || '讀取失敗') + '</div>';
        return;
      }
      view.data = res;
      render();
      // 使用暫存站時，補上「還有幾筆沒寫回試算表」，避免把還沒同步的人當成缺席
      if (window.StationStatus && !DEMO) {
        window.StationStatus.forEvent(view.ev.code).then(function (sync) {
          if (view.el !== el || view.data !== res || !sync || sync.state === 'purged') return;
          res.stationSync = sync;
          render();
        });
      }
    }).catch(function () {
      if (view.el === el && view.request === request) sheet().innerHTML = '<div class="rp-state bad">連線失敗，請按「重新讀取」</div>';
    });
  }

  // ---------- 取資料 ----------
  // 正式後端若還停在沒有 adminAttendance 的版本，改用控制台既有的 roster／dashboard 組出同一份資料。
  // 那幾個動作驗的是控制台密碼，而且本來就不檢查場次是否啟用。
  function fetchReport(ev, request) {
    if (!DEMO) return freshGoogleReport(ev, request);
    return api({ action: 'adminAttendance', event: ev.code }).then(function (res) {
      if (!(res.status === 'error' && /^未知的動作/.test(res.message || ''))) return res;

      var pass = view.consolePass || savedConsolePass();
      if (!pass) return { status: 'needConsolePass' };
      return legacyReport(ev, pass).then(function (r) {
        if (r.status === 'success') {
          view.consolePass = pass;
          try { localStorage.setItem('console_pass', pass); } catch (e) {}
        } else if (r.status === 'needConsolePass') {
          view.consolePass = '';
          r.wrong = true;
        }
        return r;
      });
    });
  }

  async function freshGoogleReport(ev, request) {
    var config = await CheckinBackend.fresh(60000);
    var id = '', started = Date.now();
    while (view.el && view.request === request && Date.now() - started < 240000) {
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, 15000);
      var res;
      try {
        var response = await fetch(config.station, {
          method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, signal: ctrl.signal,
          body: JSON.stringify({ action: 'adminAttendance', event: ev.code, pass: state.pass, requestId: id })
        });
        res = await response.json();
      } finally { clearTimeout(timer); }
      if (res.status !== 'pending') return res;
      id = res.requestId;
      if (!view.el || view.request !== request) break;
      sheet().innerHTML = '<div class="rp-state">正在向 Google 讀取正式紀錄…<br>等待下一輪同步處理，通常約一分鐘；已等待 ' + Math.floor((Date.now() - started) / 1000) + ' 秒。</div>';
      await new Promise(function (resolve) { setTimeout(resolve, 3000); });
    }
    return { status: 'error', message: '尚未收到報表。請確認同步狀態，再按「重新讀取」。' };
  }

  function savedConsolePass() {
    try { return localStorage.getItem('console_pass') || ''; } catch (e) { return ''; }
  }

  function consoleApi(payload, pass) {
    payload.pass = pass;
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); });
  }

  function askConsolePass(wrong) {
    sheet().innerHTML = '<div class="rp-state">' +
      '<p>正式後端還沒有報到總表的新動作，這次改用控制台的資料整理。</p>' +
      '<p>請輸入<b>控制台密碼</b>（現場人員用的那一組）：</p>' +
      '<input type="password" autocomplete="off">' +
      '<button>讀取</button>' +
      (wrong ? '<p class="bad">控制台密碼不正確，請再試一次</p>' : '') + '</div>';
    var input = sheet().querySelector('input');
    var submit = function () {
      if (!input.value.trim()) return;
      view.consolePass = input.value.trim();
      load();
    };
    sheet().querySelector('button').addEventListener('click', submit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    input.focus();
  }

  function legacyReport(ev, pass) {
    // 先清掉這場的快取，後面讀到的才是試算表現況
    return consoleApi({ action: 'reloadRoster', event: ev.code }, pass).then(function (first) {
      if (first.status === 'unauthorized') return { status: 'needConsolePass' };
      if (first.status !== 'success') return first;
      return Promise.all([
        consoleApi({ action: 'roster', event: ev.code, filter: 'all' }, pass),
        consoleApi({ action: 'roster', event: ev.code, filter: 'abnormal' }, pass),
        consoleApi({ action: 'dashboard', event: ev.code }, pass)
      ]).then(function (r) {
        var failed = r.filter(function (x) { return x.status !== 'success'; })[0];
        if (failed) return failed;
        if (r[0].total > r[0].rows.length || r[1].total > r[1].rows.length) {
          return { status: 'error', message: '名單超過 500 筆，後端更新前無法完整列出' };
        }
        return composeLegacy(ev, r[0].rows, r[1].rows, r[2].stats);
      });
    });
  }

  // 與後端 reportByOrder_ 相同：純數字依數值，沒有編號的排最後
  function byOrder(a, b) {
    var x = String(a.orderId || ''), y = String(b.orderId || '');
    if (!x !== !y) return x ? -1 : 1;
    if (/^\d+$/.test(x) && /^\d+$/.test(y) && x.length !== y.length) return x.length - y.length;
    if (x !== y) return x < y ? -1 : 1;
    return String(a.name) < String(b.name) ? -1 : String(a.name) > String(b.name) ? 1 : 0;
  }

  // paidRows：roster filter=all（成功單＋現場新增）；abnormalRows：roster filter=abnormal；board：dashboard 的 stats
  function composeLegacy(ev, paidRows, abnormalRows, board) {
    var head = function (v) { var n = parseInt(v, 10); return isNaN(n) || n < 1 ? 1 : n; };
    var person = function (r) {
      var manual = /^manual:/.test(r.orderId || '');
      var p = { name: r.name, orderId: manual ? '' : String(r.orderId || '').trim(), headcount: head(r.headcount) };
      if (manual) p.manual = true;
      return p;
    };
    var checkedIn = function (r, p) {
      p.time = r.checkInTime; p.method = r.method;
      if (phoneCount[r.phone] > 1) p.duplicatePhone = true;
      return p;
    };

    // 控制台的 roster 以電話對紀錄，沒填電話的名單列會誤對到「沒填電話的現場新增」；沒有電話就不可能自己對到紀錄
    var isIn = function (r) { return r.checkedIn && !!r.phone; };

    var rosterPaid = paidRows.filter(function (r) { return r.source === '名單'; });
    var phoneCount = {};
    rosterPaid.concat(abnormalRows).forEach(function (r) { if (r.phone) phoneCount[r.phone] = (phoneCount[r.phone] || 0) + 1; });

    var arrived = [], absent = [], others = [], expectedPeople = 0, abnormalAbsent = 0, walkIn = 0, listedPeople = 0;
    rosterPaid.forEach(function (r) {
      var p = person(r);
      expectedPeople += p.headcount;
      if (isIn(r)) { arrived.push(checkedIn(r, p)); listedPeople += p.headcount; } else absent.push(p);
    });
    abnormalRows.forEach(function (r) {
      if (!isIn(r)) { abnormalAbsent++; return; }
      var p = checkedIn(r, person(r));
      p.tag = r.payStatus || '異常單'; p.note = r.note;
      others.push(p); listedPeople += p.headcount;
    });
    paidRows.filter(function (r) { return r.source === '現場新增'; }).forEach(function (r) {
      if (r.phone && phoneCount[r.phone]) return;   // 電話對得到名單的人已經列在上面
      var p = person(r);
      p.time = r.checkInTime; p.method = r.method; p.tag = '現場新增'; p.note = r.note;
      others.push(p); walkIn++; listedPeople += p.headcount;
    });
    arrived.sort(byOrder);
    absent.sort(byOrder);

    var hasDuplicatePhone = Object.keys(phoneCount).some(function (k) { return phoneCount[k] > 1; });
    var t = new Date(), two = function (n) { return String(n).padStart(2, '0'); };
    var expected = arrived.length + absent.length;
    return {
      status: 'success',
      legacy: true,
      event: { code: ev.code, name: ev.name, date: ev.date, enabled: ev.enabled },
      generatedAt: t.getFullYear() + '/' + two(t.getMonth() + 1) + '/' + two(t.getDate()) + ' ' + two(t.getHours()) + ':' + two(t.getMinutes()) + ':' + two(t.getSeconds()),
      stats: {
        expected: expected, expectedPeople: expectedPeople, arrived: arrived.length, absent: absent.length,
        rate: expected > 0 ? Math.round(arrived.length / expected * 1000) / 10 : 0,
        others: others.length, walkIn: walkIn, arrivedPeople: board.arrived, zeroAbsent: 0, abnormalAbsent: abnormalAbsent,
        // 控制台資料列不出「簽到後被移出名單的人」，只能從人數差看出來
        unlisted: hasDuplicatePhone ? 0 : Math.max(board.arrived - listedPeople, 0)
      },
      arrived: arrived, absent: absent, others: others, zeroAbsent: []
    };
  }

  // 全形字算 1 個字寬，英數約半個，用來決定欄寬
  function widthEm(text) {
    var w = 0;
    Array.from(String(text)).forEach(function (ch) { w += ch.codePointAt(0) > 0x2e7f ? 1 : 0.58; });
    return w;
  }

  function orderText(p) { return p.manual ? '人工補充' : (p.orderId || '—'); }

  function nameSuffix(p) {
    var s = '';
    if (p.headcount > 1) s += '×' + p.headcount;
    if (p.duplicatePhone) s += (s ? ' ' : '') + '同電話';
    return s;
  }

  function sorted(list) {
    if (view.sort !== 'name') return list;
    return list.slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'zh-Hant'); });
  }

  function grid(list) {
    if (list.length === 0) return '<div class="rp-meta">沒有資料</div>';
    var nameW = 3, orderW = 2;
    list.forEach(function (p) {
      nameW = Math.max(nameW, widthEm(p.name) + (nameSuffix(p) ? widthEm(nameSuffix(p)) + 0.4 : 0));
      orderW = Math.max(orderW, widthEm(orderText(p)));
    });
    var col = Math.min(nameW, 10) + orderW + 1;
    return '<div class="rp-grid" style="--rp-col:' + col.toFixed(1) + 'em">' + sorted(list).map(function (p) {
      var suffix = nameSuffix(p);
      var title = p.time ? ' title="' + esc(p.time + (p.method ? '・' + p.method : '')) + '"' : '';
      return '<div class="rp-item"' + title + '><span class="n">' + esc(p.name) +
        (suffix ? '<small>' + esc(suffix) + '</small>' : '') + '</span><span class="o">' + esc(orderText(p)) + '</span></div>';
    }).join('') + '</div>';
  }

  function wideList(list, withTag) {
    return '<div class="rp-grid wide">' + sorted(list).map(function (p) {
      return '<div class="rp-item"><span class="n">' + esc(p.name) +
        (p.headcount > 1 ? '<small>×' + p.headcount + '</small>' : '') + '</span>' +
        '<span class="o">' + esc(orderText(p)) + '</span>' +
        (withTag && p.tag ? '<span class="rp-tag">' + esc(p.tag) + '</span>' : '') +
        (p.note ? '<span class="rp-note">' + esc(p.note) + '</span>' : '') + '</div>';
    }).join('') + '</div>';
  }

  function render() {
    var d = view.data;
    if (!d) return;
    view.el.querySelectorAll('.rp-seg').forEach(function (seg) {
      seg.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === view[seg.dataset.group]); });
    });

    var s = d.stats, ev = d.event;
    var html = '<div class="rp-head"><h2>' + esc(ev.name || ev.code) + '</h2>' +
      '<span class="rp-meta">' + (ev.date ? esc(ev.date) + '｜' : '') + '報到總表｜資料時間 ' + esc(d.generatedAt) + '</span>' +
      '<div class="rp-stats">' +
        '<span>應到 <b>' + s.expected + '</b> 筆' + (s.expectedPeople !== s.expected ? '（' + s.expectedPeople + ' 人）' : '') + '</span>' +
        '<span class="ok">已到 <b>' + s.arrived + '</b></span>' +
        '<span class="no">未到 <b>' + s.absent + '</b></span>' +
        '<span>報到率 <b>' + s.rate + '%</b></span>' +
        (s.others > 0 ? '<span>名單外到場 <b>' + s.others + '</b> 筆</span>' : '') +
        '<span>現場實到 <b>' + s.arrivedPeople + '</b> 人</span>' +
      '</div></div>';

    if (view.show !== 'arrived') {
      html += '<section class="rp-sec absent"><h3>未到 ' + d.absent.length + ' 筆</h3>' + grid(d.absent) + '</section>';
    }
    if (view.show !== 'absent') {
      html += '<section class="rp-sec arrived"><h3>已到 ' + d.arrived.length + ' 筆</h3>' + grid(d.arrived) + '</section>';
      if (d.others.length > 0) {
        html += '<section class="rp-sec others"><h3>名單外到場 ' + d.others.length + ' 筆<small>不計入報到率</small></h3>' + wideList(d.others, true) + '</section>';
      }
    }
    if (view.show !== 'arrived' && d.zeroAbsent.length > 0) {
      html += '<section class="rp-sec zero"><h3>講座金額 0、未到 ' + d.zeroAbsent.length + ' 筆<small>可能已轉到其他場次，不列入應到</small></h3>' + grid(d.zeroAbsent) + '</section>';
    }

    html += '<div class="rp-foot">應到＝交易成功的報名' + (d.zeroAbsent.length > 0 ? '（不含講座金額 0）' : '') + '。' +
      (s.abnormalAbsent > 0 ? '退款、失敗等未到場的 ' + s.abnormalAbsent + ' 筆不列名。' : '') +
      (s.unlisted > 0 ? '另有 ' + s.unlisted + ' 人的簽到紀錄對不到目前名單（名單在簽到後有異動）。' : '') +
      (ev.enabled ? '這場目前仍開放簽到。' : '') +
      (d.stationSync ? (d.stationSync.pending > 0
        ? '<b>暫存站還有 ' + d.stationSync.pending + ' 筆動作沒寫回試算表，這張表可能少算；約一分鐘後按「重新讀取」。</b>'
        : '暫存站的動作都已寫回試算表。') : '') + '</div>';

    sheet().innerHTML = html;
    fit();
  }

  // 由大到小試字級，直到整張表不必捲動
  function fit() {
    if (!view.el || !view.data) return;
    var box = sheet(), fits = false;
    for (var size = 16; size >= 9; size -= 0.5) {
      box.style.setProperty('--rp-fs', size + 'px');
      if (box.scrollHeight <= box.clientHeight + 1) { fits = true; break; }
    }
    hint((fits ? '已排成一個畫面，截下方白色區域即可'
               : '一個畫面放不下：可切換「只看未到／只看已到」分兩張截，或把視窗放大') +
         (view.data.legacy ? '（資料取自控制台）' : ''));
  }

  // ---------- 示範資料（全部虛構） ----------
  function demoReport(p) {
    var family = '陳林黃張李王吳劉蔡楊許鄭謝洪郭邱曾廖賴徐周葉蘇莊呂江何蕭羅高';
    var given = ['怡君', '志明', '淑芬', '家豪', '雅婷', '俊傑', '美玲', '冠宇', '佩珊', '宗翰', '欣怡', '建宏', '詩涵', '柏翰', '惠雯', '承恩'];
    var arrived = [], absent = [];
    for (var i = 0; i < 167; i++) {
      var person = { name: family[i % family.length] + given[(i * 7) % given.length], orderId: String(3272100 + i * 3), headcount: i % 41 === 5 ? 2 : 1 };
      if (i % 9 === 4) absent.push(person);
      else { person.time = '2026/10/15 09:' + String(10 + (i % 45)).padStart(2, '0') + ':00'; person.method = '自助'; arrived.push(person); }
    }
    var others = [
      { name: '示範現場客', orderId: '', headcount: 1, tag: '現場新增', note: '線上轉現場（小林 09:41）' },
      { name: '示範補款者', orderId: '3272990', headcount: 1, tag: '失敗', note: '現場補款（小林 09:20）' }
    ];
    var people = arrived.concat(absent).reduce(function (n, x) { return n + x.headcount; }, 0);
    var res = {
      status: 'success',
      event: { code: p.event, name: (state.events.filter(function (e) { return e.code === p.event; })[0] || {}).name || p.event, date: '2026/10/15', enabled: false },
      generatedAt: '2026/10/15 17:30:00',
      stats: { expected: 167, expectedPeople: people, arrived: arrived.length, absent: absent.length,
        rate: Math.round(arrived.length / 167 * 1000) / 10, others: others.length, walkIn: 1,
        arrivedPeople: arrived.reduce(function (n, x) { return n + x.headcount; }, 0) + 2, zeroAbsent: 0, abnormalAbsent: 3 },
      arrived: arrived, absent: absent, others: others, zeroAbsent: []
    };
    return new Promise(function (resolve) { setTimeout(function () { resolve(res); }, 300); });
  }

  $('list').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act="report"]');
    if (btn) open(state.events[Number(btn.closest('[data-i]').dataset.i)]);
  });
  $('logoutBtn').addEventListener('click', close);
})();
