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
    settings: Object.assign({ scriptUrl: '', secret: '', reader: '', uploadPhoto: false }, load(KEYS.settings, {})),
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
      const doneCount = locs.filter((l) => { const r = lastReading(l.id); return r && thisMonth(r.time); }).length;
      view.innerHTML = `
        <div class="card row">
          <div><div class="muted">本月進度</div><div style="font-size:22px;font-weight:700">${doneCount} / ${locs.length}</div></div>
          <button class="btn small" id="addLoc">＋ 新增地點</button>
        </div>
        ${locs.length ? '' : '<div class="empty">尚未建立抄表地點<br>請點「新增地點」開始</div>'}
        ${locs.map((l) => {
          const r = lastReading(l.id);
          const done = r && thisMonth(r.time);
          return `<div class="card loc-item" data-id="${l.id}">
            <div class="info">
              <div class="name">${esc(l.name)}</div>
              <div class="meta">${esc([l.type, l.meterNo && '表號 ' + l.meterNo].filter(Boolean).join('・'))}</div>
              <div class="meta">${r ? `上次 ${esc(r.value)} ${esc(l.unit || '')}（${fmtTime(r.time)}）` : '尚無紀錄'}</div>
            </div>
            ${done ? '<span class="done">✓ 本月已抄</span>' : '<span class="todo">未抄 ›</span>'}
          </div>`;
        }).join('')}
        ${locs.length ? '<p class="muted" style="text-align:center">點地點開始拍照抄表；長按可編輯</p>' : ''}`;
      $('#addLoc').onclick = () => go('editLocation');
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
      const loc = state.locations.find((l) => l.id === id) || { type: '電錶', unit: '度', decimals: 0 };
      setHeader(id ? '編輯地點' : '新增地點', true); setTab('home');
      view.innerHTML = `
        <div class="card">
          <label class="field">地點名稱 *<input id="f_name" value="${esc(loc.name)}" placeholder="例如：A棟 3F 301室"></label>
          <label class="field">表別
            <select id="f_type">${['電錶', '水錶', '瓦斯錶', '其他'].map((t) => `<option ${t === loc.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
          </label>
          <label class="field">表號<input id="f_meterNo" value="${esc(loc.meterNo)}" placeholder="選填"></label>
          <div class="row">
            <label class="field">單位<input id="f_unit" value="${esc(loc.unit)}" placeholder="度 / m³"></label>
            <label class="field">小數位數<input id="f_decimals" type="number" min="0" max="4" value="${loc.decimals ?? 0}"></label>
          </div>
          <label class="field">起始讀數（選填，作為第一次的上期讀數）<input id="f_initial" inputmode="decimal" value="${esc(loc.initial)}"></label>
          <label class="field">備註<textarea id="f_note" rows="2">${esc(loc.note)}</textarea></label>
          <button class="btn" id="saveLoc">儲存</button>
          ${id ? '<div class="spacer"></div><button class="btn danger" id="delLoc">刪除此地點</button>' : ''}
        </div>
        <p class="muted">「小數位數」：若錶面最後幾位是小數（常見紅色字輪），辨識到的數字沒有小數點時會自動補上。</p>`;
      $('#saveLoc').onclick = () => {
        const name = $('#f_name').value.trim();
        if (!name) return toast('請輸入地點名稱');
        const initial = $('#f_initial').value.trim();
        if (initial && isNaN(Number(initial))) return toast('起始讀數必須是數字');
        const data = {
          id: loc.id || uid(), name,
          type: $('#f_type').value, meterNo: $('#f_meterNo').value.trim(),
          unit: $('#f_unit').value.trim(),
          decimals: Math.max(0, Math.min(4, parseInt($('#f_decimals').value, 10) || 0)),
          initial, note: $('#f_note').value.trim(),
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
      const prev = last ? Number(last.value) : (loc.initial !== '' && loc.initial != null ? Number(loc.initial) : null);
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
          <div class="stats">
            <div class="stat"><div class="k">上期讀數</div><div class="v">${prev ?? '—'}</div></div>
            <div class="stat"><div class="k">本期用量</div><div class="v" id="usage">—</div></div>
          </div>
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
        if (v === '' || isNaN(n)) {
          $('#usage').textContent = '—';
        } else if (prev != null) {
          usage = round(n - prev, loc.decimals || 0);
          $('#usage').textContent = usage;
          if (usage < 0) warns.push('讀數小於上期，可能辨識錯誤或電錶已歸零/更換，請再次核對。');
          else if (avg && avg > 0 && usage > avg * 3) warns.push(`用量為平均（${round(avg, 1)}）的 ${round(usage / avg, 1)} 倍，請再次核對。`);
        } else {
          $('#usage').textContent = '—';
        }
        if (ocr && ocr.value && ocr.confidence < 60) warns.push('辨識信心偏低，請仔細比對照片。');
        $('#warns').innerHTML = warns.map((w) => `<div class="warn">⚠️ ${esc(w)}</div>`).join('');
        return { v, n, usage, warns };
      };
      valEl.oninput = update;
      update();
      if (!ocr || !ocr.value) valEl.focus();

      $('#retake').onclick = back;
      $('#ok').onclick = async () => {
        const { v, n, usage, warns } = update();
        if (v === '' || isNaN(n)) return toast('請輸入正確的數字');
        if (warns.length && !confirm(`${warns.join('\n')}\n\n確定要送出 ${v} 嗎？`)) return;
        const rec = {
          id: uid(), locationId: loc.id, locationName: loc.name, type: loc.type || '',
          meterNo: loc.meterNo || '', unit: loc.unit || '',
          value: n, prev, usage, time: new Date().toISOString(),
          reader: state.settings.reader || '', note: $('#note').value.trim(),
          ocrValue: ocr?.value ?? '', ocrConfidence: ocr ? Math.round(ocr.confidence) : '',
          photo: state.settings.uploadPhoto && crop ? crop : null,
          synced: false,
        };
        state.readings.push(rec);
        persist();
        $('#ok').disabled = true;
        const ok = await syncOne(rec);
        toast(ok ? '✅ 已寫入試算表' : (state.settings.scriptUrl ? '⚠️ 已暫存，網路恢復後會自動補送' : '已儲存在本機（尚未設定試算表）'), 3000);
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
            <td><span class="dot ${r.synced ? '' : 'pending'}" title="${r.synced ? '已同步' : '未同步'}"></span></td>
            <td>${fmtTime(r.time)}</td><td>${esc(r.locationName)}</td>
            <td class="num">${esc(r.value)}</td><td class="num">${r.usage ?? '—'}</td></tr>`).join('')}
        </table></div>
        <p class="muted">● 綠色＝已寫入試算表　● 黃色＝尚未同步</p>` : '<div class="empty">尚無紀錄</div>'}`;
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
          <div class="row">
            <button class="btn secondary" id="exp">匯出地點</button>
            <label class="btn secondary">匯入地點<input type="file" accept="application/json,.json" id="imp" hidden></label>
          </div>
        </div>`;
      const collect = () => {
        s.scriptUrl = $('#s_url').value.trim();
        s.secret = $('#s_secret').value.trim();
        s.reader = $('#s_reader').value.trim();
        s.uploadPhoto = $('#s_photo').checked;
      };
      $('#saveS').onclick = () => { collect(); persist(); toast('已儲存'); syncAll(); };
      $('#test').onclick = async () => {
        collect();
        if (!s.scriptUrl) return toast('請先填寫 Apps Script 網址');
        try {
          const res = await fetch(`${s.scriptUrl}?action=ping&secret=${encodeURIComponent(s.secret)}`);
          const j = await res.json();
          toast(j.ok ? `✅ 連線成功：${j.spreadsheet || ''}` : `❌ ${j.error || '失敗'}`, 4000);
        } catch (e) { toast('❌ 無法連線：' + e.message, 4000); }
      };
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
  let syncing = false;
  async function post(rec) {
    const { photo, synced, ...payload } = rec;
    const body = { action: 'append', secret: state.settings.secret, record: payload };
    if (photo) body.photo = photo;
    // 使用 text/plain 避免 CORS 預檢（Apps Script 不支援 OPTIONS）
    const res = await fetch(state.settings.scriptUrl, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || '寫入失敗');
  }
  async function syncOne(rec) {
    if (!state.settings.scriptUrl) { updateBadge(); return false; }
    try {
      await post(rec);
      rec.synced = true; rec.photo = null;
      persist(); updateBadge();
      return true;
    } catch (e) {
      console.warn('sync failed', e);
      updateBadge();
      return false;
    }
  }
  async function syncAll(verbose = false) {
    if (syncing || !state.settings.scriptUrl) { if (verbose && !state.settings.scriptUrl) toast('請先到「設定」填寫 Apps Script 網址'); return; }
    syncing = true;
    let ok = 0, fail = 0;
    for (const r of state.readings.filter((x) => !x.synced)) {
      if (await syncOne(r)) ok++; else fail++;
    }
    syncing = false;
    if (verbose || ok) toast(fail ? `補送成功 ${ok} 筆，失敗 ${fail} 筆` : `已補送 ${ok} 筆到試算表`);
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
    const head = ['抄表時間', '地點', '表別', '表號', '本期讀數', '上期讀數', '用量', '單位', '抄表人', '備註', 'OCR辨識值', 'OCR信心'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [...state.readings].sort((a, b) => a.time.localeCompare(b.time)).map((r) =>
      [fmtTime(r.time), r.locationName, r.type, r.meterNo, r.value, r.prev, r.usage, r.unit, r.reader, r.note, r.ocrValue, r.ocrConfidence].map(q).join(','));
    download(`抄表紀錄_${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + [head.map(q).join(','), ...lines].join('\r\n'), 'text/csv');
  }

  // ---------- 啟動 ----------
  go('home');
  updateBadge();
  syncAll();
  // 預先載入 OCR 引擎，第一次拍照時不必等待
  setTimeout(() => getWorker().catch(() => {}), 1500);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
