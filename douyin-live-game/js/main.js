// 進入點：建立遊戲、連線直播事件來源、模擬控制台。
//
// 網址參數：
//   ?ws=ws://127.0.0.1:8888   連到彈幕工具的 WebSocket（可多個，用逗號分隔）
//   ?platform=douyin          改用抖音禮物表（預設 TikTok）
//   ?sim=1                    開啟模擬控制台
//   ?demo=60                  60 秒沒人互動就自動播放暖場示範
//   ?round=300                每局秒數
//   ?mute=1                   靜音
(function () {
  const DG = window.DG;
  const C = DG.CONFIG;
  const params = new URLSearchParams(location.search);
  if (params.get('round')) C.roundSeconds = Math.max(30, Number(params.get('round')) || C.roundSeconds);
  if (params.get('demo')) C.idleDemoSeconds = Number(params.get('demo')) || 0;

  const game = (DG.game = new DG.Game(document.getElementById('game')));
  DG.Audio.setMuted(params.get('mute') === '1');

  // ── 直播連線 ──
  const statusEl = document.getElementById('status');
  const statuses = new Map();
  function renderStatus() {
    const vals = [...statuses.values()];
    if (!vals.length) {
      statusEl.textContent = '';
      return;
    }
    const open = vals.filter((v) => v === 'open').length;
    statusEl.className = open ? 'open' : 'bad';
    statusEl.textContent = open ? `● 直播已連線 ${open}/${vals.length}` : '○ 直播未連線，重試中…';
    // 連線正常幾秒後自動淡出，不擋直播畫面
    clearTimeout(renderStatus.t);
    statusEl.classList.remove('fade');
    if (open === vals.length) renderStatus.t = setTimeout(() => statusEl.classList.add('fade'), 4000);
  }
  let urls = (params.get('ws') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!urls.length && location.protocol.startsWith('http')) {
    // 由 bridge/server.js 提供網頁時，自動連到同一台的 /ws
    urls = [(location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'];
  }
  for (const url of urls) {
    new DG.Connector(
      url,
      (ev) => game.handleEvent(ev),
      (state) => {
        statuses.set(url, state);
        renderStatus();
      }
    );
  }
  // 也接受同頁 postMessage 或 console 呼叫：DG.inject({type:'gift', ...})
  DG.inject = (raw) => DG.normalize(raw).forEach((ev) => game.handleEvent(ev));
  window.addEventListener('message', (e) => {
    if (e.data && typeof e.data === 'object' && (e.data.type || e.data.Type !== undefined)) DG.inject(e.data);
  });

  // ── 音效解鎖 ──
  const unlockEl = document.getElementById('unlock');
  // 提示只在測試時顯示，避免出現在直播畫面上
  if (params.get('sim') !== '1') unlockEl.classList.add('hide');
  const unlock = () => {
    DG.Audio.unlock();
    unlockEl.classList.add('hide');
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  // OBS 瀏覽器來源通常允許自動播放
  setTimeout(() => {
    const c = DG.Audio.unlock();
    if (c && c.state === 'running') unlockEl.classList.add('hide');
  }, 500);

  // ── 模擬控制台 ──
  const BOT_NAMES = ['小明', '阿花', '夜貓子', '路過的貓', '奶茶續命', '摸魚大師', '肥宅快樂水', '一隻柯基', '吃土少女', '暴躁老哥', '佛系玩家', '熬夜冠軍', '芒果冰', '鹹魚翻身', '月光族', '早睡早起', '雞排加辣', '追劇中', 'KK', 'Momo', '阿傑', '小雨', '大胃王', '蛋黃哥'];
  const randName = () => BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + (Math.random() < 0.5 ? Math.floor(Math.random() * 99) : '');
  const sim = document.getElementById('sim');
  const nameEl = document.getElementById('simName');
  const countEl = document.getElementById('simCount');
  if (params.get('sim') === '1') sim.hidden = false;
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 's' || e.key === 'S') sim.hidden = !sim.hidden;
  });
  nameEl.addEventListener('focus', () => {
    nameEl.value = randName();
    nameEl.select();
  });
  const user = (shift) => {
    const name = shift ? randName() : nameEl.value || '測試觀眾';
    return { id: 'sim:' + name, name };
  };
  sim.querySelectorAll('[data-chat]').forEach((b) =>
    b.addEventListener('click', (e) => game.handleEvent({ type: 'chat', user: user(e.shiftKey), text: b.dataset.chat }))
  );
  document.getElementById('simLike').onclick = (e) => game.handleEvent({ type: 'like', user: user(e.shiftKey), count: 20 });
  document.getElementById('simFollow').onclick = (e) => game.handleEvent({ type: 'follow', user: user(e.shiftKey) });
  document.getElementById('simShare').onclick = (e) => game.handleEvent({ type: 'share', user: user(e.shiftKey) });
  const giftsEl = document.getElementById('simGifts');
  for (const g of C.gifts) {
    const b = document.createElement('button');
    b.textContent = `${g.icon} ${g.names[0]}`;
    b.title = g.desc;
    b.onclick = (e) => game.handleEvent({ type: 'gift', user: user(e.shiftKey), gift: { name: g.names[0], count: Number(countEl.value) || 1 } });
    giftsEl.appendChild(b);
  }
  const muteBtn = document.getElementById('simMute');
  const renderMute = () => (muteBtn.textContent = DG.Audio.muted ? '🔇 音效：關' : '🔊 音效：開');
  muteBtn.onclick = () => {
    DG.Audio.setMuted(!DG.Audio.muted);
    renderMute();
  };
  renderMute();
  document.getElementById('simReset').onclick = () => {
    game.state = 'end';
    game.endTimer = 0;
  };

  // ── 自動模擬（測試用／暖場示範）──
  const bots = Array.from({ length: 30 }, () => {
    const name = randName();
    return { id: 'bot:' + name + Math.random(), name };
  });
  const visibleGifts = C.gifts.filter((g) => !g.hidden);
  function botTick() {
    const u = bots[Math.floor(Math.random() * bots.length)];
    const r = Math.random();
    if (r < 0.3) game.handleEvent({ type: 'chat', user: u, text: Math.random() < 0.5 ? '1' : '2' });
    else if (r < 0.5) game.handleEvent({ type: 'chat', user: u, text: ['666', '衝啊', '好玩', '紅隊加油', '藍隊穩了', '哈哈哈'][Math.floor(Math.random() * 6)] });
    else if (r < 0.75) game.handleEvent({ type: 'like', user: u, count: 1 + Math.floor(Math.random() * 15) });
    else {
      // 越貴的禮物越少見
      const i = Math.min(visibleGifts.length - 1, Math.floor(Math.pow(Math.random(), 2.6) * visibleGifts.length));
      const g = visibleGifts[i];
      game.handleEvent({ type: 'gift', user: u, gift: { name: g.names[0], count: i < 3 && Math.random() < 0.3 ? 1 + Math.floor(Math.random() * 9) : 1 } });
    }
  }
  let botTimer = null;
  let botsManual = false;
  const botsBtn = document.getElementById('simBots');
  function setBots(on, manual) {
    if (manual !== undefined) botsManual = manual;
    clearInterval(botTimer);
    botTimer = on ? setInterval(botTick, 350) : null;
    botsBtn.textContent = on ? '🤖 自動模擬：開' : '🤖 自動模擬：關';
    botsBtn.classList.toggle('on', on);
  }
  botsBtn.onclick = () => setBots(!botTimer, !botTimer);
  if (params.get('bots') === '1') setBots(true, true);

  // 暖場：太久沒人互動時自動示範，有真實觀眾互動就停
  if (C.idleDemoSeconds > 0) {
    const realHandle = game.handleEvent.bind(game);
    let lastReal = performance.now();
    game.handleEvent = function (ev) {
      if (!String(ev.user && ev.user.id).startsWith('bot:')) {
        lastReal = performance.now();
        if (botTimer && !botsManual) setBots(false);
      }
      return realHandle(ev);
    };
    setInterval(() => {
      if (!botTimer && performance.now() - lastReal > C.idleDemoSeconds * 1000) setBots(true, false);
    }, 1000);
  }
})();
