/* 抄表系統 — 前端主程式
 * 資料存在瀏覽器 localStorage；確認後的讀數會送到 Google Apps Script，寫入 Google 試算表。
 */
(() => {
  'use strict';

  // ---------- 儲存 ----------
  const KEYS = { locations: 'mr_locations', readings: 'mr_readings', settings: 'mr_settings' };
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  const state = {
    locations: load(KEYS.locations, []),
    readings: load(KEYS.readings, []),
    settings: Object.assign({ scriptUrl: '', secret: '', sheetUrl: '', reader: '', uploadPhoto: false }, load(KEYS.settings, {})),
  };
  const persist = () => {
    save(KEYS.locations, state.locations);
    save(KEYS.readings, state.readings);
    save(KEYS.settings, state.settings);
  };

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtTime = (iso) => {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const round = (n, dp) => Math.round(n * 10 ** dp) / 10 ** dp;

  function toast(msg, ms = 2500) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), ms);
  }

  // ---------- 讀數查詢 ----------
  const readingsOf = (locId) =>
    state.readings.filter((r) => r.locationId === locId).sort((a, b) => b.time.localeCompare(a.time));
  const lastReading = (locId) => readingsOf(locId)[0];
  const thisMonth = (iso) => {
    const d = new Date(iso), n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
  };
  const localDate = (d = new Date()) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  // 每日抄表看「今天」有沒有抄；其他看「本月」
  const isDone = (l) => {
    const today = localDate();
    return l.daily
      ? readingsOf(l.id).some((r) => (r.date || localDate(new Date(r.time))) === today)
      : !!(lastReading(l.id) && thisMonth(lastReading(l.id).time));
  };
  const avgUsage = (locId) => {
    const u = readingsOf(locId).slice(0, 6).map((r) => r.usage).filter((x) => typeof x === 'number' && x >= 0);
    return u.length ? u.reduce((a, b) => a + b, 0) / u.length : null;
  };

  // ---------- 路由 / 畫面 ----------
  const view = $('#view');
  const nav = { stack: [] };

  function setHeader(title, back) {
    $('#title').textContent = title;
    $('#backBtn').hidden = !back;
  }
  function setTab(tab) {
    document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  }
  function go(name, arg, push = true) {
    if (push) nav.stack.push([name, arg]);
    stopCamera();
    window.scrollTo(0, 0);
    VIEWS[name](arg);
  }
  function back() {
    nav.stack.pop();
    const prev = nav.stack[nav.stack.length - 1] || ['home'];
    go(prev[0], prev[1], false);
  }
  $('#backBtn').onclick = back;
  document.querySelectorAll('.tabbar button').forEach((b) => {
    b.onclick = () => { nav.stack = []; go(b.dataset.tab); };
  });

  const VIEWS = {
    home() {
      setHeader('抄表系統', false); setTab('home');
      const locs = state.locations;
      const doneCount = locs.filter(isDone).length;
      const allDaily = locs.length && locs.every((l) => l.daily);
      view.innerHTML = `
        <div class="card row">
          <div><div class="muted">${allDaily ? '今日進度' : '本月進度'}</div><div style="font-size:22px;font-weight:700">${doneCount} / ${locs.length}</div></div>
          <button class="btn small" id="addLoc">＋ 新增地點</button>
        </div>
        ${locs.length ? '' : `<div class="empty">尚未建立抄表地點<br>請點「新增地點」開始<br><br>
          <button class="btn small secondary" id="loadPreset">載入工務處抄表點（${PRESETS.length} 個）</button></div>`}
        ${locs.map((l) => {
          const r = lastReading(l.id);
          const done = isDone(l);
          return `<div class="card loc-item" data-id="${l.id}">
            <div class="info">
              <div class="name">${esc(l.name)}</div>
              <div class="meta">${esc([l.type, l.meterNo && '表號 ' + l.meterNo, l.sheet && l.sheet !== l.name && '→ ' + l.sheet].filter(Boolean).join('・'))}</div>
              <div class="meta">${r ? `上次 ${esc(r.value)} ${esc(l.unit || '')}（${fmtTime(r.time)}）` : '尚無紀錄'}</div>
            </div>
            ${done ? `<span class="done">✓ ${l.daily ? '今日' : '本月'}已抄</span>` : '<span class="todo">未抄 ›</span>'}
          </div>`;
        }).join('')}
        ${locs.length ? '<p class="muted" style="text-align:center">點地點開始拍照抄表；長按可編輯</p>' : ''}`;
      $('#addLoc').onclick = () => go('editLocation');
      if ($('#loadPreset')) $('#loadPreset').onclick = () => { loadPresets(); go('home', null, false); };
      view.querySelectorAll('.loc-item').forEach((el) => {
        let timer, long = false;
        const start = () => { long = false; timer = setTimeout(() => { long = true; go('editLocation', el.dataset.id); }, 600); };
        const cancel = () => clearTimeout(timer);
        el.addEventListener('touchstart', start, { passive: true });
        el.addEventListener('touchend', cancel);
        el.addEventListener('touchmove', cancel, { passive: true });
        el.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); go('editLocation', el.dataset.id); });
        el.addEventListener('click', () => { if (!long) go('camera', el.dataset.id); });
      });
    },

    editLocation(id) {
      const loc = state.locations.find((l) => l.id === id) || { type: '電錶', unit: '度', decimals: 0, counter: true };
      setHeader(id ? '編輯地點' : '新增地點', true); setTab('home');
      const col = (k, label, ph) => `<label class="field">${label}<input id="f_${k}" value="${esc(loc[k])}" placeholder="${ph}" autocapitalize="characters"></label>`;
      view.innerHTML = `
        <div class="card">
          <label class="field">地點名稱 *<input id="f_name" value="${esc(loc.name)}" placeholder="例如：A棟 3F 301室"></label>
          <label class="field">表別
            <select id="f_type">${['電錶', '水錶', '瓦斯錶', '油量', '其他'].map((t) => `<option ${t === loc.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
          </label>
          <label class="field">表號<input id="f_meterNo" value="${esc(loc.meterNo)}" placeholder="選填"></label>
          <div class="row">
            <label class="field">單位<input id="f_unit" value="${esc(loc.unit)}" placeholder="度 / m³"></label>
            <label class="field">小數位數<input id="f_decimals" type="number" min="0" max="4" value="${loc.decimals ?? 0}"></label>
          </div>
          <label class="check"><input type="checkbox" id="f_counter" ${loc.counter !== false ? 'checked' : ''}> 累計型讀數（計算用量、讀數倒退時提醒）</label>
          <label class="check"><input type="checkbox" id="f_daily" ${loc.daily ? 'checked' : ''}> 每日抄表（首頁顯示「今日」進度）</label>
          <label class="field">起始讀數（選填，作為第一次的上期讀數）<input id="f_initial" inputmode="decimal" value="${esc(loc.initial)}"></label>
          <label class="field">備註<textarea id="f_note" rows="2">${esc(loc.note)}</textarea></label>
        </div>
        <div class="card">
          <h2>寫入既有工作表（選填）</h2>
          <p class="muted">填寫後，讀數會依日期寫進該工作表對應的那一列；留空則只記錄到「抄表紀錄」工作表。</p>
          <label class="field">工作表名稱<input id="f_sheet" value="${esc(loc.sheet)}" placeholder="例如：R1F軟水-1"></label>
          <div class="row">
            ${col('dateCol', '日期欄', 'A')}
            ${col('valueCol', '讀數欄', 'C')}
          </div>
          <div class="row">
            ${col('signCol', '簽名欄', 'D')}
            ${col('noteCol', '備註欄', 'E')}
          </div>
          <label class="field">列位移（同一天有多列時，例如中班＝1）<input id="f_rowOffset" type="number" min="0" max="20" value="${loc.rowOffset ?? 0}"></label>
        </div>
        <button class="btn" id="saveLoc">儲存</button>
        ${id ? '<div class="spacer"></div><button class="btn danger" id="delLoc">刪除此地點</button>' : ''}
        <p class="muted">「小數位數」：若錶面最後幾位是小數（常見紅色字輪），辨識到的數字沒有小數點時會自動補上。</p>`;
      $('#saveLoc').onclick = () => {
        const name = $('#f_name').value.trim();
        if (!name) return toast('請輸入地點名稱');
        const initial = $('#f_initial').value.trim();
        if (initial && isNaN(Number(initial))) return toast('起始讀數必須是數字');
        const colVal = (k) => $('#f_' + k).value.trim().toUpperCase();
        for (const k of ['dateCol', 'valueCol', 'signCol', 'noteCol']) {
          if (colVal(k) && !/^[A-Z]{1,2}$/.test(colVal(k))) return toast('欄位請填英文字母，例如 C');
        }
        const sheet = $('#f_sheet').value.trim();
        if (sheet && !colVal('valueCol')) return toast('請填寫讀數欄');
        const data = {
          id: loc.id || uid(), name,
          type: $('#f_type').value, meterNo: $('#f_meterNo').value.trim(),
          unit: $('#f_unit').value.trim(),
          decimals: Math.max(0, Math.min(4, parseInt($('#f_decimals').value, 10) || 0)),
          counter: $('#f_counter').checked, daily: $('#f_daily').checked,
          initial, note: $('#f_note').value.trim(),
          sheet, dateCol: colVal('dateCol') || 'A', valueCol: colVal('valueCol'),
          signCol: colVal('signCol'), noteCol: colVal('noteCol'),
          rowOffset: Math.max(0, parseInt($('#f_rowOffset').value, 10) || 0),
        };
        const i = state.locations.findIndex((l) => l.id === data.id);
        if (i >= 0) state.locations[i] = data; else state.locations.push(data);
        persist(); toast('已儲存'); nav.stack = []; go('home');
      };
      if (id) $('#delLoc').onclick = () => {
        if (!confirm(`確定刪除「${loc.name}」？（已送出的試算表資料不受影響）`)) return;
        state.locations = state.locations.filter((l) => l.id !== id);
        persist(); nav.stack = []; go('home');
      };
    },

    camera(locId) {
      const loc = state.locations.find((l) => l.id === locId);
      setHeader('拍照', true);
      view.innerHTML = '';
      view.appendChild($('#tpl-camera').content.cloneNode(true));
      $('#camLoc').textContent = loc.name;
      const camEl = $('.camera');
      // 相機畫面蓋在最上層，加一顆返回鍵
      const backBtn = document.createElement('button');
      backBtn.className = 'icon-btn light'; backBtn.textContent = '✕'; backBtn.setAttribute('aria-label', '關閉');
      backBtn.onclick = back;
      $('.cam-top', camEl).prepend(backBtn);

      startCamera($('#video')).then((track) => {
        const caps = track && track.getCapabilities ? track.getCapabilities() : {};
        if (caps.torch) {
          const tb = $('#torchBtn'); tb.hidden = false;
          let on = false;
          tb.onclick = () => { on = !on; track.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {}); };
        }
      }).catch((err) => {
        console.warn(err);
        toast('無法開啟相機，請改用「選照片」或確認網址為 https', 4000);
      });

      const ocrFailed = (e) => { console.error(e); return { value: '', raw: '', confidence: 0, error: e.message || String(e) }; };
      const busy = (on, text) => { $('#camBusy').hidden = !on; if (text) $('#busyText').textContent = text; };

      $('#shutterBtn').onclick = async () => {
        const video = $('#video');
        if (!video.videoWidth) return toast('相機尚未就緒');
        const crop = cropGuide(video, $('#guide'));
        busy(true, '辨識中…');
        const result = await recognize(crop, loc).catch(ocrFailed);
        busy(false);
        go('confirm', { locId, crop: crop.toDataURL('image/jpeg', 0.8), ocr: result });
      };

      $('#fileInput').onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        busy(true, '辨識中…');
        const img = await fileToImage(f);
        const canvas = downscale(img, 1600);
        const result = await recognize(canvas, loc, true).catch(ocrFailed);
        busy(false);
        go('confirm', { locId, crop: canvas.toDataURL('image/jpeg', 0.7), ocr: result });
      };

      $('#manualBtn').onclick = () => go('confirm', { locId, crop: null, ocr: null });
    },

    confirm({ locId, crop, ocr }) {
      const loc = state.locations.find((l) => l.id === locId);
      const last = lastReading(locId);
      let prev = last ? Number(last.value) : (loc.initial !== '' && loc.initial != null ? Number(loc.initial) : null);
      let prevLabel = '上期讀數';
      let existing = null;
      const counter = loc.counter !== false;
      const avg = avgUsage(locId);
      setHeader('確認讀數', true);
      view.innerHTML = `
        <div class="card">
          <h2>${esc(loc.name)} <span class="muted">${esc(loc.type || '')}</span></h2>
          ${crop ? `<img class="preview" src="${crop}" alt="拍攝畫面">` : ''}
          <div class="spacer"></div>
          <label class="field">本期讀數 ${loc.unit ? '（' + esc(loc.unit) + '）' : ''}
            <input id="val" class="reading-input" inputmode="decimal" autocomplete="off" value="${esc(ocr?.value ?? '')}" placeholder="請輸入">
          </label>
          ${ocr ? `<div class="conf">${ocr.error ? `自動辨識無法使用（${esc(ocr.error)}），請手動輸入` : ocr.value ? `自動辨識結果（信心 ${Math.round(ocr.confidence)}%）・原文：${esc(ocr.raw || '—')}` : '未能辨識出數字，請手動輸入'}</div>` : ''}
          ${counter ? `<div class="stats">
            <div class="stat"><div class="k" id="prevK">上期讀數</div><div class="v" id="prevV">—</div></div>
            <div class="stat"><div class="k">本期用量</div><div class="v" id="usage">—</div></div>
          </div>` : ''}
          ${loc.sheet ? `<label class="field">抄表日期<input id="date" type="date" value="${localDate()}"></label>
            <div class="muted" id="target" style="margin:-6px 0 12px">寫入：${esc(loc.sheet)}</div>` : ''}
          <div id="warns"></div>
          <label class="field">備註<input id="note" placeholder="選填"></label>
          <div class="row">
            <button class="btn secondary" id="retake">重拍</button>
            <button class="btn" id="ok">確認送出</button>
          </div>
        </div>`;

      const valEl = $('#val');
      const update = () => {
        const v = valEl.value.trim();
        const n = Number(v);
        const warns = [];
        let usage = null;
        if (counter) {
          $('#prevK').textContent = prevLabel;
          $('#prevV').textContent = prev ?? '—';
          $('#usage').textContent = '—';
          if (v !== '' && !isNaN(n) && prev != null) {
            usage = round(n - prev, loc.decimals || 0);
            $('#usage').textContent = usage;
            if (usage < 0) warns.push('讀數小於上期，可能辨識錯誤或水錶已歸零/更換，請再次核對。');
            else if (avg && avg > 0 && usage > avg * 3) warns.push(`用量為平均（${round(avg, 1)}）的 ${round(usage / avg, 1)} 倍，請再次核對。`);
          }
        }
        if (existing != null && existing !== '') warns.push(`工作表這一格已有數值 ${existing}，送出會詢問是否覆蓋。`);
        if (ocr && ocr.value && ocr.confidence < 60) warns.push('辨識信心偏低，請仔細比對照片。');
        $('#warns').innerHTML = warns.map((w) => `<div class="warn">⚠️ ${esc(w)}</div>`).join('');
        return { v, n, usage, warns };
      };
      valEl.oninput = update;
      update();
      if (!ocr || !ocr.value) valEl.focus();

      // 從工作表查上期讀數與該格現有數值
      const refresh = async () => {
        if (!loc.sheet || !state.settings.scriptUrl) return;
        $('#target').textContent = `寫入：${loc.sheet}（查詢中…）`;
        try {
          const j = await api('lookup', { ...targetOf(loc), date: $('#date').value });
          if (!j.ok) throw new Error(j.error);
          $('#target').textContent = `寫入：${j.cell}`;
          existing = j.existing;
          if (j.prev != null) { prev = Number(j.prev); prevLabel = `上期讀數（${j.prevDate || '工作表'}）`; }
        } catch (e) {
          $('#target').textContent = `寫入：${loc.sheet}（⚠️ ${e.message}）`;
        }
        update();
      };
      if (loc.sheet) { $('#date').onchange = () => { existing = null; refresh(); }; refresh(); }

      $('#retake').onclick = back;
      $('#ok').onclick = async () => {
        const { v, n, usage, warns } = update();
        if (v === '' || isNaN(n)) return toast('請輸入正確的數字');
        const soft = warns.filter((w) => !w.startsWith('工作表這一格'));
        if (soft.length && !confirm(`${soft.join('\n')}\n\n確定要送出 ${v} 嗎？`)) return;
        const now = new Date();
        const rec = {
          id: uid(), locationId: loc.id, locationName: loc.name, type: loc.type || '',
          meterNo: loc.meterNo || '', unit: loc.unit || '',
          value: n, prev: counter ? prev : null, usage, time: now.toISOString(),
          date: loc.sheet ? $('#date').value : localDate(now),
          target: loc.sheet ? targetOf(loc) : null, overwrite: false,
          reader: state.settings.reader || '', note: $('#note').value.trim(),
          ocrValue: ocr?.value ?? '', ocrConfidence: ocr ? Math.round(ocr.confidence) : '',
          photo: state.settings.uploadPhoto && crop ? crop : null,
          synced: false,
        };
        state.readings.push(rec);
        persist();
        $('#ok').disabled = true;
        let res = await syncOne(rec);
        if (res.status === 'exists') {
          if (confirm(`${res.cell} 已有數值 ${res.existing}\n要改成 ${v} 嗎？`)) {
            rec.overwrite = true; delete rec.conflict;
            res = await syncOne(rec);
          } else {
            rec.synced = true; rec.skipped = true; rec.photo = null; delete rec.conflict;
            persist(); updateBadge();
            toast('未寫入工作表（保留原數值），已記錄在本機', 3000);
            nav.stack = []; return go('home');
          }
        }
        toast(res.status === 'ok' ? `✅ 已寫入 ${res.cell || '試算表'}`
          : res.status === 'error' ? `❌ ${res.error}（已暫存，可到「紀錄」補送）`
          : (state.settings.scriptUrl ? '⚠️ 已暫存，網路恢復後會自動補送' : '已儲存在本機（尚未設定試算表）'), 3500);
        nav.stack = []; go('home');
      };
    },

    history() {
      setHeader('抄表紀錄', false); setTab('history');
      const rows = [...state.readings].sort((a, b) => b.time.localeCompare(a.time));
      const pending = rows.filter((r) => !r.synced).length;
      view.innerHTML = `
        <div class="card row">
          <button class="btn small secondary" id="csv">⬇️ 匯出 CSV</button>
          <button class="btn small" id="sync" ${pending ? '' : 'disabled'}>⟳ 補送 ${pending} 筆</button>
        </div>
        ${rows.length ? `<div class="card"><table class="hist">
          <tr><th></th><th>時間</th><th>地點</th><th style="text-align:right">讀數</th><th style="text-align:right">用量</th></tr>
          ${rows.map((r) => `<tr>
            <td><span class="dot ${r.skipped ? 'skip' : r.synced ? '' : r.conflict || r.error ? 'error' : 'pending'}" title="${esc(r.skipped ? '未寫入（保留原值）' : r.synced ? r.cell || '已同步' : r.conflict ? '工作表已有數值' : r.error || '未同步')}"></span></td>
            <td>${fmtTime(r.time)}</td><td>${esc(r.locationName)}${r.error ? `<div class="muted">${esc(r.error)}</div>` : r.conflict ? `<div class="muted">${esc(r.conflict.cell)} 已有 ${esc(r.conflict.existing)}</div>` : ''}</td>
            <td class="num">${esc(r.value)}</td><td class="num">${r.usage ?? '—'}</td></tr>`).join('')}
        </table></div>
        <p class="muted"><span class="dot"></span> 已寫入試算表　<span class="dot pending"></span> 尚未同步　<span class="dot error"></span> 需處理（點「補送」）　<span class="dot skip"></span> 保留工作表原值</p>` : '<div class="empty">尚無紀錄</div>'}`;
      $('#csv').onclick = exportCsv;
      $('#sync').onclick = async () => { await syncAll(true); go('history', null, false); };
    },

    settings() {
      setHeader('設定', false); setTab('settings');
      const s = state.settings;
      view.innerHTML = `
        <div class="card">
          <h2>Google 試算表連線</h2>
          <label class="field">Apps Script 網址<input id="s_url" value="${esc(s.scriptUrl)}" placeholder="https://script.google.com/macros/s/…/exec"></label>
          <label class="field">密鑰（需與 Apps Script 中的 SECRET 相同）<input id="s_secret" value="${esc(s.secret)}"></label>
          <label class="field">試算表網址（每月換新檔時更新這裡；留空＝Apps Script 所在的試算表）<input id="s_sheet" value="${esc(s.sheetUrl)}" placeholder="https://docs.google.com/spreadsheets/d/…"></label>
          <label class="check"><input type="checkbox" id="s_photo" ${s.uploadPhoto ? 'checked' : ''}> 同時上傳照片到 Google 雲端硬碟</label>
          <div class="row">
            <button class="btn secondary" id="test">測試連線</button>
            <button class="btn" id="saveS">儲存</button>
          </div>
        </div>
        <div class="card">
          <h2>抄表人</h2>
          <label class="field">姓名（會寫入試算表）<input id="s_reader" value="${esc(s.reader)}"></label>
        </div>
        <div class="card">
          <h2>資料備份</h2>
          <p class="muted">將地點清單匯出成檔案，可在其他手機匯入使用。</p>
          <button class="btn secondary" id="preset">載入工務處抄表點（${PRESETS.length} 個，已存在的不重複加入）</button>
          <div class="spacer"></div>
          <div class="row">
            <button class="btn secondary" id="exp">匯出地點</button>
            <label class="btn secondary">匯入地點<input type="file" accept="application/json,.json" id="imp" hidden></label>
          </div>
        </div>`;
      const collect = () => {
        s.scriptUrl = $('#s_url').value.trim();
        s.secret = $('#s_secret').value.trim();
        s.sheetUrl = $('#s_sheet').value.trim();
        s.reader = $('#s_reader').value.trim();
        s.uploadPhoto = $('#s_photo').checked;
      };
      $('#saveS').onclick = () => { collect(); persist(); toast('已儲存'); syncAll(); };
      $('#test').onclick = async () => {
        collect();
        if (!s.scriptUrl) return toast('請先填寫 Apps Script 網址');
        try {
          const j = await api('ping');
          if (!j.ok) return toast(`❌ ${j.error || '失敗'}`, 4000);
          const missing = [...new Set(state.locations.map((l) => l.sheet).filter(Boolean))].filter((n) => !j.sheets.includes(n));
          toast(missing.length ? `⚠️ 已連線「${j.spreadsheet}」，但找不到工作表：${missing.join('、')}` : `✅ 連線成功：${j.spreadsheet}`, 6000);
        } catch (e) { toast('❌ 無法連線：' + e.message, 4000); }
      };
      $('#preset').onclick = () => { const n = loadPresets(); toast(`已加入 ${n} 個抄表點`); };
      $('#exp').onclick = () => download('抄表地點.json', JSON.stringify(state.locations, null, 2), 'application/json');
      $('#imp').onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try {
          const list = JSON.parse(await f.text());
          if (!Array.isArray(list)) throw new Error('格式錯誤');
          let added = 0;
          for (const l of list) {
            if (!l || !l.name) continue;
            const i = state.locations.findIndex((x) => x.id === l.id);
            if (i >= 0) state.locations[i] = l; else { state.locations.push({ ...l, id: l.id || uid() }); added++; }
          }
          persist(); toast(`已匯入（新增 ${added} 筆）`);
        } catch (er) { toast('匯入失敗：' + er.message); }
      };
    },
  };

  // ---------- 相機 ----------
  let stream = null;
  async function startCamera(video) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('不支援相機');
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    video.srcObject = stream;
    await video.play().catch(() => {});
    return stream.getVideoTracks()[0];
  }
  function stopCamera() {
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  }

  // 依照畫面上的對準框，從影片原始解析度中裁切出對應區域（考慮 object-fit: cover）
  function cropGuide(video, guide) {
    const vr = video.getBoundingClientRect();
    const gr = guide.getBoundingClientRect();
    const vw = video.videoWidth, vh = video.videoHeight;
    const scale = Math.max(vr.width / vw, vr.height / vh);
    const ox = (vr.width - vw * scale) / 2, oy = (vr.height - vh * scale) / 2;
    const sx = Math.max(0, (gr.left - vr.left - ox) / scale);
    const sy = Math.max(0, (gr.top - vr.top - oy) / scale);
    const sw = Math.min(vw - sx, gr.width / scale);
    const sh = Math.min(vh - sy, gr.height / scale);
    const c = document.createElement('canvas');
    c.width = Math.round(sw); c.height = Math.round(sh);
    c.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }

  function fileToImage(file) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(img.src); res(img); };
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }
  function downscale(img, max) {
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  // ---------- OCR ----------
  // 前處理：放大、灰階、Otsu 二值化，並確保是「白底黑字」
  function preprocess(src) {
    const targetH = 160;
    const s = Math.max(1, Math.min(4, targetH / src.height));
    const c = document.createElement('canvas');
    c.width = Math.round(src.width * s); c.height = Math.round(src.height * s);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    const gray = new Uint8ClampedArray(c.width * c.height);
    const hist = new Array(256).fill(0);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
      gray[j] = g; hist[g]++;
    }
    // Otsu
    const total = gray.length;
    let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0, wB = 0, best = 0, thr = 127;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) ** 2;
      if (between > best) { best = between; thr = t; }
    }
    let dark = 0;
    for (let j = 0; j < gray.length; j++) if (gray[j] <= thr) dark++;
    const invert = dark > total / 2; // 深色背景（如液晶、黑底字輪）→ 反轉
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      let v = gray[j] > thr ? 255 : 0;
      if (invert) v = 255 - v;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
    // 加白邊，Tesseract 對貼邊文字辨識較差
    const pad = 20;
    const out = document.createElement('canvas');
    out.width = c.width + pad * 2; out.height = c.height + pad * 2;
    const octx = out.getContext('2d');
    octx.fillStyle = '#fff'; octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(c, pad, pad);
    return out;
  }

  let workerPromise = null;
  function getWorker() {
    if (!window.Tesseract) return Promise.reject(new Error('OCR 元件載入失敗'));
    if (!workerPromise) {
      workerPromise = (async () => {
        const w = await Tesseract.createWorker('eng');
        await w.setParameters({ tessedit_char_whitelist: '0123456789.' });
        return w;
      })().catch((e) => { workerPromise = null; throw e; });
    }
    return workerPromise;
  }

  function extractNumber(text, decimals) {
    const cleaned = String(text).replace(/[^\d.\n ]/g, '').replace(/\s+/g, ' ');
    // 取最長的數字串（錶面上通常讀數是最長的那串）
    const cands = cleaned.replace(/ /g, '\n').split('\n')
      .map((x) => x.replace(/^\.+|\.+$/g, '').replace(/\.(?=.*\.)/g, ''))
      .filter((x) => /\d/.test(x));
    if (!cands.length) {
      // 數字之間被空白隔開時，合併整行再試一次
      const joined = cleaned.replace(/[ \n]/g, '').replace(/^\.+|\.+$/g, '');
      return /\d/.test(joined) ? joined : '';
    }
    let best = cands.sort((a, b) => b.replace('.', '').length - a.replace('.', '').length)[0];
    if (decimals > 0 && !best.includes('.') && best.length > decimals) {
      best = best.slice(0, -decimals) + '.' + best.slice(-decimals);
    }
    // 去除前導 0（保留 "0.xx"）
    best = best.replace(/^0+(?=\d)/, '');
    return best;
  }

  async function recognize(canvas, loc, wholeImage = false) {
    const worker = await getWorker();
    const img = preprocess(canvas);
    // PSM 7 = 單行文字；整張照片則用 PSM 11（零散文字）
    await worker.setParameters({ tessedit_pageseg_mode: wholeImage ? '11' : '7' });
    let { data } = await worker.recognize(img);
    let value = extractNumber(data.text, loc.decimals || 0);
    if (!value && !wholeImage) {
      // 單行失敗時，退而用整塊模式再辨識一次
      await worker.setParameters({ tessedit_pageseg_mode: '6' });
      ({ data } = await worker.recognize(img));
      value = extractNumber(data.text, loc.decimals || 0);
    }
    return { value, raw: data.text.trim(), confidence: data.confidence || 0 };
  }

  // ---------- 同步到 Google 試算表 ----------
  // 從試算表網址取出 ID；留空則由 Apps Script 使用它所綁定的試算表
  const sheetId = () => {
    const u = state.settings.sheetUrl || '';
    const m = u.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
    return m ? m[1] : u.trim();
  };
  const targetOf = (loc) => ({
    sheet: loc.sheet, dateCol: loc.dateCol || 'A', valueCol: loc.valueCol,
    signCol: loc.signCol || '', noteCol: loc.noteCol || '', rowOffset: loc.rowOffset || 0,
  });
  async function api(action, params = {}, body = null) {
    const s = state.settings;
    if (!s.scriptUrl) throw new Error('尚未設定 Apps Script 網址');
    let res;
    if (body) {
      // 使用 text/plain 避免 CORS 預檢（Apps Script 不支援 OPTIONS）
      res = await fetch(s.scriptUrl, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, secret: s.secret, sheetId: sheetId(), ...body }),
      });
    } else {
      const q = new URLSearchParams({ action, secret: s.secret, sheetId: sheetId(), ...params });
      res = await fetch(`${s.scriptUrl}?${q}`);
    }
    return res.json();
  }

  let syncing = false;
  // 回傳 { status: 'ok' | 'exists' | 'error' | 'offline', ... }
  async function syncOne(rec) {
    if (!state.settings.scriptUrl) { updateBadge(); return { status: 'offline' }; }
    const { photo, synced, conflict, skipped, ...record } = rec;
    let j;
    try {
      j = await api('write', {}, { record, photo: photo || undefined });
    } catch (e) {
      console.warn('sync failed', e);
      updateBadge();
      return { status: 'offline' };
    }
    if (j.ok) {
      rec.synced = true; rec.photo = null; rec.cell = j.cell || '';
      delete rec.conflict; delete rec.error;
      persist(); updateBadge();
      return { status: 'ok', cell: j.cell };
    }
    if (j.code === 'exists') {
      rec.conflict = { cell: j.cell, existing: j.existing };
      persist(); updateBadge();
      return { status: 'exists', cell: j.cell, existing: j.existing };
    }
    rec.error = j.error || '寫入失敗';
    persist(); updateBadge();
    return { status: 'error', error: rec.error };
  }
  async function syncAll(manual = false) {
    if (syncing || !state.settings.scriptUrl) { if (manual && !state.settings.scriptUrl) toast('請先到「設定」填寫 Apps Script 網址'); return; }
    syncing = true;
    let ok = 0, fail = 0;
    for (const r of state.readings.filter((x) => !x.synced)) {
      // 有衝突的紀錄只在手動補送時詢問，避免自動覆蓋別人填的數值
      if (r.conflict) {
        if (!manual) { fail++; continue; }
        if (!confirm(`${r.locationName}（${r.date}）\n${r.conflict.cell} 已有數值 ${r.conflict.existing}\n要改成 ${r.value} 嗎？\n\n按「取消」保留工作表原數值`)) {
          r.synced = true; r.skipped = true; r.photo = null; delete r.conflict; persist(); continue;
        }
        r.overwrite = true;
      }
      const res = await syncOne(r);
      if (res.status === 'ok') ok++; else fail++;
    }
    syncing = false;
    updateBadge();
    if (manual || ok) toast(fail ? `補送成功 ${ok} 筆，未完成 ${fail} 筆` : `已補送 ${ok} 筆到試算表`);
  }
  function updateBadge() {
    const n = state.readings.filter((r) => !r.synced).length;
    const b = $('#syncBadge');
    b.hidden = !n;
    b.textContent = `未同步 ${n}`;
  }
  $('#syncBadge').onclick = () => syncAll(true);
  window.addEventListener('online', () => syncAll());

  // ---------- 匯出 ----------
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function exportCsv() {
    const head = ['抄表日期', '寫入位置', '抄表時間', '地點', '表別', '表號', '本期讀數', '上期讀數', '用量', '單位', '抄表人', '備註', 'OCR辨識值', 'OCR信心'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [...state.readings].sort((a, b) => a.time.localeCompare(b.time)).map((r) =>
      [r.date || '', r.cell || '', fmtTime(r.time), r.locationName, r.type, r.meterNo, r.value, r.prev, r.usage, r.unit, r.reader, r.note, r.ocrValue, r.ocrConfidence].map(q).join(','));
    download(`抄表紀錄_${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + [head.map(q).join(','), ...lines].join('\r\n'), 'text/csv');
  }

  // ---------- 預設抄表點（對應「工務處每日紀錄表」活頁簿） ----------
  // 標準水錶工作表：第 6 列起每天一列，A＝日期、C＝累計度數、D＝簽名、E＝備註
  const WATER_SHEETS = [
    'R1F軟水-1', '5F-RO純水', '5F-雙RO純水', '空調冷卻用水(戶外)',
    '汙廢水池水錶-1', '汙廢水池水錶-2', '汙廢水池水錶-3', '水箱水總錶',
    '中層清潔水', '高層清潔水', '澆灌用水', '消防水池水錶', '沖刷水池水錶', '水舞用水', '熱泵用水',
  ];
  const PRESETS = [
    ...WATER_SHEETS.map((sheet) => ({
      key: 'preset:' + sheet, name: sheet, type: '水錶', unit: 'm³', decimals: 0, counter: true, daily: true,
      sheet, dateCol: 'A', valueCol: 'C', signCol: 'D', noteCol: 'E', rowOffset: 0,
    })),
    // 發電機油箱：早班 A/B/C 欄、中班 E/F/G 欄，油量會下降所以不是累計型
    { key: 'preset:發電機油箱-早', name: '發電機油箱（早班）', type: '油量', unit: 'L', decimals: 0, counter: false, daily: true,
      sheet: '發電機油箱', dateCol: 'A', valueCol: 'B', signCol: 'C', noteCol: '', rowOffset: 0 },
    { key: 'preset:發電機油箱-中', name: '發電機油箱（中班）', type: '油量', unit: 'L', decimals: 0, counter: false, daily: true,
      sheet: '發電機油箱', dateCol: 'E', valueCol: 'F', signCol: 'G', noteCol: '', rowOffset: 0 },
  ];
  function loadPresets() {
    let n = 0;
    for (const p of PRESETS) {
      if (state.locations.some((l) => l.key === p.key || (l.sheet === p.sheet && l.valueCol === p.valueCol))) continue;
      state.locations.push({ ...p, id: uid(), meterNo: '', initial: '', note: '' });
      n++;
    }
    persist();
    return n;
  }

  // ---------- 啟動 ----------
  go('home');
  updateBadge();
  syncAll();
  // 預先載入 OCR 引擎，第一次拍照時不必等待
  setTimeout(() => getWorker().catch(() => {}), 1500);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
