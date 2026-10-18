// TikTok 直播事件轉換：把 tiktok-live-connector（新版 v2 與舊版扁平格式）、
// 以及採用相同格式的工具送來的 { event, data } 轉成遊戲事件。
// 瀏覽器與 bridge/server.js（Node）共用這一份。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.DG = root.DG || {}).tiktok = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const streaks = new Map(); // 連擊中的禮物：key -> 已計入數量

  function first(...vals) {
    for (const v of vals) if (v !== undefined && v !== null && v !== '') return v;
    return undefined;
  }

  function imageUrl(m) {
    if (!m) return undefined;
    if (typeof m === 'string') return m;
    if (Array.isArray(m)) return imageUrl(m[0]);
    return first(imageUrl(m.urlList), imageUrl(m.urls), imageUrl(m.url));
  }

  function toUser(d) {
    const u = d.user || d;
    const id = first(u.userId, u.id, u.uniqueId, u.displayId, u.secUid, d.userId, d.uniqueId);
    const name = first(u.nickname, d.nickname, u.uniqueId, u.displayId, d.uniqueId, '觀眾');
    const avatar = first(d.profilePictureUrl, u.profilePictureUrl, imageUrl(u.profilePicture), imageUrl(u.avatarThumb));
    return { id: String(id ?? name), name: String(name), avatar: typeof avatar === 'string' ? avatar : undefined };
  }

  function gift(d, user) {
    const g = d.gift || d.giftDetails || {};
    const ext = d.extendedGiftInfo || {};
    const name = String(first(d.giftName, g.name, g.giftName, ext.name, 'Gift'));
    const diamond = Number(first(d.diamondCount, g.diamondCount, ext.diamond_count, 0)) || 0;
    const type = Number(first(d.giftType, g.type, g.giftType, ext.type, 0));
    const repeat = Number(first(d.repeatCount, d.comboCount, 1)) || 1;
    const giftId = String(first(d.giftId, g.id, ext.id, name));
    const streakable = type === 1 || g.combo === true;
    let count = repeat;
    if (streakable) {
      // 連擊禮物會在連擊過程中不斷送出累計數量，結束時再送一次 repeatEnd；只計算新增的部分
      const key = user.id + '|' + giftId + '|' + (d.groupId || '');
      const prev = streaks.get(key) || 0;
      count = repeat >= prev ? repeat - prev : repeat;
      if (d.repeatEnd) streaks.delete(key);
      else streaks.set(key, repeat);
      if (streaks.size > 5000) streaks.clear();
    }
    if (count <= 0) return null;
    return { type: 'gift', user, gift: { id: giftId, name, count, diamond } };
  }

  function normalize(event, d) {
    if (!d || typeof d !== 'object') return null;
    const user = toUser(d);
    switch (String(event)) {
      case 'chat':
      case 'comment':
        return { type: 'chat', user, text: String(first(d.comment, d.content, d.text, '')) };
      case 'like':
        return { type: 'like', user, count: Number(first(d.likeCount, d.count, 1)) || 1 };
      case 'follow':
        return { type: 'follow', user };
      case 'share':
        return { type: 'share', user };
      case 'member':
        return { type: 'enter', user };
      case 'social': {
        const s = String(first(d.displayType, d.action, d.label, '')).toLowerCase();
        if (s.includes('follow')) return { type: 'follow', user };
        if (s.includes('share')) return { type: 'share', user };
        return null;
      }
      case 'gift':
        return gift(d, user);
      default:
        return null;
    }
  }

  return { normalize };
});
