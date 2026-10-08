(function () {
  'use strict';
  var sources = [], activeDialog = null, connected = false, pendingPayload = null;
  var PENDING = 'cms-operation-v1' + (DEMO ? '-demo' : '');
  var uid = function () { return crypto.randomUUID(); };
  var demoState = { sources: [], events: [], rows: {} };
  try { demoState = JSON.parse(sessionStorage.getItem('cms-demo')) || demoState; } catch (_) {}
  function keepDemo() { sessionStorage.setItem('cms-demo', JSON.stringify(demoState)); }
  var originalApi = api;
  api = function (p) {
    if (DEMO && p.action === 'adminEvents') return originalApi(p).then(function (r) {
      var overrides = new Map(demoState.events.map(function (e) { return [e.code, e]; }));
      r.events = r.events.map(function (e) { return overrides.get(e.code) || e; });
      demoState.events.forEach(function (e) { if (!r.events.some(function (x) { return x.code === e.code; })) r.events.push(e); });
      return r;
    });
    if (DEMO && /^(adminSources|adminSource|adminImport|adminEventSave)/.test(p.action)) return Promise.resolve(demoCms(p));
    return originalApi(p);
  };
  async function call(p) {
    var result = await api(p);
    if (result.status !== 'success') { var error = Error(result.message || '操作尚未完成，請確認後重試'); error.definite = result.status !== 'uncertain'; throw error; }
    return result;
  }
  function message(t, error) { $('cmsMessage').textContent = t; $('cmsMessage').style.color = error ? 'var(--fail)' : ''; }
  function bridge(action, fields) {
    if (DEMO) return Promise.resolve(demoBridge(action, fields || {}));
    return new Promise(function (resolve, reject) {
      var id = uid(), timer = setTimeout(function () { cleanup(); reject(Error(action === 'ping' ? '尚未偵測到匯入助手。請依首次使用說明安裝，再重新整理管理頁。' : 'CMS 讀取逾時，請確認登入後重試')); }, action === 'ping' ? 1500 : 180000);
      function cleanup() { clearTimeout(timer); window.removeEventListener('message', receive); }
      function receive(e) {
        if (e.source !== window || e.origin !== location.origin || e.data?.channel !== 'checkin-cms-response' || e.data.id !== id) return;
        cleanup(); if (e.data.ok) resolve(e.data); else reject(Error(e.data.message || 'CMS 讀取失敗'));
      }
      window.addEventListener('message', receive);
      window.postMessage(Object.assign({ channel: 'checkin-cms-request', action: action, id: id }, fields), location.origin);
    });
  }
  async function detect() {
    $('cmsConnection').textContent = '正在檢查匯入助手…';
    try { var r = await bridge('ping'); connected = true; $('cmsConnection').textContent = DEMO ? '示範模式：所有課程與名單皆為虛構資料。' : '匯入助手已連接 · ' + r.version + '。讀取時會檢查 CMS 登入狀態。'; }
    catch (e) { connected = false; $('cmsConnection').textContent = e.message; }
  }
  async function loadSources() {
    try {
      var r = await call({ action: 'adminSources' }); sources = r.sources;
      $('cmsSources').innerHTML = sources.map(function (s) {
        return '<article class="cms-source" data-source="' + esc(s.id) + '"><span class="cms-pill">CMS ' + esc(s.courseId) + '</span><h4>' + esc(s.name) + '</h4><p>' + s.stats.eligible + ' 筆有效報名 · ' + s.stats.people + ' 人</p><p class="cms-muted">最後更新 ' + esc(s.updated) + ' · 版本 ' + s.revision + '</p><div class="cms-actions"><button data-cms="update">從 CMS 更新</button><button class="ghost" data-cms="event">建立場次</button><button class="ghost" data-cms="detail">檢查／補充／版本</button></div></article>';
      }).join('') || '<p class="cms-muted">還沒有匯入來源。先選一門課，或沿用下方既有場次。</p>';
    } catch (e) { message(e.message, true); }
  }
  var oldShow = showEvents;
  showEvents = function (r) { oldShow(r); loadSources(); detect(); checkPending(); };
  function dialog(title, content) {
    if (activeDialog) activeDialog.remove();
    var mask = document.createElement('div'); mask.className = 'mask';
    mask.innerHTML = '<section class="modal cms-dialog" role="dialog" aria-modal="true" aria-labelledby="cmsDialogTitle"><button class="cms-close" data-close>關閉</button><h2 id="cmsDialogTitle">' + esc(title) + '</h2>' + content + '<p class="cms-status" role="status"></p></section>';
    document.body.appendChild(mask); activeDialog = mask;
    mask.querySelector('[data-close]').onclick = function () { if (!mask.busy) { mask.remove(); activeDialog = null; } };
    mask.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !mask.busy) { mask.remove(); activeDialog = null; }
      if (e.key === 'Tab') {
        var focusable = Array.from(mask.querySelectorAll('button,input,textarea,select,a[href]')).filter(function (el) { return !el.disabled && el.offsetParent !== null; });
        var first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
        else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
      }
    });
    mask.querySelector('input,button').focus(); return mask;
  }
  function status(d, t, bad) { d.querySelector('.cms-status').textContent = t; d.querySelector('.cms-status').classList.toggle('error', !!bad); }
  function busy(d, b) {
    if (d.busy === b) return;
    d.busy = b;
    d.querySelectorAll('button,input,textarea,select').forEach(function (el) {
      if (b) { el.dataset.cmsWasDisabled = el.disabled ? '1' : '0'; el.disabled = true; }
      else if (el.dataset.cmsWasDisabled !== undefined) { el.disabled = el.dataset.cmsWasDisabled === '1'; delete el.dataset.cmsWasDisabled; }
    });
  }
  function statsHtml(s) {
    return '<div class="cms-stats">' + [['CMS 訂單', s.rows], ['成功訂單', s.paidOrders], ['零講座金額（已排除）', s.zeroAmount || 0], ['有效報名', s.eligible], ['應到人數', s.people], ['無效／排除合計', s.excluded], ['資料待確認', s.invalid], ['重複手機', s.duplicates]].map(function (x) { return '<div class="cms-stat">' + x[0] + '<b>' + x[1] + '</b></div>'; }).join('') + '</div>';
  }
  function issueHtml(items) { return '<details><summary>待確認資料（' + items.length + '）</summary><ul class="cms-issues">' + items.map(function (r) { return '<li>' + esc(r.key) + ' · ' + esc(r.name) + '：' + esc(r.message) + '</li>'; }).join('') + '</ul></details>'; }
  function checkPending() { $('cmsPending').classList.toggle('hidden', !sessionStorage.getItem(PENDING)); }
  async function mutate(p, d) {
    var prior = sessionStorage.getItem(PENDING);
    if (prior && JSON.parse(prior).requestId !== p.requestId) throw Error('請先按「確認上次名單操作」，完成後才能開始另一個變更');
    pendingPayload = p;
    sessionStorage.setItem(PENDING, JSON.stringify({ requestId: p.requestId })); checkPending();
    try {
      var r = await call(p);
      sessionStorage.removeItem(PENDING); pendingPayload = null; checkPending();
      await loadSources(); await loadEvents(); return r;
    } catch (e) {
      // First recover a successful write whose response was lost.
      var notSaved = false;
      try {
        var saved = await api({ action: 'adminImportStatus', requestId: p.requestId });
        if (saved.status === 'success') { sessionStorage.removeItem(PENDING); pendingPayload = null; checkPending(); await loadSources(); await loadEvents(); return saved; }
        notSaved = saved.status === 'not_found';
      } catch (_) {}
      if (e.definite && notSaved) { sessionStorage.removeItem(PENDING); pendingPayload = null; checkPending(); throw e; }
      throw Error(e.message + '。如尚未確認完成，請保留此頁並重試原操作。');
    }
  }
  async function importCourse(source) {
    if (sessionStorage.getItem(PENDING)) { message('請先確認上次名單操作，再開始新的匯入。', true); return; }
    var d = dialog(source ? '更新 CMS 名單' : '從 CMS 建立名單', '<p class="cms-steps">01 選課程 → 02 檢查名單 → 03 確認匯入</p><div id="cmsChoose"><label for="cmsQuery">課程名稱、講師、編號或名單網址</label><div class="cms-actions"><input id="cmsQuery" placeholder="例如：3246"><button id="cmsSearch">搜尋課程</button><button class="ghost" id="cmsById">用編號／網址讀取</button></div><div class="cms-results" id="cmsResults"></div></div><div id="cmsReview" class="hidden"></div>');
    var payload = null, commit = null;
    async function read(id) {
      busy(d, true); status(d, '讀取完整名單並核對 CMS 畫面筆數…');
      try {
        var r = await bridge('roster', { courseId: id });
        var current = sources.find(function (s) { return s.courseId === id; });
        payload = { courseId: id, name: r.name, rows: r.rows, expectedCount: r.expectedCount, complete: r.complete, revision: current ? current.revision : 0 };
        var p = await call(Object.assign({ action: 'adminImportPreview' }, payload));
        payload.token = p.token;
        d.querySelector('#cmsChoose').classList.add('hidden');
        var box = d.querySelector('#cmsReview'); box.classList.remove('hidden');
        box.innerHTML = '<h3>' + esc(r.name) + '</h3><p class="cms-muted">CMS ' + esc(id) + ' · ' + (current ? '更新既有來源' : '建立新來源') + '</p>' + statsHtml(p.stats) + '<p>新增 ' + p.diff.added + ' 筆 · 異動 ' + p.diff.changed + ' 筆 · 移除 ' + p.diff.removed + ' 筆</p>' + issueHtml(p.issues) + '<label class="cms-check"><input type="checkbox" id="cmsAcknowledge"><span>我已核對課程與異常資料，同意將必要報名資料保存到簽到系統的 Google 試算表。</span></label>' + (p.empty ? '<label class="cms-check"><input type="checkbox" id="cmsEmpty"><span>我確認這門課目前沒有任何訂單，要套用空的 CMS 名單。</span></label>' : '') + '<div class="cms-actions"><button id="cmsCommit">確認並匯入</button></div>';
        box.querySelector('#cmsCommit').onclick = async function () {
          if (!box.querySelector('#cmsAcknowledge').checked || (p.empty && !box.querySelector('#cmsEmpty').checked)) { status(d, '請先勾選名單確認。', true); return; }
          if (!commit) commit = Object.assign({ action: 'adminImportCommit', requestId: uid(), acknowledged: true, allowEmpty: p.empty }, payload);
          busy(d, true); status(d, '保存名單，完成後才會切換新版本…');
          try { var saved = await mutate(commit, d); payload = null; d.remove(); activeDialog = null; message('名單已匯入：' + saved.source.name + '。可建立簽到場次，或前往聯合抽獎選用。'); }
          catch (e) { status(d, e.message, true); }
          finally { busy(d, false); }
        };
        status(d, '成功且講座金額大於 0 才列入有效資格；零元單可能已轉場。零人數、缺資料及部分退款也需確認。人工補充與簽到紀錄會保留。');
      } catch (e) { status(d, e.message, true); }
      finally { busy(d, false); }
    }
    d.querySelector('#cmsSearch').onclick = async function () {
      var q = d.querySelector('#cmsQuery').value.trim();
      if (!q) { status(d, '請先輸入搜尋條件。', true); return; }
      busy(d, true); status(d, '搜尋 CMS 課程…');
      try {
        var r = await bridge('courses', { query: q });
        var results = d.querySelector('#cmsResults');
        results.innerHTML = r.courses.map(function (c) { return '<button class="cms-course" data-id="' + esc(c.id) + '">' + esc(c.name) + '<small>' + esc(c.id) + ' · ' + esc(c.teacher) + '</small></button>'; }).join('');
        results.querySelectorAll('[data-id]').forEach(function (b) { b.onclick = function () { read(b.dataset.id); }; });
        status(d, r.total ? '找到 ' + r.total + ' 門課程' + (r.total > 100 ? '，顯示前 100 筆，請縮小搜尋。' : '，請選擇要匯入的課程。') : '沒有符合的課程，可改用課程編號讀取。');
      } catch (e) { status(d, e.message, true); }
      finally { busy(d, false); }
    };
    d.querySelector('#cmsById').onclick = function () {
      var text = d.querySelector('#cmsQuery').value.trim(), id = text;
      if (!/^\d+$/.test(text)) { try { var u = new URL(text); id = u.hostname === 'cmsv.cmoney.tw' && u.pathname.toLowerCase() === '/cmrichpowerintra/classes/class-registerers.aspx' ? u.searchParams.get('id') : ''; } catch (_) { id = ''; } }
      if (!/^[1-9]\d{0,9}$/.test(id)) { status(d, '請輸入課程編號或 CMS 學員名單網址。', true); return; } read(id);
    };
    if (source) read(source.courseId);
  }
  function editEvent(ev, selectedSource) {
    ev = ev || {};
    var requestId = uid(), originalCode = ev.code || '';
    var date = ev.date ? ev.date.replace(/\//g, '-').slice(0, 10) : new Date().toLocaleDateString('sv-SE');
    var d = dialog(originalCode ? '編輯場次' : '建立簽到場次', '<p class="cms-steps">選名單 → 填活動資料 → 預覽 → 儲存草稿／開放簽到</p><div class="cms-grid"><div><label for="cmsEventSource">名單來源</label><select id="cmsEventSource">' + (originalCode && !ev.sourceId ? '<option value="">沿用既有試算表</option>' : '<option value="">請選擇名單來源</option>') + sources.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join('') + '</select><label for="cmsEventName">場次名稱</label><input id="cmsEventName" maxlength="160"><label for="cmsEventDate">活動日期</label><input id="cmsEventDate" type="date"><label for="cmsEventCode">場次代碼（建立後固定）</label><input id="cmsEventCode" maxlength="60" pattern="[A-Za-z0-9_-]+"' + (originalCode ? ' readonly' : '') + '><label for="cmsHero">主視覺圖片網址（選填）</label><input id="cmsHero" type="url" placeholder="https://…"><label for="cmsWelcome">當天段落介紹（支援分行）</label><textarea id="cmsWelcome" maxlength="8000"></textarea><label for="cmsNotice">提醒事項</label><textarea id="cmsNotice" maxlength="4000"></textarea><label class="cms-check"><input type="checkbox" id="cmsEnabled"><span>開放簽到（未勾選則儲存為草稿）</span></label><label class="cms-check hidden" id="cmsChangeLabel"><input type="checkbox" id="cmsChangeSource"><span>確認更換此場次名單；既有簽到紀錄保留，可能與新名單不同。</span></label></div><div><p class="cms-muted">簽到頁內容預覽</p><div class="cms-preview"><img id="cmsPreviewImage" alt="課程主視覺" class="hidden"><h3 id="cmsPreviewName"></h3><p id="cmsPreviewWelcome"></p><p id="cmsPreviewNotice" class="cms-muted"></p><input disabled placeholder="輸入手機末四碼"><p class="cms-muted">學員掃 QR 後在這裡簽到</p></div></div></div><div class="cms-actions"><button id="cmsSaveEvent">儲存場次</button></div>');
    var field = function (id) { return d.querySelector('#' + id); };
    field('cmsEventSource').value = selectedSource || ev.sourceId || '';
    field('cmsEventName').value = ev.name || sources.find(function (s) { return s.id === selectedSource; })?.name || '';
    field('cmsEventDate').value = date;
    field('cmsEventCode').value = originalCode || date.replace(/-/g, '') + '-' + requestId.slice(0, 6);
    field('cmsHero').value = ev.heroImage || ''; field('cmsWelcome').value = ev.welcome || ''; field('cmsNotice').value = ev.notice || ''; field('cmsEnabled').checked = !!ev.enabled;
    function preview() {
      field('cmsPreviewName').textContent = field('cmsEventName').value || '場次名稱';
      field('cmsPreviewWelcome').textContent = field('cmsWelcome').value;
      field('cmsPreviewNotice').textContent = field('cmsNotice').value;
      var u = field('cmsHero').value.trim(); field('cmsPreviewImage').classList.toggle('hidden', !/^https:\/\//i.test(u)); if (/^https:\/\//i.test(u)) field('cmsPreviewImage').src = u;
      field('cmsChangeLabel').classList.toggle('hidden', !originalCode || field('cmsEventSource').value === (ev.sourceId || ''));
    }
    d.addEventListener('input', preview); preview();
    field('cmsSaveEvent').onclick = async function () {
      var event = { code: field('cmsEventCode').value.trim(), name: field('cmsEventName').value.trim(), date: field('cmsEventDate').value, sourceId: field('cmsEventSource').value, heroImage: field('cmsHero').value.trim(), welcome: field('cmsWelcome').value, notice: field('cmsNotice').value, enabled: field('cmsEnabled').checked };
      if (!event.name || !event.date || !/^[A-Za-z0-9_-]+$/.test(event.code) || (!originalCode && !event.sourceId)) { status(d, '請填寫名單來源、名稱、日期與有效場次代碼。', true); return; }
      if (originalCode && event.sourceId !== (ev.sourceId || '') && !field('cmsChangeSource').checked) { status(d, '請先確認更換名單來源。', true); return; }
      busy(d, true); status(d, '正在儲存場次…');
      try { await call({ action: 'adminEventSave', requestId: requestId, originalCode: originalCode, baseToken: ev.editToken, confirmSourceChange: field('cmsChangeSource').checked, event: event }); await loadEvents(); d.remove(); activeDialog = null; message(event.enabled ? '場次已開放簽到，可以下載 QR。' : '已儲存草稿。檢查名單與預覽後，再編輯場次開放簽到。'); }
      catch (e) { status(d, e.message + '。可按原按鈕重試。', true); }
      finally { busy(d, false); }
    };
  }
  async function detail(s) {
    var d = dialog('名單檢查與維護', '<p>讀取中…</p>');
    try {
      var r = await call({ action: 'adminSourceDetail', sourceId: s.id }); s = r.source;
      d.remove();
      d = dialog(s.name, statsHtml(s.stats) + issueHtml(r.issues) + '<p class="cms-muted">補充與修正獨立保留。CMS 更新不會清除；修正姓名或人數不會自動把退款單改成成功單。</p><div class="cms-actions"><button id="cmsAddPerson">新增補充／修正</button></div><div id="cmsSupplementList"></div><h3>名單版本</h3><p class="cms-muted">復原 CMS 名單會保留目前人工修正與所有簽到紀錄。</p><div class="cms-actions"><select id="cmsHistory">' + s.history.map(function (h) { return '<option value="' + h.revision + '">版本 ' + h.revision + ' · ' + esc(h.time) + ' · ' + esc(h.reason || '') + '</option>'; }).join('') + '</select><button id="cmsRestore" class="ghost">復原所選版本</button></div>');
      var supplements = r.supplements;
      function renderSupplements() {
        d.querySelector('#cmsSupplementList').innerHTML = supplements.map(function (p, i) { return '<p>' + esc(p.name || p.targetKey) + ' · ' + esc(p.note) + ' <button class="ghost" data-remove="' + i + '">移除此補充</button></p>'; }).join('');
        d.querySelectorAll('[data-remove]').forEach(function (b) { b.onclick = function () { if (confirm('移除此補充或修正？原 CMS 訂單資料會重新生效。')) saveSupplements(supplements.filter(function (_, i) { return i !== Number(b.dataset.remove); })); }; });
      }
      async function saveSupplements(items) {
        busy(d, true);
        try { await mutate({ action: 'adminSourceSupplements', sourceId: s.id, revision: s.revision, requestId: uid(), supplements: items }, d); d.remove(); activeDialog = null; message('補充與修正已保存，相關場次立即生效。'); }
        catch (e) { status(d, e.message, true); }
        finally { busy(d, false); }
      }
      renderSupplements();
      d.querySelector('#cmsAddPerson').onclick = function () {
        var form = document.createElement('div');
        form.innerHTML = '<hr><label>原始識別碼（修正既有訂單才填，見上方待確認資料）<input name="target" placeholder="例如：3246:訂單號碼"></label><label>姓名<input name="name" maxlength="120"></label><label>手機<input name="phone" inputmode="tel"></label><label>報名人數<input name="count" type="number" min="1" max="1000" value="1"></label><label>補充／修正原因<input name="note" maxlength="500"></label><label class="cms-check"><input name="exclude" type="checkbox"><span>排除此筆資格</span></label><div class="cms-actions"><button data-save>確認保存補充</button><button data-cancel class="ghost">取消</button></div>';
        d.querySelector('#cmsAddPerson').disabled = true; d.querySelector('#cmsSupplementList').appendChild(form);
        form.querySelector('[data-cancel]').onclick = function () { form.remove(); d.querySelector('#cmsAddPerson').disabled = false; };
        form.querySelector('[data-save]').onclick = function () {
          var val = function (n) { return form.querySelector('[name="' + n + '"]').value.trim(); };
          var target = val('target'), existing = supplements.find(function (x) { return target && x.targetKey === target; });
          var p = { key: existing ? existing.key : 'manual:' + uid(), targetKey: target, name: val('name'), phone: val('phone'), headcount: Number(val('count')), note: val('note'), excluded: form.querySelector('[name="exclude"]').checked };
          saveSupplements(supplements.filter(function (x) { return x !== existing; }).concat([p]));
        };
      };
      d.querySelector('#cmsRestore').onclick = async function () {
        var revision = Number(d.querySelector('#cmsHistory').value);
        if (revision === s.revision) { status(d, '這已是目前版本。'); return; }
        if (!confirm('將 CMS 名單復原到版本 ' + revision + '？目前人工修正與簽到紀錄會保留。')) return;
        busy(d, true);
        try { await mutate({ action: 'adminSourceRestore', sourceId: s.id, revision: s.revision, targetRevision: revision, requestId: uid() }, d); d.remove(); activeDialog = null; message('已復原 CMS 名單，並保存為新版本。'); }
        catch (e) { status(d, e.message, true); }
        finally { busy(d, false); }
      };
    } catch (e) { status(d, e.message, true); }
  }
  $('cmsImport').onclick = function () { importCourse(); };
  $('cmsNewEvent').onclick = function () { editEvent(); };
  $('cmsDetect').onclick = detect;
  $('cmsLogin').onclick = async function () { try { await bridge('login'); } catch (_) { window.open('https://cmsv.cmoney.tw/course?menu=menu-tab-0&application=7', '_blank', 'noopener'); } };
  $('cmsSources').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cms]'), card = e.target.closest('[data-source]'); if (!b || !card) return;
    var s = sources.find(function (s) { return s.id === card.dataset.source; });
    if (b.dataset.cms === 'update') importCourse(s); if (b.dataset.cms === 'event') editEvent(null, s.id); if (b.dataset.cms === 'detail') detail(s);
  });
  $('list').addEventListener('click', function (e) { var b = e.target.closest('[data-act="edit"]'); if (b) editEvent(state.events[Number(b.closest('[data-i]').dataset.i)]); });
  $('cmsPending').onclick = async function () {
    try {
      var p = JSON.parse(sessionStorage.getItem(PENDING)), result = await api({ action: 'adminImportStatus', requestId: p.requestId });
      if (result.status === 'success') { sessionStorage.removeItem(PENDING); pendingPayload = null; checkPending(); await loadSources(); await loadEvents(); message('已確認上次操作完成。'); }
      else if (pendingPayload) { await mutate(pendingPayload); message('原操作已完成。'); if (activeDialog) { activeDialog.remove(); activeDialog = null; } }
      else { message('尚未查到已完成的操作。若剛送出請稍後再確認；確定未完成後可重新讀取 CMS，系統會核對最新版本。', true); if (confirm('已確認上次未完成，要解除本機待確認提示並重新讀取名單？')) { sessionStorage.removeItem(PENDING); checkPending(); } }
    } catch (e) { message(e.message, true); }
  };
  $('logoutBtn').addEventListener('click', function () { pendingPayload = null; sources = []; if (activeDialog) activeDialog.remove(); activeDialog = null; });
  function demoBridge(action, p) {
    if (action === 'ping' || action === 'login') return { ok: true, version: 'demo' };
    if (action === 'courses') return { ok: true, total: 2, courses: [{ id: '99001', name: '示範課程 · 現場', teacher: '示範老師' }, { id: '99002', name: '示範課程 · 線上', teacher: '示範老師' }] };
    return { ok: true, name: p.courseId === '99002' ? '示範課程 · 線上' : '示範課程 · 現場', complete: true, expectedCount: 3, rows: [{ orderId: 'TEST-1', name: '測試學員甲', phone: '0912345678', headcount: 1, status: 1, courseAmount: 1000, updated: '' }, { orderId: 'TEST-2', name: '測試學員乙', phone: '0923456789', headcount: 0, status: 1, courseAmount: 0, updated: '' }, { orderId: 'TEST-3', name: '測試學員丙', phone: '0934567890', headcount: 1, status: 3, courseAmount: 1000, updated: '' }] };
  }
  function demoCms(p) {
    var s = demoState.sources.find(function (s) { return s.id === (p.sourceId || 'cms-' + p.courseId); });
    var stats = { rows: 3, paidOrders: 2, zeroAmount: 1, eligible: 1, people: 1, excluded: 2, invalid: 0, duplicates: 0, supplements: 0, orphaned: 0 };
    var issues = [{ key: (p.courseId || s?.courseId || '99001') + ':TEST-2', name: '測＊＊乙', message: '講座金額為 0，可能已調至其他場次，暫不納入' }];
    if (p.action === 'adminSources') return { status: 'success', sources: demoState.sources };
    if (p.action === 'adminImportPreview') return { status: 'success', token: 'demo', stats: stats, issues: issues, diff: { added: s ? 0 : 3, changed: 0, removed: 0 }, empty: false };
    if (p.action === 'adminImportCommit') { s = s || { id: 'cms-' + p.courseId, courseId: p.courseId, revision: 0, history: [] }; s.name = p.name; s.stats = stats; s.revision++; s.updated = new Date().toLocaleString('zh-TW'); s.history.unshift({ revision: s.revision, time: s.updated, reason: 'CMS 同步' }); if (!demoState.sources.includes(s)) demoState.sources.push(s); demoState.rows[s.id] = { supplements: [] }; keepDemo(); return { status: 'success', source: s }; }
    if (p.action === 'adminSourceDetail') return { status: 'success', source: s, issues: issues, supplements: demoState.rows[s.id]?.supplements || [] };
    if (p.action === 'adminSourceSupplements' || p.action === 'adminSourceRestore') { if (p.supplements) demoState.rows[s.id] = { supplements: p.supplements }; s.revision++; s.history.unshift({ revision: s.revision, time: new Date().toLocaleString('zh-TW'), reason: '示範操作' }); keepDemo(); return { status: 'success', source: s }; }
    if (p.action === 'adminEventSave') { var index = demoState.events.findIndex(function (e) { return e.code === p.event.code; }); var ev = Object.assign({}, p.event, { duplicate: false, editToken: 'demo' }); if (index < 0) demoState.events.push(ev); else demoState.events[index] = ev; keepDemo(); return { status: 'success', event: ev }; }
    return { status: 'not_found', message: '示範模式無待確認操作' };
  }
})();
