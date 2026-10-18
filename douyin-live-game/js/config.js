// 遊戲設定：禮物 → 效果的對應都在這裡，直接修改即可。
(function () {
  const DG = (window.DG = window.DG || {});

  // 平台：tiktok（預設）或 douyin，網址加 ?platform=douyin 切換
  const PLATFORM = new URLSearchParams(location.search).get('platform') === 'douyin' ? 'douyin' : 'tiktok';

  // 禮物對應。names 可放多個別名（中文／英文都放），tier 決定特效等級 1~4。
  // 效果類型：
  //   spawn   {unit, n}     召喚 n 隻（禮物數量會相乘）
  //   airdrop {unit, n}     從天而降，直接空投到前線
  //   shield  {sec}         城堡無敵護盾
  //   heal    {castle}      回復城堡血量並補滿全軍血量
  //   rage    {sec}         全隊狂暴（攻擊、攻速、移速提升）
  //   freeze  {sec}         冰凍敵方全軍
  //   lightning {n, dmg}    對敵軍降下 n 道落雷
  //   meteor  {n, dmg}      對敵方降下 n 顆隕石
  // 也可用 ids 陣列比對禮物 ID（TikTok 的 giftId、抖音開放平台的 sec_gift_id）。
  // 沒列到的禮物會依價值（TikTok 金幣／抖幣）由 fallbackGift 自動給效果。
  const GIFT_SETS = {
    tiktok: [
      { names: ['玫瑰', 'Rose'], icon: '🌹', desc: '3 名小兵', tier: 1, effects: [{ type: 'spawn', unit: 'soldier', n: 3 }] },
      { names: ['TikTok'], icon: '🎵', desc: '2 名騎士', tier: 1, effects: [{ type: 'spawn', unit: 'knight', n: 2 }] },
      { names: ['GG'], icon: '🏹', desc: '2 名弓箭手', tier: 1, effects: [{ type: 'spawn', unit: 'archer', n: 2 }] },
      { names: ['冰淇淋', 'Ice Cream Cone', 'Ice Cream'], icon: '🍦', desc: '城堡護盾 6 秒', tier: 1, effects: [{ type: 'shield', sec: 6 }] },
      { names: ['比心', 'Finger Heart'], icon: '🫰', desc: '全軍治療＋修城', tier: 2, effects: [{ type: 'heal', castle: 300 }] },
      { names: ['友誼項鍊', 'Friendship Necklace'], icon: '📿', desc: '全隊狂暴 10 秒', tier: 2, effects: [{ type: 'rage', sec: 10 }] },
      { names: ['香水', 'Perfume'], icon: '🧴', desc: '召喚巨人', tier: 2, effects: [{ type: 'spawn', unit: 'giant', n: 1 }] },
      { names: ['甜甜圈', 'Doughnut', 'Donut'], icon: '🍩', desc: '冰凍敵軍 5 秒', tier: 3, effects: [{ type: 'freeze', sec: 5 }] },
      { names: ['雙手比心', 'Hand Hearts'], icon: '🫶', desc: '天降落雷 ×10', tier: 3, effects: [{ type: 'lightning', n: 10, dmg: 180 }] },
      { names: ['彩帶', '彩紙', 'Confetti'], icon: '🎊', desc: '空投 15 兵＋戰車', tier: 3, effects: [{ type: 'airdrop', unit: 'soldier', n: 12 }, { type: 'airdrop', unit: 'archer', n: 3 }, { type: 'airdrop', unit: 'tank', n: 1 }] },
      { names: ['撒錢槍', 'Money Gun'], icon: '💸', desc: '戰車 ×3＋法師 ×4', tier: 3, effects: [{ type: 'spawn', unit: 'tank', n: 3 }, { type: 'spawn', unit: 'mage', n: 4 }] },
      { names: ['銀河', 'Galaxy'], icon: '🌌', desc: '巨龍＋隕石雨', tier: 4, effects: [{ type: 'spawn', unit: 'dragon', n: 1 }, { type: 'meteor', n: 12, dmg: 260 }, { type: 'rage', sec: 15 }] },
      // hidden: 不顯示在畫面下方說明，但送了一樣有效
      { names: ['愛心', 'Heart Me'], icon: '💗', desc: '法師', tier: 1, hidden: true, effects: [{ type: 'spawn', unit: 'mage', n: 1 }] },
      { names: ['獅子', 'Lion'], icon: '🦁', desc: '雙龍＋隕石雨', tier: 4, hidden: true, effects: [{ type: 'spawn', unit: 'dragon', n: 2 }, { type: 'meteor', n: 25, dmg: 260 }, { type: 'rage', sec: 20 }] },
      { names: ['宇宙', 'TikTok Universe', 'Universe'], icon: '🪐', desc: '三龍＋末日隕石', tier: 4, hidden: true, effects: [{ type: 'spawn', unit: 'dragon', n: 3 }, { type: 'meteor', n: 40, dmg: 300 }, { type: 'shield', sec: 20 }, { type: 'rage', sec: 30 }] },
    ],
    douyin: [
      { names: ['小心心'], icon: '💗', desc: '3 名小兵', tier: 1, effects: [{ type: 'spawn', unit: 'soldier', n: 3 }] },
      { names: ['玫瑰'], icon: '🌹', desc: '2 名弓箭手', tier: 1, effects: [{ type: 'spawn', unit: 'archer', n: 2 }] },
      { names: ['抖音'], icon: '🎵', desc: '2 名騎士', tier: 1, effects: [{ type: 'spawn', unit: 'knight', n: 2 }] },
      { names: ['人氣票', '人气票'], icon: '🎫', desc: '城堡護盾 8 秒', tier: 2, effects: [{ type: 'shield', sec: 8 }] },
      { names: ['棒棒糖'], icon: '🍭', desc: '全軍治療＋修城', tier: 2, effects: [{ type: 'heal', castle: 300 }] },
      { names: ['仙女棒'], icon: '🪄', desc: '法師 ×2', tier: 2, effects: [{ type: 'spawn', unit: 'mage', n: 2 }] },
      { names: ['加油鴨', '加油鸭'], icon: '🦆', desc: '全隊狂暴 10 秒', tier: 2, effects: [{ type: 'rage', sec: 10 }] },
      { names: ['能力藥丸', '能力药丸'], icon: '💊', desc: '召喚巨人', tier: 2, effects: [{ type: 'spawn', unit: 'giant', n: 1 }] },
      { names: ['甜甜圈'], icon: '🍩', desc: '冰凍敵軍 5 秒', tier: 3, effects: [{ type: 'freeze', sec: 5 }] },
      { names: ['魔法鏡', '魔法镜'], icon: '🪞', desc: '天降落雷 ×10', tier: 3, effects: [{ type: 'lightning', n: 10, dmg: 180 }] },
      { names: ['熱氣球', '热气球'], icon: '🎈', desc: '空投 15 兵＋戰車', tier: 3, effects: [{ type: 'airdrop', unit: 'soldier', n: 12 }, { type: 'airdrop', unit: 'archer', n: 3 }, { type: 'airdrop', unit: 'tank', n: 1 }] },
      { names: ['嘉年華', '嘉年华'], icon: '🎡', desc: '巨龍＋隕石雨', tier: 4, effects: [{ type: 'spawn', unit: 'dragon', n: 1 }, { type: 'meteor', n: 12, dmg: 260 }, { type: 'rage', sec: 15 }] },
      // hidden: 不顯示在畫面下方說明，但送了一樣有效
      { names: ['跑車', '跑车'], icon: '🏎️', desc: '戰車 ×3', tier: 3, hidden: true, effects: [{ type: 'spawn', unit: 'tank', n: 3 }] },
      { names: ['火箭', '直升機', '直升机'], icon: '🚀', desc: '隕石雨＋空投', tier: 4, hidden: true, effects: [{ type: 'meteor', n: 20, dmg: 260 }, { type: 'airdrop', unit: 'giant', n: 3 }] },
      { names: ['粉絲團燈牌', '粉丝团灯牌', '點亮粉絲團', '点亮粉丝团'], icon: '💡', desc: '法師', tier: 1, hidden: true, effects: [{ type: 'spawn', unit: 'mage', n: 1 }] },
    ],
  };

  DG.CONFIG = {
    platform: PLATFORM,
    W: 1080,
    H: 1920,
    title: '彈幕攻城戰',
    roundSeconds: 300, // 每局秒數，時間到時城堡血量比例高者勝
    intermission: 12, // 局間休息秒數
    castleHP: 6000,
    maxUnitsPerTeam: 150, // 每隊同時在場上限，超出的會排隊等待出兵
    spawnPerSecond: 24, // 出兵速度
    likesPerSpawn: 20, // 每累積 N 個讚召喚一名小兵
    chargeCooldown: 6, // 評論 666 衝鋒冷卻（秒）
    idleDemoSeconds: 0, // >0 時，沒人互動 N 秒後自動進入暖場示範（也可用網址 ?demo=60）

    layout: {
      redCastleY: 265, // 紅方城堡（上方）
      blueCastleY: 1545, // 藍方城堡（下方）
      redFront: 365, // 紅方城牆前緣
      blueFront: 1445, // 藍方城牆前緣
    },

    teams: {
      red: { name: '紅隊', color: '#ff4d5e', dark: '#8f1424', light: '#ffc2c8', dir: 1 },
      blue: { name: '藍隊', color: '#3d8bff', dark: '#103a85', light: '#c2dbff', dir: -1 },
    },

    // 評論關鍵字（完全相同才算，大小寫不拘）
    keywords: {
      red: ['1', '紅', '红', '紅隊', '红队', '红方', '紅方', 'red'],
      blue: ['2', '藍', '蓝', '藍隊', '蓝队', '蓝方', '藍方', 'blue'],
      // 評論「包含」以下任一字即觸發衝鋒
      charge: ['666', '衝', '冲', '沖', '加油', 'go'],
    },

    // 兵種數值
    units: {
      soldier: { name: '小兵', icon: '⚔️', hp: 70, atk: 10, range: 8, speed: 70, cd: 0.8, r: 18, value: 2 },
      archer: { name: '弓箭手', icon: '🏹', hp: 50, atk: 9, range: 230, speed: 58, cd: 1.0, r: 18, proj: 'arrow', value: 3 },
      knight: { name: '騎士', icon: '🐎', hp: 140, atk: 16, range: 8, speed: 135, cd: 0.9, r: 22, value: 5 },
      mage: { name: '法師', icon: '🔮', hp: 90, atk: 24, range: 210, speed: 52, cd: 1.6, r: 22, proj: 'orb', splash: 70, value: 8 },
      giant: { name: '巨人', icon: '🗿', hp: 700, atk: 42, range: 10, speed: 38, cd: 1.5, r: 34, value: 20, named: true },
      tank: { name: '戰車', icon: '🛡️', hp: 1100, atk: 60, range: 170, speed: 46, cd: 2.0, r: 36, proj: 'shell', splash: 95, value: 40, named: true },
      dragon: { name: '巨龍', icon: '🐉', hp: 4500, atk: 75, range: 190, speed: 44, cd: 1.2, r: 60, proj: 'fire', splash: 115, value: 150, named: true, flying: true },
    },

    gifts: GIFT_SETS[PLATFORM],

    // 沒在清單裡的禮物，依價值（金幣／抖幣）自動給效果
    fallbackGift(diamond) {
      if (diamond >= 1000) return { icon: '🎁', desc: '巨龍降臨', tier: 4, effects: [{ type: 'spawn', unit: 'dragon', n: 1 }, { type: 'meteor', n: 8, dmg: 260 }] };
      if (diamond >= 200) return { icon: '🎁', desc: '空投部隊', tier: 3, effects: [{ type: 'airdrop', unit: 'soldier', n: 10 }, { type: 'airdrop', unit: 'giant', n: 1 }] };
      if (diamond >= 30) return { icon: '🎁', desc: '召喚巨人', tier: 2, effects: [{ type: 'spawn', unit: 'giant', n: 1 }] };
      if (diamond >= 5) return { icon: '🎁', desc: '召喚騎士', tier: 1, effects: [{ type: 'spawn', unit: 'knight', n: Math.min(4, Math.ceil(diamond / 5)) }] };
      return { icon: '🎁', desc: '召喚小兵', tier: 1, effects: [{ type: 'spawn', unit: 'soldier', n: 2 }] };
    },

    // 關注、分享的獎勵
    followEffects: [{ type: 'spawn', unit: 'knight', n: 1 }],
    shareEffects: [{ type: 'spawn', unit: 'soldier', n: 3 }],
  };
})();
