/**
 * 抄表系統 — Google Apps Script 後端
 *
 * 功能：
 *   - 依「工作表＋日期」把讀數寫進既有紀錄表的對應格子（例如 R1F軟水-1 的 C 欄）
 *   - 同時在「抄表紀錄」工作表留一筆明細（含 OCR 辨識值、照片連結），方便稽核
 *
 * 安裝方式：
 *   1. 到 https://script.google.com 新增專案（或在試算表中：擴充功能 → Apps Script）
 *   2. 將本檔內容貼上，修改下方 SECRET
 *   3. 部署 → 新增部署作業 → 類型選「網頁應用程式」
 *      執行身分：我　／　誰可以存取：任何人
 *   4. 複製「網頁應用程式網址」，貼到抄表 App 的「設定」頁
 *   5. 在 App 設定頁填入「試算表網址」（每月換新檔時只要改這裡，不必重新部署）
 */

// 自訂一組密鑰，App 設定頁需填入相同字串（避免他人亂寫入資料）
const SECRET = 'change-me';

// 明細紀錄工作表名稱；設為 '' 則不建立明細表
const LOG_SHEET = '抄表紀錄';
const PHOTO_FOLDER = '抄表照片';
const LOG_HEADERS = [
  '抄表時間', '抄表日期', '地點', '寫入位置', '本期讀數', '上期讀數', '用量', '單位',
  '抄表人', '備註', 'OCR辨識值', 'OCR信心', '照片', '紀錄ID',
];

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.secret !== SECRET) return json({ ok: false, error: '密鑰錯誤' });
    const ss = getSS_(p.sheetId);
    if (p.action === 'ping') {
      return json({ ok: true, spreadsheet: ss.getName(), sheets: ss.getSheets().map((s) => s.getName()) });
    }
    if (p.action === 'lookup') {
      const t = findTarget_(ss, p, p.date);
      const cell = t.sheet.getRange(t.row, t.valueCol);
      const prev = findPrev_(t);
      return json({
        ok: true, cell: a1_(t), row: t.row,
        existing: cell.getFormula() ? '（公式）' : cell.getValue(),
        prev: prev ? prev.value : null, prevDate: prev ? prev.date : '',
      });
    }
    return json({ ok: false, error: '未知的動作' });
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: '資料格式錯誤' });
  }
  if (body.secret !== SECRET) return json({ ok: false, error: '密鑰錯誤' });
  if (body.action !== 'write' || !body.record) return json({ ok: false, error: '未知的動作' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = getSS_(body.sheetId);
    const r = body.record;
    let where = '';

    if (r.target && r.target.sheet) {
      const t = findTarget_(ss, r.target, r.date);
      const cell = t.sheet.getRange(t.row, t.valueCol);
      where = a1_(t);
      if (cell.getFormula()) return json({ ok: false, error: `${where} 是公式格，不可寫入，請檢查欄位設定` });

      const existing = cell.getValue();
      const same = existing !== '' && Number(existing) === Number(r.value);
      if (existing !== '' && !same && !r.overwrite) {
        return json({ ok: false, code: 'exists', cell: where, existing: existing });
      }
      if (!same) cell.setValue(Number(r.value));

      if (r.target.signCol && r.reader) {
        const sign = t.sheet.getRange(t.row, colIndex_(r.target.signCol));
        if (!sign.getFormula() && (sign.getValue() === '' || r.overwrite)) sign.setValue(r.reader);
      }
      if (r.target.noteCol && r.note) {
        const note = t.sheet.getRange(t.row, colIndex_(r.target.noteCol));
        if (!note.getFormula()) {
          const old = String(note.getValue() || '');
          if (old.indexOf(r.note) === -1) note.setValue(old ? old + '；' + r.note : r.note);
        }
      }
    }

    if (LOG_SHEET) appendLog_(ss, r, where, body.photo);
    return json({ ok: true, cell: where });
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// ---------- 定位 ----------

function getSS_(id) {
  if (id) return SpreadsheetApp.openById(id);
  const ss = SpreadsheetApp.getActive();
  if (!ss) throw new Error('請在 App 設定頁填入試算表網址');
  return ss;
}

/** 依日期欄找出該日期所在的列（再加上列位移，例如中班） */
function findTarget_(ss, t, dateStr) {
  const sheet = ss.getSheetByName(t.sheet);
  if (!sheet) throw new Error(`找不到工作表「${t.sheet}」`);
  if (!t.valueCol) throw new Error('未設定讀數欄');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) throw new Error('日期格式錯誤');

  const tz = ss.getSpreadsheetTimeZone();
  const dateCol = colIndex_(t.dateCol || 'A');
  const last = sheet.getLastRow();
  const dates = sheet.getRange(1, dateCol, last, 1).getValues();
  let row = -1;
  for (let i = 0; i < dates.length; i++) {
    const v = dates[i][0];
    if (isDate_(v) && Utilities.formatDate(v, tz, 'yyyy-MM-dd') === dateStr) { row = i + 1; break; }
  }
  if (row < 0) throw new Error(`「${t.sheet}」找不到 ${dateStr}（請確認試算表月份是否正確）`);
  return {
    sheet, tz, dateCol,
    row: row + (Number(t.rowOffset) || 0),
    valueCol: colIndex_(t.valueCol),
  };
}

/** 往上找最近一筆數字讀數，作為「上期讀數」 */
function findPrev_(t) {
  if (t.row <= 1) return null;
  const vals = t.sheet.getRange(1, t.valueCol, t.row - 1, 1).getValues();
  const dates = t.sheet.getRange(1, t.dateCol, t.row - 1, 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) {
    if (typeof vals[i][0] === 'number') {
      let date = '';
      for (let j = i; j >= 0; j--) {
        if (isDate_(dates[j][0])) { date = Utilities.formatDate(dates[j][0], t.tz, 'M/d'); break; }
      }
      return { value: vals[i][0], date };
    }
  }
  return null;
}

function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}

function colIndex_(letters) {
  const s = String(letters).trim().toUpperCase();
  if (!/^[A-Z]{1,2}$/.test(s)) throw new Error(`欄位「${letters}」格式錯誤`);
  let n = 0;
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n;
}

function a1_(t) {
  return `${t.sheet.getName()}!${t.sheet.getRange(t.row, t.valueCol).getA1Notation()}`;
}

// ---------- 明細紀錄 ----------

function appendLog_(ss, r, where, photo) {
  let sheet = ss.getSheetByName(LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(LOG_SHEET);
    sheet.appendRow(LOG_HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, LOG_HEADERS.length).setFontWeight('bold').setBackground('#e8f0fe');
    sheet.getRange('A:A').setNumberFormat('yyyy/mm/dd hh:mm');
  }
  // 依紀錄ID去重（網路不穩重送時不會重複寫入）
  const idCol = LOG_HEADERS.indexOf('紀錄ID') + 1;
  if (r.id && sheet.getLastRow() > 1) {
    const found = sheet.getRange(2, idCol, sheet.getLastRow() - 1, 1)
      .createTextFinder(String(r.id)).matchEntireCell(true).findNext();
    if (found) return;
  }
  const photoUrl = photo ? savePhoto_(photo, r) : '';
  sheet.appendRow([
    r.time ? new Date(r.time) : new Date(), r.date || '',
    r.locationName || '', where, num_(r.value), num_(r.prev), num_(r.usage), r.unit || '',
    r.reader || '', r.note || '', r.ocrValue || '', r.ocrConfidence === '' ? '' : num_(r.ocrConfidence),
    photoUrl, r.id || '',
  ]);
}

function savePhoto_(dataUrl, r) {
  try {
    const m = String(dataUrl).match(/^data:(image\/\w+);base64,(.+)$/);
    if (!m) return '';
    const folders = DriveApp.getFoldersByName(PHOTO_FOLDER);
    const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(PHOTO_FOLDER);
    const stamp = Utilities.formatDate(new Date(r.time || Date.now()), Session.getScriptTimeZone(), 'yyyyMMdd_HHmm');
    const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], `${r.locationName || 'meter'}_${stamp}.jpg`);
    return folder.createFile(blob).getUrl();
  } catch (err) {
    return '照片儲存失敗：' + err;
  }
}

function num_(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return isNaN(n) ? v : n;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
