/**
 * 抄表系統 — Google Apps Script 後端
 *
 * 安裝方式：
 *   1. 開啟要存放資料的 Google 試算表 → 擴充功能 → Apps Script
 *   2. 將本檔內容貼上，修改下方 SECRET
 *   3. 部署 → 新增部署作業 → 類型選「網頁應用程式」
 *      執行身分：我　／　誰可以存取：任何人
 *   4. 複製產生的「網頁應用程式網址」，貼到抄表 App 的「設定」頁
 */

// 自訂一組密鑰，App 設定頁需填入相同字串（避免他人亂寫入資料）
const SECRET = 'change-me';

const SHEET_NAME = '抄表紀錄';
const PHOTO_FOLDER = '抄表照片';
const HEADERS = [
  '抄表時間', '地點', '表別', '表號', '本期讀數', '上期讀數', '用量', '單位',
  '抄表人', '備註', 'OCR辨識值', 'OCR信心', '照片', '紀錄ID',
];
const ID_COL = HEADERS.indexOf('紀錄ID') + 1;

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.secret !== SECRET) return json({ ok: false, error: '密鑰錯誤' });
  if (p.action === 'ping') {
    getSheet_();
    return json({ ok: true, spreadsheet: SpreadsheetApp.getActive().getName() });
  }
  return json({ ok: false, error: '未知的動作' });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: '資料格式錯誤' });
  }
  if (body.secret !== SECRET) return json({ ok: false, error: '密鑰錯誤' });
  if (body.action !== 'append' || !body.record) return json({ ok: false, error: '未知的動作' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const r = body.record;
    const sheet = getSheet_();

    // 依紀錄ID去重（網路不穩重送時不會重複寫入）
    if (r.id && sheet.getLastRow() > 1) {
      const found = sheet.getRange(2, ID_COL, sheet.getLastRow() - 1, 1)
        .createTextFinder(String(r.id)).matchEntireCell(true).findNext();
      if (found) return json({ ok: true, duplicate: true });
    }

    let photoUrl = '';
    if (body.photo) photoUrl = savePhoto_(body.photo, r);

    sheet.appendRow([
      r.time ? new Date(r.time) : new Date(),
      r.locationName || '', r.type || '', r.meterNo || '',
      num_(r.value), num_(r.prev), num_(r.usage), r.unit || '',
      r.reader || '', r.note || '', r.ocrValue || '', r.ocrConfidence === '' ? '' : num_(r.ocrConfidence),
      photoUrl, r.id || '',
    ]);
    return json({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function getSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#e8f0fe');
    sheet.getRange('A:A').setNumberFormat('yyyy/mm/dd hh:mm');
  }
  return sheet;
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
