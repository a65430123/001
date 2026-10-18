// 直播事件接入：把各種彈幕工具的訊息統一轉成遊戲事件。
//
// 統一事件格式：
//   { type: 'chat'|'gift'|'like'|'follow'|'share'|'enter',
//     user: { id, name, avatar }, text, count,
//     gift: { id, name, count, diamond } }
//
// 支援的來源格式：
//   1. 上面的統一格式（自己寫的腳本、bridge/server.js 轉發）
//   2. DouyinBarrageGrab 等抓取工具：{ Type: 1~8, Data: {...} }
//   3. 抖音直播開放平台推送：{ msg_type / type: 'live_comment' | 'live_gift' | 'live_like', payload: [...] }
(function () {
  const DG = (window.DG = window.DG || {});

  const comboSeen = new Map(); // 連擊禮物去重：key -> 已計入的連擊數

  function pick(o, ...keys) {
    if (!o) return undefined;
    for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
    return undefined;
  }

  function parseMaybeJSON(v) {
    if (typeof v !== 'string') return v;
    try {
      return JSON.parse(v);
    } catch (e) {
      return v;
    }
  }

  function makeUser(u, fallback) {
    u = u || {};
    const f = fallback || {};
    const name = String(pick(u, 'name', 'nickname', 'Nickname', 'nickName', 'NickName') ?? pick(f, 'nickname', 'name') ?? '神秘觀眾');
    const id = String(pick(u, 'id', 'Id', 'uid', 'userId', 'sec_openid', 'secUid', 'SecUid', 'DisplayId') ?? pick(f, 'sec_openid', 'uid', 'userId') ?? name);
    const avatar = pick(u, 'avatar', 'avatar_url', 'HeadImgUrl', 'headImgUrl', 'AvatarThumb') ?? pick(f, 'avatar_url', 'avatar');
    return { id, name, avatar: typeof avatar === 'string' ? avatar : undefined };
  }

  // 連擊禮物：若來源帶有累計連擊數，只計算增加的部分，避免重複計算
  function giftDelta(user, giftName, groupId, count, repeat) {
    if (!repeat) return count || 1;
    const key = user.id + '|' + giftName + '|' + (groupId || '');
    const prev = comboSeen.get(key) || 0;
    const delta = repeat >= prev ? repeat - prev : repeat;
    comboSeen.set(key, repeat);
    if (comboSeen.size > 5000) comboSeen.clear();
    return delta * Math.max(1, count || 1);
  }

  function normalizeGeneric(m) {
    const type = String(m.type).toLowerCase();
    const map = { chat: 'chat', comment: 'chat', danmaku: 'chat', message: 'chat', gift: 'gift', like: 'like', follow: 'follow', share: 'share', enter: 'enter', join: 'enter', member: 'enter' };
    const t = map[type];
    if (!t) return null;
    const user = makeUser(m.user || m, m);
    const ev = { type: t, user };
    if (t === 'chat') ev.text = String(pick(m, 'text', 'content', 'msg') ?? '');
    if (t === 'like') ev.count = Number(pick(m, 'count', 'likes') ?? 1) || 1;
    if (t === 'gift') {
      const g = m.gift || m;
      const name = String(pick(g, 'name', 'giftName', 'gift_name') ?? '禮物');
      ev.gift = {
        id: pick(g, 'id', 'giftId', 'gift_id'),
        name,
        count: Number(pick(g, 'count', 'num', 'giftCount') ?? 1) || 1,
        diamond: Number(pick(g, 'diamond', 'diamondCount', 'price', 'value') ?? 0) || 0,
      };
    }
    return ev;
  }

  function normalizeBarrageGrab(m) {
    const d = parseMaybeJSON(m.Data ?? m.data) || {};
    const user = makeUser(d.User || d.user);
    switch (Number(m.Type)) {
      case 1:
        return { type: 'chat', user, text: String(d.Content ?? d.content ?? '') };
      case 2:
        return { type: 'like', user, count: Number(d.Count ?? d.count ?? 1) || 1 };
      case 3:
        return { type: 'enter', user };
      case 4:
        return { type: 'follow', user };
      case 5: {
        const name = String(d.GiftName ?? d.giftName ?? '禮物');
        const count = Number(d.GiftCount ?? d.giftCount ?? 1) || 1;
        const repeat = Number(d.RepeatCount ?? d.repeatCount ?? 0) || 0;
        const n = giftDelta(user, name, d.GroupId ?? d.groupId, count, repeat);
        if (n <= 0) return null;
        return { type: 'gift', user, gift: { id: d.GiftId, name, count: n, diamond: Number(d.DiamondCount ?? d.diamondCount ?? 0) || 0 } };
      }
      case 8:
        return { type: 'share', user };
      default:
        return null;
    }
  }

  function normalizeOpenPlatform(m) {
    const kind = String(m.msg_type || m.type || '');
    const list = parseMaybeJSON(m.payload ?? m.data);
    const arr = Array.isArray(list) ? list : [list];
    const out = [];
    for (const p of arr) {
      if (!p) continue;
      const user = makeUser(null, p);
      if (kind === 'live_comment') out.push({ type: 'chat', user, text: String(p.content ?? '') });
      else if (kind === 'live_like') out.push({ type: 'like', user, count: Number(p.like_num ?? 1) || 1 });
      else if (kind === 'live_fansclub') out.push({ type: 'follow', user });
      else if (kind === 'live_gift') {
        const num = Number(p.gift_num ?? 1) || 1;
        // gift_value 單位為「分」，1 抖幣 = 10 分；為單筆總值
        const diamond = (Number(p.gift_value ?? 0) || 0) / 10 / num;
        out.push({ type: 'gift', user, gift: { id: p.sec_gift_id, name: p.gift_name || '', count: num, diamond } });
      }
    }
    return out;
  }

  DG.normalize = function normalize(raw) {
    const m = parseMaybeJSON(raw);
    if (!m || typeof m !== 'object') return [];
    if (Array.isArray(m)) return m.flatMap((x) => DG.normalize(x));
    if (m.Type !== undefined && (m.Data !== undefined || m.data !== undefined)) {
      const e = normalizeBarrageGrab(m);
      return e ? [e] : [];
    }
    const kind = String(m.msg_type || m.type || '');
    if (kind.startsWith('live_')) return normalizeOpenPlatform(m);
    if (m.type !== undefined) {
      const e = normalizeGeneric(m);
      return e ? [e] : [];
    }
    if (Array.isArray(m.events)) return m.events.flatMap((x) => DG.normalize(x));
    return [];
  };

  DG.Connector = class Connector {
    constructor(url, onEvent, onStatus) {
      this.url = url;
      this.onEvent = onEvent;
      this.onStatus = onStatus || (() => {});
      this.retry = 1000;
      this.closed = false;
      this.connect();
    }
    connect() {
      if (this.closed) return;
      this.onStatus('connecting', this.url);
      let ws;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        this.onStatus('error', String(e));
        return this.schedule();
      }
      this.ws = ws;
      ws.onopen = () => {
        this.retry = 1000;
        this.onStatus('open', this.url);
      };
      ws.onmessage = (msg) => {
        const handle = (text) => {
          let events = [];
          try {
            events = DG.normalize(text);
          } catch (e) {
            console.warn('無法解析訊息', e, text);
          }
          events.forEach((ev) => this.onEvent(ev));
        };
        if (typeof msg.data === 'string') handle(msg.data);
        else if (msg.data && msg.data.text) msg.data.text().then(handle);
      };
      ws.onclose = () => {
        this.onStatus('closed', this.url);
        this.schedule();
      };
      ws.onerror = () => {};
    }
    schedule() {
      if (this.closed) return;
      setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 15000);
    }
    close() {
      this.closed = true;
      if (this.ws) this.ws.close();
    }
  };
})();
