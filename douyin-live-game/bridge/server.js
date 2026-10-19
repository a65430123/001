#!/usr/bin/env node
// 零依賴的小型轉發伺服器：
//   - 提供遊戲網頁：http://localhost:3000
//   - WebSocket 廣播：ws://localhost:3000/ws（遊戲會自動連上）
//   - HTTP 推送：POST http://localhost:3000/event  （JSON，單筆或陣列）
//       可接抖音直播開放平台的推送、或任何你自己的抓取腳本
//   - TikTok 直連：--tiktok 你的帳號  直接讀取 TikTok 直播間的留言、禮物、按讚（需先 npm install）
//   - 上游轉接：--upstream ws://127.0.0.1:8888  把其他彈幕工具的訊息轉發給遊戲
//
// 用法：node bridge/server.js [--port 3000] [--tiktok 帳號] [--upstream ws://...] [--token 密碼]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : process.env[name.toUpperCase()] || def;
};
const PORT = Number(opt('port', 3000));
const UPSTREAM = opt('upstream', '');
const TOKEN = opt('token', ''); // 設定後 POST /event 需帶 ?token= 或 X-Token 標頭
const TIKTOK = String(opt('tiktok', '')).replace(/^@/, '');
const SIGN_KEY = opt('sign-key', ''); // Euler Stream API key（選填，可提高連線次數上限）
const ROOT = path.resolve(__dirname, '..');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const clients = new Set();

function frame(text) {
  const payload = Buffer.from(text);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function broadcast(text) {
  const f = frame(text);
  for (const s of clients) s.write(f);
}

// 只處理瀏覽器送來的 close / ping，其他內容忽略
function onClientData(socket, chunk) {
  socket.buf = Buffer.concat([socket.buf, chunk]);
  while (socket.buf.length >= 2) {
    const b = socket.buf;
    const opcode = b[0] & 0x0f;
    const masked = b[1] & 0x80;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (b.length < 4) return;
      len = b.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (b.length < 10) return;
      len = Number(b.readBigUInt64BE(2));
      off = 10;
    }
    const maskOff = off;
    if (masked) off += 4;
    if (b.length < off + len) return;
    const data = Buffer.from(b.subarray(off, off + len));
    if (masked) for (let i = 0; i < len; i++) data[i] ^= b[maskOff + (i % 4)];
    socket.buf = b.subarray(off + len);
    if (opcode === 0x8) {
      socket.end(Buffer.from([0x88, 0]));
      clients.delete(socket);
      return;
    }
    if (opcode === 0x9) socket.write(Buffer.concat([Buffer.from([0x8a, data.length]), data]));
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/event') {
    if (TOKEN && url.searchParams.get('token') !== TOKEN && req.headers['x-token'] !== TOKEN) {
      res.writeHead(401).end('unauthorized');
      return;
    }
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        JSON.parse(body);
      } catch (e) {
        res.writeHead(400).end('invalid json');
        return;
      }
      broadcast(body);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, clients: clients.size }));
    });
    return;
  }
  if (req.method !== 'GET') {
    res.writeHead(405).end();
    return;
  }
  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!(file + path.sep).startsWith(ROOT + path.sep) || /[\\/](bridge|tools|node_modules)[\\/]/.test(file.slice(ROOT.length))) {
    res.writeHead(403).end();
    return;
  }
  if (url.pathname === '/') file = path.join(ROOT, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(data);
  });
});

server.on('upgrade', (req, socket) => {
  if (new URL(req.url, 'http://x').pathname !== '/ws' || !req.headers['sec-websocket-key']) {
    socket.destroy();
    return;
  }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.buf = Buffer.alloc(0);
  clients.add(socket);
  console.log(`[bridge] 遊戲畫面已連線（共 ${clients.size}）`);
  socket.on('data', (c) => onClientData(socket, c));
  const drop = () => clients.delete(socket);
  socket.on('close', drop);
  socket.on('error', drop);
});

function connectUpstream() {
  if (!UPSTREAM) return;
  if (typeof WebSocket === 'undefined') {
    console.error('[bridge] --upstream 需要 Node.js 22 以上');
    return;
  }
  const ws = new WebSocket(UPSTREAM);
  ws.onopen = () => console.log('[bridge] 已連上上游', UPSTREAM);
  ws.onmessage = async (m) => broadcast(typeof m.data === 'string' ? m.data : await new Response(m.data).text());
  ws.onclose = () => {
    console.log('[bridge] 上游斷線，3 秒後重連');
    setTimeout(connectUpstream, 3000);
  };
  ws.onerror = () => {};
}

// ── TikTok 直連 ──
async function connectTikTok() {
  let lib;
  try {
    lib = await import('tiktok-live-connector');
  } catch (e) {
    console.error('[tiktok] 找不到 tiktok-live-connector，請先在 douyin-live-game 資料夾執行：npm install');
    return;
  }
  const tiktok = require('../js/tiktok.js');
  const { TikTokLiveConnection, WebcastEvent, ControlEvent } = lib;
  let retryTimer = null;
  let conn = null;
  const retry = (sec) => {
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      start();
    }, sec * 1000);
  };
  const start = async () => {
    conn = new TikTokLiveConnection(TIKTOK, { enableExtendedGiftInfo: true, ...(SIGN_KEY ? { signApiKey: SIGN_KEY } : {}) });
    for (const name of ['chat', 'gift', 'like', 'follow', 'share', 'member']) {
      conn.on(WebcastEvent[name.toUpperCase()] || name, (data) => {
        let ev = null;
        try {
          ev = tiktok.normalize(name, data);
        } catch (e) {
          console.warn('[tiktok] 無法解析', name, e.message);
        }
        if (!ev) return;
        if (ev.type === 'gift') console.log(`[tiktok] 🎁 ${ev.user.name} 送出 ${ev.gift.name} ×${ev.gift.count}`);
        broadcast(JSON.stringify(ev));
      });
    }
    conn.on((WebcastEvent && WebcastEvent.STREAM_END) || 'streamEnd', () => {
      console.log('[tiktok] 直播已結束，30 秒後重新嘗試連線');
      retry(30);
    });
    conn.on((ControlEvent && ControlEvent.DISCONNECTED) || 'disconnected', () => {
      console.log('[tiktok] 連線中斷，10 秒後重連');
      retry(10);
    });
    conn.on((ControlEvent && ControlEvent.ERROR) || 'error', () => {});
    try {
      const state = await conn.connect();
      console.log(`[tiktok] ✅ 已連上 @${TIKTOK} 的直播間（roomId ${state && state.roomId}）`);
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (/offline|not.*live|LIVE has ended|isn't online/i.test(msg) || (e && e.constructor && e.constructor.name === 'UserOfflineError')) {
        console.log(`[tiktok] @${TIKTOK} 目前沒有在直播，20 秒後再試（開播後會自動連上）`);
      } else {
        console.log('[tiktok] 連線失敗：' + msg + '（常見原因：還沒開播、帳號打錯、網路被擋），20 秒後再試');
      }
      retry(20);
    }
  };
  start();
}

server.listen(PORT, () => {
  const q = TIKTOK ? '?source=bridge' : '';
  console.log(`[bridge] 遊戲網址： http://localhost:${PORT}/${q}`);
  console.log(`[bridge] 模擬模式： http://localhost:${PORT}/?sim=1`);
  console.log(`[bridge] 推送事件： POST http://localhost:${PORT}/event`);
  connectUpstream();
  if (TIKTOK) connectTikTok();
});
