// 遊戲主程式：紅藍兩隊攻城戰，畫面為 1080×1920 直立。
(function () {
  const DG = (window.DG = window.DG || {});
  const C = DG.CONFIG;
  const A = DG.Audio;
  const L = C.layout;
  const W = C.W;
  const H = C.H;

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const other = (t) => (t === 'red' ? 'blue' : 'red');
  const fmtTime = (s) => {
    s = Math.max(0, Math.ceil(s));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };
  const short = (name, n = 8) => (name.length > n ? name.slice(0, n) + '…' : name);

  // 依名稱找禮物設定
  const giftIndex = new Map();
  for (const g of C.gifts) {
    for (const n of g.names) giftIndex.set(n.trim().toLowerCase(), g);
    for (const id of g.ids || []) giftIndex.set('id:' + id, g);
  }
  function findGift(gift) {
    if (gift.id && giftIndex.has('id:' + gift.id)) return giftIndex.get('id:' + gift.id);
    const n = String(gift.name || '').trim().toLowerCase();
    return giftIndex.get(n) || null;
  }

  const kw = {};
  for (const k of ['red', 'blue']) kw[k] = new Set(C.keywords[k].map((s) => s.toLowerCase()));

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // 設定字型，太長時自動縮小到放得下
  function fitFont(ctx, str, maxW, size, weight) {
    let s = size;
    ctx.font = `${weight} ${s}px "PingFang TC","Noto Sans TC",sans-serif`;
    while (ctx.measureText(str).width > maxW && s > 14) {
      s -= 2;
      ctx.font = `${weight} ${s}px "PingFang TC","Noto Sans TC",sans-serif`;
    }
  }

  const avatarCache = new Map();
  function avatarImg(url) {
    if (!url) return null;
    let img = avatarCache.get(url);
    if (!img) {
      img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.src = url;
      avatarCache.set(url, img);
      if (avatarCache.size > 300) avatarCache.delete(avatarCache.keys().next().value);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  let uid = 0;

  class Game {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      canvas.width = W;
      canvas.height = H;
      this.players = new Map();
      this.series = { red: 0, blue: 0 };
      this.round = 0;
      this.feed = [];
      this.pending = [];
      this.sprites = new Map();
      this.bg = this.renderBackground();
      this.lastEventAt = performance.now();
      this.reset();
      this.last = performance.now();
      this.time = 0;
      const loop = (now) => {
        const dt = Math.min(0.05, (now - this.last) / 1000);
        this.last = now;
        this.update(dt);
        this.draw();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    // ───────────────────────── 回合 ─────────────────────────
    reset() {
      this.round++;
      this.units = [];
      this.projectiles = [];
      this.particles = [];
      this.texts = [];
      this.fx = [];
      this.banners = [];
      this.banner = null;
      this.flash = 0;
      this.flashColor = '#fff';
      this.shake = 0;
      this.castles = {
        red: { hp: C.castleHP, max: C.castleHP, shield: 0, hit: 0 },
        blue: { hp: C.castleHP, max: C.castleHP, shield: 0, hit: 0 },
      };
      this.buffs = { red: { rage: 0, freeze: 0 }, blue: { rage: 0, freeze: 0 } };
      this.queue = { red: [], blue: [] };
      this.spawnAcc = { red: 0, blue: 0 };
      this.likes = { red: 0, blue: 0 };
      this.timeLeft = C.roundSeconds;
      this.state = 'play';
      this.winner = null;
      this.endTimer = 0;
      for (const p of this.players.values()) {
        p.score = 0;
        p.kills = 0;
        p.diamonds = 0;
      }
      const pend = this.pending;
      this.pending = [];
      pend.forEach((e) => this.handleEvent(e));
      this.announce({ text: `第 ${this.round} 局 開戰！`, sub: '評論 1 加入紅隊 · 評論 2 加入藍隊', team: null, tier: 2 });
    }

    endRound(winner, reason) {
      if (this.state !== 'play') return;
      this.state = 'end';
      this.winner = winner;
      this.endReason = reason;
      this.endTimer = C.intermission;
      if (winner) this.series[winner]++;
      const top = (team) => [...this.players.values()].filter((p) => p.team === team && p.score > 0).sort((a, b) => b.score - a.score)[0];
      this.mvp = { red: top('red'), blue: top('blue') };
      this.banners = [];
      this.banner = null;
      A.win();
      for (let i = 0; i < 160; i++) this.confetti();
    }

    // ───────────────────────── 事件 ─────────────────────────
    getPlayer(user) {
      const id = user.id || user.name;
      let p = this.players.get(id);
      if (!p) {
        p = { id, name: user.name || '觀眾', avatar: user.avatar, team: null, score: 0, kills: 0, diamonds: 0, chargeCd: 0, joinedRound: 0 };
        this.players.set(id, p);
      } else {
        if (user.name) p.name = user.name;
        if (user.avatar) p.avatar = user.avatar;
      }
      return p;
    }

    teamSize(team) {
      let n = 0;
      for (const p of this.players.values()) if (p.team === team) n++;
      return n;
    }

    join(p, team, announce) {
      const switched = p.team && p.team !== team;
      if (p.team === team && p.joinedRound === this.round) return;
      p.team = team;
      if (switched) {
        // 換隊時把場上的兵留給原隊，但移除名牌
        for (const u of this.units) if (u.owner === p) u.owner = null;
      }
      p.joinedRound = this.round;
      this.enqueue(team, 'soldier', 1, p, { label: true });
      if (announce) this.pushFeed(`${short(p.name)} 加入${C.teams[team].name}`, team);
    }

    autoTeam(p) {
      if (!p.team) {
        const r = this.teamSize('red');
        const b = this.teamSize('blue');
        this.join(p, r === b ? (Math.random() < 0.5 ? 'red' : 'blue') : r < b ? 'red' : 'blue', true);
      }
      return p.team;
    }

    handleEvent(e) {
      if (!e || !e.user) return;
      this.lastEventAt = performance.now();
      if (this.state !== 'play') {
        if (e.type === 'gift' || e.type === 'like') this.pending.push(e);
        if (this.pending.length > 500) this.pending.shift();
        if (e.type === 'chat') {
          const p = this.getPlayer(e.user);
          const t = String(e.text || '').trim().toLowerCase();
          if (kw.red.has(t)) p.team = 'red';
          else if (kw.blue.has(t)) p.team = 'blue';
        }
        return;
      }
      const p = this.getPlayer(e.user);
      switch (e.type) {
        case 'chat':
          return this.onChat(p, String(e.text || ''));
        case 'like':
          return this.onLike(p, e.count || 1);
        case 'gift':
          return this.onGift(p, e.gift || {});
        case 'follow':
          this.autoTeam(p);
          this.applyEffects(p.team, p, C.followEffects, 1);
          this.announce({ text: `${short(p.name)} 追蹤了主播`, sub: '獲得騎士一名', team: p.team, tier: 1, icon: '⭐', avatar: p.avatar });
          return;
        case 'share':
          this.autoTeam(p);
          this.applyEffects(p.team, p, C.shareEffects, 1);
          this.pushFeed(`${short(p.name)} 分享直播間 +3 小兵`, p.team);
          return;
        case 'enter':
          if (Math.random() < 0.3) this.pushFeed(`${short(p.name)} 來了`, null);
          return;
      }
    }

    onChat(p, text) {
      const t = text.trim().toLowerCase();
      if (kw.red.has(t)) return this.join(p, 'red', true);
      if (kw.blue.has(t)) return this.join(p, 'blue', true);
      if (!p.team) return;
      if (C.keywords.charge.some((k) => t.includes(k.toLowerCase())) && p.chargeCd <= 0) {
        p.chargeCd = C.chargeCooldown;
        let any = false;
        for (const u of this.units) {
          if (u.owner === p && !u.dead) {
            u.charge = 3;
            any = true;
          }
        }
        if (!any) this.enqueue(p.team, 'soldier', 1, p, { label: true });
      }
      // 在玩家的兵頭上冒出評論泡泡
      const mine = this.units.find((u) => u.owner === p && !u.dead && u.label);
      if (mine) mine.bubble = { text: short(text, 12), t: 3 };
    }

    onLike(p, count) {
      const team = this.autoTeam(p);
      this.likes[team] += count;
      const n = Math.floor(this.likes[team] / C.likesPerSpawn);
      if (n > 0) {
        this.likes[team] -= n * C.likesPerSpawn;
        this.enqueue(team, 'soldier', Math.min(n, 30), p);
      }
      const y = team === 'red' ? L.redFront + 40 : L.blueFront - 40;
      for (let i = 0; i < Math.min(count, 6); i++) {
        this.particles.push({ kind: 'heart', x: rand(860, 1040), y: y + rand(-20, 20), vx: rand(-30, 30), vy: rand(-140, -80), life: 1.4, max: 1.4, size: rand(22, 34), color: C.teams[team].color });
      }
    }

    onGift(p, gift) {
      const team = this.autoTeam(p);
      const def = findGift(gift) || C.fallbackGift(gift.diamond || 1);
      const count = Math.max(1, Math.min(9999, gift.count || 1));
      const value = (gift.diamond || 1) * count;
      p.diamonds += value;
      p.score += value * 2;
      this.applyEffects(team, p, def.effects, count);
      this.announce({
        text: `${short(p.name, 10)} 送出 ${gift.name || '禮物'} ×${count}`,
        sub: def.desc,
        team,
        tier: def.tier || 1,
        icon: def.icon,
        avatar: p.avatar,
      });
      A.gift(def.tier || 1);
    }

    applyEffects(team, p, effects, times) {
      const enemy = other(team);
      for (const ef of effects || []) {
        switch (ef.type) {
          case 'spawn':
            this.enqueue(team, ef.unit, Math.min((ef.n || 1) * times, ef.unit === 'dragon' ? 5 : 300), p, { label: true });
            break;
          case 'airdrop':
            this.enqueue(team, ef.unit, Math.min((ef.n || 1) * times, 300), p, { label: true, drop: true });
            break;
          case 'shield':
            this.castles[team].shield = Math.min(60, this.castles[team].shield + ef.sec * times);
            A.shield();
            break;
          case 'heal': {
            const c = this.castles[team];
            c.hp = Math.min(c.max, c.hp + (ef.castle || 0) * times);
            for (const u of this.units) {
              if (u.team === team && !u.dead) {
                u.hp = u.maxHp;
                this.particles.push({ kind: 'plus', x: u.x, y: u.y - u.r, vx: 0, vy: -60, life: 0.9, max: 0.9, size: 26, color: '#5dff8a' });
              }
            }
            this.floatText(W / 2, team === 'red' ? L.redCastleY : L.blueCastleY, `+${(ef.castle || 0) * times}`, '#5dff8a', 54);
            A.heal();
            break;
          }
          case 'rage':
            this.buffs[team].rage = Math.min(60, this.buffs[team].rage + ef.sec * times);
            break;
          case 'freeze':
            this.buffs[enemy].freeze = Math.min(20, this.buffs[enemy].freeze + ef.sec * times);
            A.freeze();
            this.flash = 0.35;
            this.flashColor = '#bff4ff';
            break;
          case 'lightning': {
            const n = Math.min(80, (ef.n || 1) * times);
            for (let i = 0; i < n; i++) this.fx.push({ kind: 'bolt', team, enemy, owner: p, dmg: ef.dmg || 150, delay: i * 0.12, t: 0, fired: false });
            break;
          }
          case 'meteor': {
            const n = Math.min(60, (ef.n || 1) * times);
            for (let i = 0; i < n; i++) this.fx.push({ kind: 'meteor', team, enemy, owner: p, dmg: ef.dmg || 200, delay: 0.4 + i * 0.18, t: 0, fired: false });
            break;
          }
        }
      }
    }

    enqueue(team, type, n, owner, opts = {}) {
      if (!C.units[type]) return;
      const q = this.queue[team];
      for (let i = 0; i < n && q.length < 800; i++) q.push({ type, owner, label: !!opts.label && (i === 0 || C.units[type].named), drop: !!opts.drop });
    }

    // ───────────────────────── 單位 ─────────────────────────
    spawnUnit(team, req) {
      const def = C.units[req.type];
      const dir = C.teams[team].dir;
      let x = rand(70, W - 70);
      let y = (team === 'red' ? L.redFront : L.blueFront) + dir * rand(10, 40);
      if (req.drop) {
        // 空投：落在己方半場前線
        const mid = (L.redFront + L.blueFront) / 2;
        y = team === 'red' ? rand(L.redFront + 120, mid - 40) : rand(mid + 40, L.blueFront - 120);
      }
      const u = {
        id: ++uid,
        team,
        type: req.type,
        def,
        x,
        y,
        r: def.r,
        hp: def.hp,
        maxHp: def.hp,
        cd: rand(0, def.cd),
        owner: req.owner || null,
        label: req.label && req.owner ? req.owner.name : null,
        target: null,
        retarget: 0,
        charge: 0,
        bubble: null,
        drop: req.drop ? 1 : 0,
        spawnT: 0,
        hitT: 0,
        bob: rand(0, Math.PI * 2),
        dead: false,
      };
      this.units.push(u);
      A.spawn();
      if (req.type === 'dragon') {
        A.roar();
        this.shake = Math.max(this.shake, 18);
        this.flash = 0.5;
        this.flashColor = C.teams[team].light;
        this.announce({ text: '🐉 巨龍降臨！', sub: `${req.owner ? short(req.owner.name) : ''} 召喚了巨龍`, team, tier: 4 });
      }
      for (let i = 0; i < (def.named ? 24 : 6); i++) this.particles.push({ kind: 'dot', x, y, vx: rand(-120, 120), vy: rand(-120, 120), life: 0.5, max: 0.5, size: rand(3, 7), color: C.teams[team].light });
    }

    damageUnit(t, dmg, srcOwner) {
      if (t.dead || t.drop > 0) return;
      t.hp -= dmg;
      t.hitT = 0.12;
      if (dmg >= 40) this.floatText(t.x + rand(-10, 10), t.y - t.r - 10, Math.round(dmg), '#fff3a0', dmg >= 150 ? 40 : 30);
      if (t.hp <= 0) {
        t.dead = true;
        A.die();
        if (srcOwner) {
          srcOwner.kills++;
          srcOwner.score += t.def.value;
        }
        const n = t.def.named ? 40 : 10;
        for (let i = 0; i < n; i++) {
          const a = rand(0, Math.PI * 2);
          const s = rand(60, t.def.named ? 380 : 200);
          this.particles.push({ kind: 'dot', x: t.x, y: t.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.6, max: 0.6, size: rand(3, t.def.named ? 10 : 6), color: i % 2 ? C.teams[t.team].color : '#ffffff' });
        }
        if (t.def.named) {
          this.shake = Math.max(this.shake, t.type === 'dragon' ? 22 : 8);
          A.boom();
          if (t.type === 'dragon') this.pushFeed(`${C.teams[t.team].name}的巨龍被擊敗了！`, other(t.team));
        }
      }
    }

    damageCastle(team, dmg, srcOwner) {
      const c = this.castles[team];
      if (this.state !== 'play') return;
      if (c.shield > 0) {
        c.hit = 0.15;
        return;
      }
      c.hp = Math.max(0, c.hp - dmg);
      c.hit = 0.15;
      A.castleHit();
      if (srcOwner) srcOwner.score += dmg * 0.2;
      if (dmg >= 60) this.floatText(rand(200, W - 200), team === 'red' ? L.redFront - 30 : L.blueFront + 30, '-' + Math.round(dmg), '#ffdd55', 34);
      if (c.hp <= 0) {
        this.shake = 30;
        A.boom();
        this.endRound(other(team), 'castle');
      }
    }

    splash(team, x, y, radius, dmg, owner) {
      for (const u of this.units) {
        if (u.team === team || u.dead) continue;
        const dx = u.x - x;
        const dy = u.y - y;
        if (dx * dx + dy * dy <= (radius + u.r) ** 2) this.damageUnit(u, dmg, owner);
      }
      const enemy = other(team);
      const front = enemy === 'red' ? L.redFront : L.blueFront;
      if (Math.abs(y - front) < radius) this.damageCastle(enemy, dmg * 0.6, owner);
    }

    updateUnits(dt) {
      const byTeam = { red: [], blue: [] };
      for (const u of this.units) if (!u.dead) byTeam[u.team].push(u);

      for (const u of this.units) {
        if (u.dead) continue;
        u.spawnT += dt;
        u.bob += dt * 6;
        if (u.hitT > 0) u.hitT -= dt;
        if (u.bubble && (u.bubble.t -= dt) <= 0) u.bubble = null;
        if (u.drop > 0) {
          u.drop -= dt * 1.4;
          if (u.drop <= 0) {
            u.drop = 0;
            for (let i = 0; i < 12; i++) this.particles.push({ kind: 'dot', x: u.x, y: u.y + u.r * 0.6, vx: rand(-160, 160), vy: rand(-60, 10), life: 0.45, max: 0.45, size: rand(3, 6), color: '#d9c38c' });
          }
          continue;
        }
        if (this.buffs[u.team].freeze > 0) continue;

        const def = u.def;
        const rage = this.buffs[u.team].rage > 0;
        const enemyTeam = other(u.team);
        const dir = C.teams[u.team].dir;
        if (u.charge > 0) u.charge -= dt;
        const spd = def.speed * (rage ? 1.35 : 1) * (u.charge > 0 ? 1.9 : 1);
        u.cd -= dt * (rage ? 1.5 : 1);

        u.retarget -= dt;
        if (!u.target || u.target.dead || u.retarget <= 0) {
          u.retarget = 0.25 + Math.random() * 0.1;
          const aggro = Math.max(300, def.range + 120);
          let best = null;
          let bd = aggro * aggro;
          for (const e of byTeam[enemyTeam]) {
            if (e.drop > 0) continue;
            const dx = e.x - u.x;
            const dy = e.y - u.y;
            const d = dx * dx + dy * dy;
            if (d < bd) {
              bd = d;
              best = e;
            }
          }
          u.target = best;
        }

        const t = u.target;
        if (t) {
          const dx = t.x - u.x;
          const dy = t.y - u.y;
          const dist = Math.hypot(dx, dy) || 1;
          if (dist - u.r - t.r <= def.range) {
            if (u.cd <= 0) {
              u.cd = def.cd;
              this.attack(u, t, rage);
            }
          } else {
            u.x += (dx / dist) * spd * dt;
            u.y += (dy / dist) * spd * dt;
          }
        } else {
          const front = enemyTeam === 'red' ? L.redFront : L.blueFront;
          const gap = Math.abs(front - u.y) - u.r;
          if (gap <= def.range + 4) {
            if (u.cd <= 0) {
              u.cd = def.cd;
              this.attack(u, null, rage);
            }
          } else {
            u.y += dir * spd * dt;
          }
        }
      }

      // 同隊互相推開，避免疊在一起
      for (const team of ['red', 'blue']) {
        const arr = byTeam[team];
        for (let i = 0; i < arr.length; i++) {
          const a = arr[i];
          if (a.def.flying) continue;
          for (let j = i + 1; j < arr.length; j++) {
            const b = arr[j];
            if (b.def.flying) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const min = (a.r + b.r) * 0.85;
            const d2 = dx * dx + dy * dy;
            if (d2 < min * min && d2 > 0.01) {
              const d = Math.sqrt(d2);
              const push = ((min - d) / d) * 0.5;
              const wa = b.r / (a.r + b.r);
              a.x -= dx * push * wa;
              a.y -= dy * push * wa;
              b.x += dx * push * (1 - wa);
              b.y += dy * push * (1 - wa);
            }
          }
        }
      }
      for (const u of this.units) {
        u.x = clamp(u.x, 40, W - 40);
        u.y = clamp(u.y, L.redFront + u.r * 0.5, L.blueFront - u.r * 0.5);
      }
      this.units = this.units.filter((u) => !u.dead);
    }

    attack(u, target, rage) {
      const def = u.def;
      const dmg = def.atk * (rage ? 1.6 : 1);
      const enemy = other(u.team);
      if (def.proj) {
        const tx = target ? target.x : u.x + rand(-30, 30);
        const ty = target ? target.y : enemy === 'red' ? L.redFront - 30 : L.blueFront + 30;
        this.projectiles.push({ kind: def.proj, team: u.team, owner: u.owner, x: u.x, y: u.y - (def.flying ? 30 : 0), sx: u.x, sy: u.y, tx, ty, target, dmg, splash: def.splash || 0, speed: def.proj === 'arrow' ? 720 : def.proj === 'shell' ? 600 : 480, castle: !target });
        A.shoot();
      } else if (target) {
        this.damageUnit(target, dmg, u.owner);
        A.hit();
        for (let i = 0; i < 3; i++) this.particles.push({ kind: 'dot', x: (u.x + target.x) / 2, y: (u.y + target.y) / 2, vx: rand(-90, 90), vy: rand(-90, 90), life: 0.25, max: 0.25, size: rand(2, 5), color: '#fff6c8' });
      } else {
        this.damageCastle(enemy, dmg, u.owner);
        for (let i = 0; i < 3; i++) this.particles.push({ kind: 'dot', x: u.x, y: enemy === 'red' ? L.redFront : L.blueFront, vx: rand(-90, 90), vy: rand(-90, 90), life: 0.3, max: 0.3, size: rand(3, 6), color: '#c9b48a' });
      }
    }

    updateProjectiles(dt) {
      for (const p of this.projectiles) {
        if (p.target && !p.target.dead) {
          p.tx = p.target.x;
          p.ty = p.target.y;
        }
        const dx = p.tx - p.x;
        const dy = p.ty - p.y;
        const d = Math.hypot(dx, dy);
        const step = p.speed * dt;
        if (d <= step + 6) {
          p.done = true;
          const enemy = other(p.team);
          if (p.splash) {
            this.splash(p.team, p.tx, p.ty, p.splash, p.dmg, p.owner);
            this.explosion(p.tx, p.ty, p.splash, p.kind === 'fire' ? '#ff7a1a' : p.kind === 'orb' ? '#c27bff' : '#ffb347');
            if (p.kind !== 'orb') A.boom();
          } else if (p.castle) {
            this.damageCastle(enemy, p.dmg, p.owner);
          } else if (p.target && !p.target.dead) {
            this.damageUnit(p.target, p.dmg, p.owner);
          }
        } else {
          p.x += (dx / d) * step;
          p.y += (dy / d) * step;
          p.angle = Math.atan2(dy, dx);
          if (p.kind === 'fire' || p.kind === 'orb') this.particles.push({ kind: 'dot', x: p.x, y: p.y, vx: rand(-20, 20), vy: rand(-20, 20), life: 0.3, max: 0.3, size: rand(4, 9), color: p.kind === 'fire' ? '#ffb030' : '#d8a8ff' });
        }
      }
      this.projectiles = this.projectiles.filter((p) => !p.done);
    }

    pickStrikeTarget(enemy) {
      const list = this.units.filter((u) => u.team === enemy && !u.dead && u.drop <= 0);
      if (!list.length) return null;
      // 偏好血多的大單位
      list.sort((a, b) => b.hp - a.hp);
      return list[Math.floor(Math.pow(Math.random(), 2) * list.length)];
    }

    updateFx(dt) {
      for (const f of this.fx) {
        f.delay -= dt;
        if (f.delay > 0) continue;
        f.t += dt;
        if (!f.fired) {
          f.fired = true;
          const target = this.pickStrikeTarget(f.enemy);
          if (target) {
            f.x = target.x + rand(-15, 15);
            f.y = target.y + rand(-15, 15);
          } else {
            f.x = rand(120, W - 120);
            f.y = f.enemy === 'red' ? L.redFront - 20 : L.blueFront + 20;
          }
          if (f.kind === 'bolt') {
            f.life = 0.35;
            f.path = this.boltPath(f.x, f.y);
            this.splash(f.team, f.x, f.y, 85, f.dmg, f.owner);
            this.explosion(f.x, f.y, 60, '#bfe8ff');
            this.flash = Math.max(this.flash, 0.12);
            this.flashColor = '#e6f6ff';
            this.shake = Math.max(this.shake, 6);
            A.thunder();
          } else {
            f.life = 0.8; // 下落時間
            f.sx = f.x + 380;
            f.sy = f.y - 900;
          }
        }
        if (f.kind === 'meteor' && !f.impact && f.t >= f.life) {
          f.impact = true;
          f.life += 0.4;
          this.splash(f.team, f.x, f.y, 120, f.dmg, f.owner);
          this.explosion(f.x, f.y, 120, '#ff6a00');
          this.shake = Math.max(this.shake, 14);
          A.boom();
        }
        if (f.t >= f.life && (f.kind === 'bolt' || f.impact)) f.done = true;
      }
      this.fx = this.fx.filter((f) => !f.done);
    }

    boltPath(x, y) {
      const pts = [[x + rand(-80, 80), y - 900]];
      const segs = 12;
      for (let i = 1; i < segs; i++) {
        const k = i / segs;
        pts.push([pts[0][0] + (x - pts[0][0]) * k + rand(-40, 40), y - 900 + 900 * k]);
      }
      pts.push([x, y]);
      return pts;
    }

    explosion(x, y, radius, color) {
      this.particles.push({ kind: 'ring', x, y, vx: 0, vy: 0, life: 0.4, max: 0.4, size: radius, color });
      const n = Math.min(30, Math.round(radius / 4));
      for (let i = 0; i < n; i++) {
        const a = rand(0, Math.PI * 2);
        const s = rand(60, radius * 3);
        this.particles.push({ kind: 'dot', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5, max: 0.5, size: rand(4, 10), color: i % 3 ? color : '#fff2b0' });
      }
    }

    confetti() {
      const colors = ['#ff4d5e', '#3d8bff', '#ffd23f', '#5dff8a', '#ff8ad8', '#ffffff'];
      this.particles.push({ kind: 'confetti', x: rand(0, W), y: rand(-400, 0), vx: rand(-60, 60), vy: rand(150, 380), life: 5, max: 5, size: rand(10, 20), color: colors[Math.floor(rand(0, colors.length))], rot: rand(0, 6), vr: rand(-8, 8) });
    }

    floatText(x, y, text, color, size) {
      if (this.texts.length > 80) this.texts.shift();
      this.texts.push({ x, y, text: String(text), color, size, life: 1, max: 1 });
    }

    pushFeed(text, team) {
      this.feed.push({ text, team, t: 8 });
      if (this.feed.length > 6) this.feed.shift();
    }

    announce(b) {
      b.t = 0;
      b.dur = b.tier >= 4 ? 3.6 : b.tier >= 3 ? 2.6 : b.tier >= 2 ? 1.8 : 1.3;
      // 低階禮物太多時合併成資訊列，不搶畫面
      if (b.tier <= 1 && this.banners.length >= 3) {
        this.pushFeed(b.text, b.team);
        return;
      }
      this.banners.push(b);
      if (this.banners.length > 12) this.banners.splice(0, this.banners.length - 12);
    }

    // ───────────────────────── 更新 ─────────────────────────
    update(dt) {
      this.time += dt;
      for (const p of this.players.values()) if (p.chargeCd > 0) p.chargeCd -= dt;

      if (this.state === 'play') {
        this.timeLeft -= dt;
        for (const team of ['red', 'blue']) {
          const b = this.buffs[team];
          b.rage = Math.max(0, b.rage - dt);
          b.freeze = Math.max(0, b.freeze - dt);
          const c = this.castles[team];
          c.shield = Math.max(0, c.shield - dt);
          c.hit = Math.max(0, c.hit - dt);
          // 出兵
          this.spawnAcc[team] += dt * C.spawnPerSecond;
          let alive = 0;
          for (const u of this.units) if (u.team === team) alive++;
          while (this.spawnAcc[team] >= 1 && this.queue[team].length && alive < C.maxUnitsPerTeam) {
            this.spawnAcc[team] -= 1;
            this.spawnUnit(team, this.queue[team].shift());
            alive++;
          }
          this.spawnAcc[team] = Math.min(this.spawnAcc[team], 3);
        }
        this.updateUnits(dt);
        this.updateProjectiles(dt);
        this.updateFx(dt);
        if (this.timeLeft <= 0 && this.state === 'play') {
          const r = this.castles.red.hp / this.castles.red.max;
          const b = this.castles.blue.hp / this.castles.blue.max;
          this.endRound(r === b ? null : r > b ? 'red' : 'blue', 'time');
        }
      } else {
        this.endTimer -= dt;
        if (Math.random() < 0.5) this.confetti();
        if (this.endTimer <= 0) this.reset();
      }

      // 粒子
      for (const p of this.particles) {
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.kind === 'dot') {
          p.vx *= 0.92;
          p.vy *= 0.92;
        } else if (p.kind === 'confetti') {
          p.rot += p.vr * dt;
          p.vx += Math.sin(this.time * 3 + p.y * 0.01) * 20 * dt;
        }
      }
      this.particles = this.particles.filter((p) => p.life > 0 && p.y < H + 50);
      if (this.particles.length > 1800) this.particles.splice(0, this.particles.length - 1800);
      for (const t of this.texts) {
        t.life -= dt;
        t.y -= 50 * dt;
      }
      this.texts = this.texts.filter((t) => t.life > 0);
      for (const f of this.feed) f.t -= dt;
      this.feed = this.feed.filter((f) => f.t > 0);

      // 橫幅
      if (!this.banner && this.banners.length) this.banner = this.banners.shift();
      if (this.banner) {
        const speed = this.banners.length > 3 ? 2 : 1;
        this.banner.t += dt * speed;
        if (this.banner.t >= this.banner.dur) this.banner = null;
      }
      if (this.flash > 0) this.flash -= dt;
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 40);
    }

    // ───────────────────────── 繪製 ─────────────────────────
    renderBackground() {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d');
      // 草地
      const grd = g.createLinearGradient(0, L.redFront, 0, L.blueFront);
      grd.addColorStop(0, '#3e7a3a');
      grd.addColorStop(0.5, '#4f9145');
      grd.addColorStop(1, '#3e7a3a');
      const sky = g.createLinearGradient(0, 0, 0, L.redFront);
      sky.addColorStop(0, '#0d1024');
      sky.addColorStop(1, '#2f3a66');
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 60; i++) {
        g.fillStyle = `rgba(255,255,255,${Math.random() * 0.6 + 0.2})`;
        g.fillRect(Math.random() * W, 120 + Math.random() * 100, 2, 2);
      }
      const ground = g.createLinearGradient(0, L.blueFront, 0, 1650);
      ground.addColorStop(0, '#3a5a34');
      ground.addColorStop(1, '#22301f');
      g.fillStyle = ground;
      g.fillRect(0, L.blueFront, W, 1650 - L.blueFront);
      g.fillStyle = grd;
      g.fillRect(0, L.redFront - 120, W, L.blueFront - L.redFront + 240);
      // 草地條紋
      for (let y = L.redFront; y < L.blueFront; y += 90) {
        g.fillStyle = 'rgba(255,255,255,0.035)';
        g.fillRect(0, y, W, 45);
      }
      // 小草點綴
      for (let i = 0; i < 500; i++) {
        g.fillStyle = Math.random() < 0.5 ? 'rgba(20,60,20,0.35)' : 'rgba(150,210,120,0.25)';
        const x = Math.random() * W;
        const y = L.redFront + Math.random() * (L.blueFront - L.redFront);
        g.fillRect(x, y, 2, 6);
      }
      // 小花
      for (let i = 0; i < 40; i++) {
        g.fillStyle = ['#ffe36e', '#ffffff', '#ff9ec7'][i % 3];
        g.beginPath();
        g.arc(Math.random() * W, L.redFront + 60 + Math.random() * (L.blueFront - L.redFront - 120), 3, 0, Math.PI * 2);
        g.fill();
      }
      // 中線
      const mid = (L.redFront + L.blueFront) / 2;
      g.setLineDash([24, 18]);
      g.strokeStyle = 'rgba(255,255,255,0.25)';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(0, mid);
      g.lineTo(W, mid);
      g.stroke();
      g.setLineDash([]);
      g.beginPath();
      g.arc(W / 2, mid, 90, 0, Math.PI * 2);
      g.stroke();
      // 底部面板底色
      g.fillStyle = '#141826';
      g.fillRect(0, 1650, W, H - 1650);
      return c;
    }

    sprite(team, type) {
      const key = team + type;
      let s = this.sprites.get(key);
      if (s) return s;
      const def = C.units[type];
      const tc = C.teams[team];
      const r = def.r;
      const size = Math.ceil(r * 2 + 10);
      s = document.createElement('canvas');
      s.width = size;
      s.height = size;
      const g = s.getContext('2d');
      const cx = size / 2;
      const grd = g.createRadialGradient(cx - r * 0.35, cx - r * 0.35, r * 0.1, cx, cx, r);
      grd.addColorStop(0, tc.light);
      grd.addColorStop(0.55, tc.color);
      grd.addColorStop(1, tc.dark);
      g.fillStyle = grd;
      g.beginPath();
      g.arc(cx, cx, r, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = Math.max(2, r * 0.12);
      g.strokeStyle = def.named ? '#ffd23f' : 'rgba(255,255,255,0.85)';
      g.stroke();
      g.font = `${Math.round(r * 1.15)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(def.icon, cx, cx + r * 0.08);
      this.sprites.set(key, s);
      return s;
    }

    draw() {
      const ctx = this.ctx;
      ctx.save();
      if (this.shake > 0) ctx.translate(rand(-this.shake, this.shake), rand(-this.shake, this.shake));
      ctx.drawImage(this.bg, 0, 0);

      this.drawCastle('red');
      this.drawCastle('blue');
      this.drawUnits();
      this.drawProjectiles();
      this.drawFx();
      this.drawParticles();
      this.drawTexts();
      ctx.restore();

      if (this.flash > 0) {
        ctx.globalAlpha = Math.min(0.6, this.flash);
        ctx.fillStyle = this.flashColor;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
      this.drawHeader();
      this.drawLeaderboard();
      this.drawFeed();
      this.drawLegend();
      this.drawBanner();
      if (this.state === 'end') this.drawEnd();
    }

    drawCastle(team) {
      const ctx = this.ctx;
      const tc = C.teams[team];
      const c = this.castles[team];
      const isRed = team === 'red';
      const front = isRed ? L.redFront : L.blueFront;
      const wallH = 95;
      const top = isRed ? front - wallH : front;
      const shakeX = c.hit > 0 ? rand(-3, 3) : 0;
      ctx.save();
      ctx.translate(shakeX, 0);
      // 城牆
      const stone = ctx.createLinearGradient(0, top, 0, top + wallH);
      stone.addColorStop(0, '#9aa0ad');
      stone.addColorStop(1, '#5d6270');
      ctx.fillStyle = stone;
      ctx.fillRect(0, top, W, wallH);
      // 磚縫
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 2;
      for (let row = 0; row < 4; row++) {
        const y = top + row * (wallH / 4);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
        for (let x = (row % 2) * 30; x < W; x += 60) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + wallH / 4);
          ctx.stroke();
        }
      }
      // 垛口（朝戰場那一側）
      ctx.fillStyle = '#7d8391';
      const cy = isRed ? front : front - 22;
      for (let x = 0; x < W; x += 54) ctx.fillRect(x + 6, cy, 30, 22);
      // 塔樓
      for (const tx of [90, W / 2, W - 90]) {
        const big = tx === W / 2;
        const tw = big ? 170 : 120;
        const th = big ? 120 : 100;
        const ty = isRed ? front - th - 10 : front + 10;
        ctx.fillStyle = '#868c99';
        ctx.fillRect(tx - tw / 2, ty, tw, th);
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.strokeRect(tx - tw / 2, ty, tw, th);
        // 塔頂
        ctx.fillStyle = tc.color;
        ctx.beginPath();
        if (isRed) {
          ctx.moveTo(tx - tw / 2 - 10, ty);
          ctx.lineTo(tx + tw / 2 + 10, ty);
          ctx.lineTo(tx, ty - (big ? 70 : 55));
        } else {
          ctx.moveTo(tx - tw / 2 - 10, ty + th);
          ctx.lineTo(tx + tw / 2 + 10, ty + th);
          ctx.lineTo(tx, ty + th + (big ? 70 : 55));
        }
        ctx.closePath();
        ctx.fill();
        // 窗
        ctx.fillStyle = '#2a2233';
        roundRect(ctx, tx - 14, ty + th / 2 - 22, 28, 40, 14);
        ctx.fill();
        // 旗子
        const fy = isRed ? ty - (big ? 70 : 55) : ty + th + (big ? 70 : 55);
        const wave = Math.sin(this.time * 6 + tx) * 6;
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(tx, fy);
        ctx.lineTo(tx, fy + (isRed ? -40 : 40));
        ctx.stroke();
        ctx.fillStyle = tc.light;
        const fpy = fy + (isRed ? -40 : 22);
        ctx.beginPath();
        ctx.moveTo(tx, fpy);
        ctx.lineTo(tx + 34, fpy + 9 + wave * 0.5);
        ctx.lineTo(tx, fpy + 18);
        ctx.fill();
      }
      // 受擊閃白
      if (c.hit > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(0, top, W, wallH);
      }
      // 護盾
      if (c.shield > 0) {
        const a = 0.35 + Math.sin(this.time * 8) * 0.1;
        ctx.fillStyle = `rgba(120,220,255,${a * 0.5})`;
        ctx.strokeStyle = `rgba(180,240,255,${a + 0.3})`;
        ctx.lineWidth = 6;
        ctx.beginPath();
        if (isRed) ctx.ellipse(W / 2, front - 60, W * 0.62, 150, 0, 0, Math.PI);
        else ctx.ellipse(W / 2, front + 60, W * 0.62, 150, 0, Math.PI, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();

      // 血條
      const barW = 640;
      const barH = 36;
      const bx = (W - barW) / 2;
      const by = isRed ? front - wallH / 2 - barH / 2 + 10 : front + wallH / 2 - barH / 2 - 10;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      roundRect(ctx, bx - 6, by - 6, barW + 12, barH + 12, 16);
      ctx.fill();
      const ratio = c.hp / c.max;
      const hg = ctx.createLinearGradient(bx, 0, bx + barW, 0);
      hg.addColorStop(0, tc.dark);
      hg.addColorStop(1, tc.color);
      ctx.fillStyle = hg;
      roundRect(ctx, bx, by, Math.max(barH, barW * ratio), barH, 12);
      ctx.fill();
      ctx.font = 'bold 26px "PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      const label = `${tc.name}城堡 ${Math.ceil(c.hp)} / ${c.max}`;
      ctx.strokeText(label, W / 2, by + barH / 2 + 1);
      ctx.fillText(label, W / 2, by + barH / 2 + 1);

      // 狀態圖示
      const b = this.buffs[team];
      const tags = [];
      if (c.shield > 0) tags.push(`🛡️ ${Math.ceil(c.shield)}s`);
      if (b.rage > 0) tags.push(`🔥狂暴 ${Math.ceil(b.rage)}s`);
      if (b.freeze > 0) tags.push(`❄️冰凍 ${Math.ceil(b.freeze)}s`);
      const q = this.queue[team].length;
      if (q > 0) tags.push(`⏳待出兵 ${q}`);
      if (tags.length) {
        ctx.font = 'bold 26px "PingFang TC","Noto Sans TC",sans-serif';
        const ty = isRed ? front + 26 : front - 26;
        let x = 20;
        ctx.textAlign = 'left';
        for (const t of tags) {
          const w = ctx.measureText(t).width + 24;
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          roundRect(ctx, x, ty - 20, w, 40, 20);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.fillText(t, x + 12, ty + 1);
          x += w + 10;
        }
      }
    }

    drawUnits() {
      const ctx = this.ctx;
      // 先畫陰影，飛行單位最後畫
      const sorted = this.units.slice().sort((a, b) => (a.def.flying ? 1 : 0) - (b.def.flying ? 1 : 0) || a.y - b.y);
      for (const u of sorted) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.ellipse(u.x, u.y + u.r * 0.7, u.r * (u.drop > 0 ? 0.5 + (1 - u.drop) * 0.5 : 0.9), u.r * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const u of sorted) {
        const frozen = this.buffs[u.team].freeze > 0 && u.drop <= 0;
        const rage = this.buffs[u.team].rage > 0;
        const walk = frozen ? 0 : Math.abs(Math.sin(u.bob)) * 4;
        const lift = u.def.flying ? 40 + Math.sin(u.bob * 0.5) * 8 : u.drop > 0 ? u.drop * 700 : 0;
        const x = u.x;
        const y = u.y - walk - lift;
        const pop = Math.min(1, u.spawnT * 5);
        const s = this.sprite(u.team, u.type);
        const scale = pop * (u.hitT > 0 ? 1.12 : 1);
        if (u.drop > 0) {
          // 降落傘
          ctx.fillStyle = C.teams[u.team].light;
          ctx.beginPath();
          ctx.arc(x, y - u.r - 40, u.r + 26, Math.PI, 0);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x - u.r - 26, y - u.r - 40);
          ctx.lineTo(x, y);
          ctx.moveTo(x + u.r + 26, y - u.r - 40);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        if (rage && !frozen) {
          ctx.fillStyle = `rgba(255,120,30,${0.25 + Math.sin(this.time * 12 + u.id) * 0.1})`;
          ctx.beginPath();
          ctx.arc(x, y, u.r + 8, 0, Math.PI * 2);
          ctx.fill();
        }
        if (u.charge > 0 && !frozen) {
          const dir = C.teams[u.team].dir;
          ctx.strokeStyle = 'rgba(255,255,255,0.7)';
          ctx.lineWidth = 3;
          for (let i = -1; i <= 1; i++) {
            ctx.beginPath();
            ctx.moveTo(x + i * 10, y - dir * (u.r + 6));
            ctx.lineTo(x + i * 10, y - dir * (u.r + 30));
            ctx.stroke();
          }
        }
        ctx.drawImage(s, x - (s.width / 2) * scale, y - (s.height / 2) * scale, s.width * scale, s.height * scale);
        if (u.hitT > 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.5)';
          ctx.beginPath();
          ctx.arc(x, y, u.r, 0, Math.PI * 2);
          ctx.fill();
        }
        if (frozen) {
          ctx.fillStyle = 'rgba(170,235,255,0.55)';
          ctx.strokeStyle = 'rgba(230,250,255,0.9)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + 0.3;
            const rr = u.r + 6;
            if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
            else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        // 血條
        if (u.hp < u.maxHp || u.def.named) {
          const bw = Math.max(34, u.r * 2);
          const by = y - u.r - 12;
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(x - bw / 2 - 1, by - 1, bw + 2, 7);
          ctx.fillStyle = u.hp / u.maxHp > 0.5 ? '#5dff8a' : u.hp / u.maxHp > 0.25 ? '#ffd23f' : '#ff4d4d';
          ctx.fillRect(x - bw / 2, by, bw * Math.max(0, u.hp / u.maxHp), 5);
        }
        // 名牌
        if (u.label) {
          ctx.font = `bold ${u.def.named ? 24 : 20}px "PingFang TC","Noto Sans TC",sans-serif`;
          const ny = y - u.r - (u.hp < u.maxHp || u.def.named ? 28 : 16);
          ctx.lineWidth = 4;
          ctx.strokeStyle = 'rgba(0,0,0,0.75)';
          ctx.fillStyle = u.def.named ? '#ffe680' : '#ffffff';
          const name = short(u.label, 6);
          ctx.strokeText(name, x, ny);
          ctx.fillText(name, x, ny);
        }
        if (u.bubble) {
          ctx.font = 'bold 24px "PingFang TC","Noto Sans TC",sans-serif';
          const tw = ctx.measureText(u.bubble.text).width + 24;
          const bx = clamp(x - tw / 2, 8, W - tw - 8);
          const by = y - u.r - 86;
          ctx.globalAlpha = Math.min(1, u.bubble.t * 2);
          ctx.fillStyle = '#ffffff';
          roundRect(ctx, bx, by, tw, 40, 18);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(x - 8, by + 39);
          ctx.lineTo(x + 8, by + 39);
          ctx.lineTo(x, by + 52);
          ctx.fill();
          ctx.fillStyle = '#222';
          ctx.fillText(u.bubble.text, bx + tw / 2, by + 21);
          ctx.globalAlpha = 1;
        }
      }
    }

    drawProjectiles() {
      const ctx = this.ctx;
      for (const p of this.projectiles) {
        if (p.kind === 'arrow') {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle || 0);
          ctx.strokeStyle = '#f3e3c3';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(-14, 0);
          ctx.lineTo(10, 0);
          ctx.stroke();
          ctx.fillStyle = '#ddd';
          ctx.beginPath();
          ctx.moveTo(14, 0);
          ctx.lineTo(6, -5);
          ctx.lineTo(6, 5);
          ctx.fill();
          ctx.restore();
        } else {
          const color = p.kind === 'fire' ? '#ff8a1a' : p.kind === 'orb' ? '#c27bff' : '#333';
          const r = p.kind === 'fire' ? 18 : p.kind === 'orb' ? 11 : 9;
          ctx.fillStyle = color;
          ctx.shadowColor = color;
          ctx.shadowBlur = p.kind === 'shell' ? 0 : 20;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
    }

    drawFx() {
      const ctx = this.ctx;
      for (const f of this.fx) {
        if (!f.fired) continue;
        if (f.kind === 'bolt') {
          const a = 1 - f.t / f.life;
          ctx.strokeStyle = `rgba(200,235,255,${a})`;
          ctx.shadowColor = '#9fd8ff';
          ctx.shadowBlur = 25;
          for (const w of [12, 4]) {
            ctx.lineWidth = w * a + 1;
            ctx.strokeStyle = w > 5 ? `rgba(120,200,255,${a * 0.6})` : `rgba(255,255,255,${a})`;
            ctx.beginPath();
            f.path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.stroke();
          }
          ctx.shadowBlur = 0;
        } else if (f.kind === 'meteor' && !f.impact) {
          const k = Math.min(1, f.t / f.life);
          const x = f.sx + (f.x - f.sx) * k;
          const y = f.sy + (f.y - f.sy) * k;
          // 落點預警
          ctx.strokeStyle = `rgba(255,60,30,${0.4 + 0.4 * Math.sin(this.time * 20)})`;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.ellipse(f.x, f.y, 120 * k, 50 * k, 0, 0, Math.PI * 2);
          ctx.stroke();
          const trail = ctx.createLinearGradient(x, y, x + 160, y - 380);
          trail.addColorStop(0, 'rgba(255,200,80,0.9)');
          trail.addColorStop(1, 'rgba(255,80,0,0)');
          ctx.strokeStyle = trail;
          ctx.lineWidth = 26;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + 160, y - 380);
          ctx.stroke();
          ctx.lineCap = 'butt';
          ctx.fillStyle = '#ffdd88';
          ctx.shadowColor = '#ff6a00';
          ctx.shadowBlur = 40;
          ctx.beginPath();
          ctx.arc(x, y, 26, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
    }

    drawParticles() {
      const ctx = this.ctx;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const p of this.particles) {
        const a = Math.max(0, p.life / p.max);
        ctx.globalAlpha = a;
        if (p.kind === 'dot') {
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        } else if (p.kind === 'ring') {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 8 * a;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1.2 - a * 0.7), 0, Math.PI * 2);
          ctx.stroke();
        } else if (p.kind === 'heart') {
          ctx.font = `${p.size}px sans-serif`;
          ctx.fillStyle = p.color;
          ctx.fillText('❤', p.x, p.y);
        } else if (p.kind === 'plus') {
          ctx.font = `bold ${p.size}px sans-serif`;
          ctx.fillStyle = p.color;
          ctx.fillText('+', p.x, p.y);
        } else if (p.kind === 'confetti') {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
    }

    drawTexts() {
      const ctx = this.ctx;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const t of this.texts) {
        ctx.globalAlpha = Math.min(1, t.life * 2);
        ctx.font = `900 ${t.size}px "PingFang TC","Noto Sans TC",sans-serif`;
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.strokeText(t.text, t.x, t.y);
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, t.x, t.y);
      }
      ctx.globalAlpha = 1;
    }

    drawHeader() {
      const ctx = this.ctx;
      const g = ctx.createLinearGradient(0, 0, 0, 150);
      g.addColorStop(0, 'rgba(10,12,24,0.95)');
      g.addColorStop(1, 'rgba(10,12,24,0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, 150);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 46px "PingFang TC","Noto Sans TC",sans-serif';
      const tg = ctx.createLinearGradient(0, 20, 0, 70);
      tg.addColorStop(0, '#fff6c2');
      tg.addColorStop(1, '#ffb800');
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#3a1d00';
      ctx.strokeText(`⚔ ${C.title} ⚔`, W / 2, 44);
      ctx.fillStyle = tg;
      ctx.fillText(`⚔ ${C.title} ⚔`, W / 2, 44);
      // 計時
      const low = this.state === 'play' && this.timeLeft < 30;
      ctx.font = '800 40px "SF Mono","Menlo",monospace';
      ctx.fillStyle = low ? (Math.floor(this.time * 2) % 2 ? '#ff5050' : '#fff') : '#ffffff';
      ctx.fillText(this.state === 'play' ? fmtTime(this.timeLeft) : '休息中', W / 2, 100);
      // 兩隊資訊
      for (const team of ['red', 'blue']) {
        const tc = C.teams[team];
        const left = team === 'red';
        const x = left ? 30 : W - 30;
        ctx.textAlign = left ? 'left' : 'right';
        ctx.font = '900 34px "PingFang TC","Noto Sans TC",sans-serif';
        ctx.fillStyle = tc.color;
        ctx.fillText(`${tc.name}${left ? ' ▲' : ' ▼'}`, x, 42);
        ctx.font = 'bold 24px "PingFang TC","Noto Sans TC",sans-serif';
        ctx.fillStyle = '#ddd';
        let alive = 0;
        for (const u of this.units) if (u.team === team) alive++;
        ctx.fillText(`👥 ${this.teamSize(team)}  ⚔️ ${alive}  🏆 ${this.series[team]}`, x, 88);
      }
    }

    drawLeaderboard() {
      const ctx = this.ctx;
      const list = [...this.players.values()].filter((p) => p.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
      if (!list.length) return;
      const x = 18;
      const y = 470;
      const w = 300;
      const h = 54 + list.length * 46;
      ctx.fillStyle = 'rgba(10,12,24,0.55)';
      roundRect(ctx, x, y, w, h, 18);
      ctx.fill();
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = '900 26px "PingFang TC","Noto Sans TC",sans-serif';
      ctx.fillStyle = '#ffd23f';
      ctx.fillText('🏅 本局戰神榜', x + 16, y + 28);
      const medals = ['🥇', '🥈', '🥉', '4', '5'];
      list.forEach((p, i) => {
        const ry = y + 76 + i * 46;
        ctx.font = 'bold 26px "PingFang TC","Noto Sans TC",sans-serif';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(medals[i], x + 32, ry);
        ctx.textAlign = 'left';
        ctx.fillStyle = p.team ? C.teams[p.team].light : '#fff';
        ctx.fillText(short(p.name, 7), x + 58, ry);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#ffe680';
        ctx.font = 'bold 22px "PingFang TC","Noto Sans TC",sans-serif';
        ctx.fillText(Math.round(p.score), x + w - 14, ry);
      });
    }

    drawFeed() {
      const ctx = this.ctx;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 24px "PingFang TC","Noto Sans TC",sans-serif';
      let y = 1300;
      for (let i = this.feed.length - 1; i >= 0; i--) {
        const f = this.feed[i];
        ctx.globalAlpha = Math.min(1, f.t);
        const tw = ctx.measureText(f.text).width + 28;
        ctx.fillStyle = f.team ? (f.team === 'red' ? 'rgba(143,20,36,0.75)' : 'rgba(16,58,133,0.75)') : 'rgba(0,0,0,0.55)';
        roundRect(ctx, W - 18 - tw, y - 20, tw, 40, 20);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(f.text, W - 32, y + 1);
        y -= 48;
      }
      ctx.globalAlpha = 1;
    }

    drawLegend() {
      const ctx = this.ctx;
      const top = 1662;
      ctx.fillStyle = '#141826';
      ctx.fillRect(0, 1650, W, H - 1650);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.font = '900 28px "PingFang TC","Noto Sans TC",sans-serif';
      const pieces = [
        ['評論 1 ', '#fff'],
        ['加入紅隊', C.teams.red.color],
        ['　評論 2 ', '#fff'],
        ['加入藍隊', C.teams.blue.color],
        ['　666 衝鋒　按讚出兵', '#ffd23f'],
      ];
      let total = 0;
      for (const [t] of pieces) total += ctx.measureText(t).width;
      let x = (W - total) / 2;
      ctx.textAlign = 'left';
      for (const [t, c] of pieces) {
        ctx.fillStyle = c;
        ctx.fillText(t, x, top + 18);
        x += ctx.measureText(t).width;
      }
      const gifts = C.gifts.filter((g) => !g.hidden).slice(0, 12);
      const cols = 3;
      const cw = (W - 40) / cols;
      const ch = 50;
      gifts.forEach((g, i) => {
        const cx = 20 + (i % cols) * cw;
        const cy = top + 50 + Math.floor(i / cols) * ch;
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        roundRect(ctx, cx + 4, cy, cw - 8, ch - 8, 14);
        ctx.fill();
        const my = cy + (ch - 8) / 2 + 1;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fff';
        ctx.font = '28px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
        ctx.fillText(g.icon, cx + 14, my);
        ctx.font = 'bold 22px "PingFang TC","Noto Sans TC",sans-serif';
        ctx.fillStyle = '#ffe680';
        ctx.fillText(g.names[0], cx + 52, my);
        const nw = ctx.measureText(g.names[0]).width;
        ctx.fillStyle = '#e8e8f0';
        fitFont(ctx, g.desc, cw - 8 - 52 - nw - 18, 20, 'normal');
        ctx.fillText(g.desc, cx + 52 + nw + 8, my);
      });
    }

    drawBanner() {
      const b = this.banner;
      if (!b) return;
      const ctx = this.ctx;
      const k = b.t / b.dur;
      const appear = Math.min(1, b.t / 0.25);
      const vanish = Math.min(1, (b.dur - b.t) / 0.3);
      const ease = 1 - Math.pow(1 - appear, 3);
      const alpha = Math.min(appear, vanish);
      const tier = b.tier || 1;
      const color = b.team ? C.teams[b.team].color : '#ffb800';
      const dark = b.team ? C.teams[b.team].dark : '#7a4b00';
      const h = tier >= 4 ? 220 : tier >= 3 ? 170 : tier >= 2 ? 130 : 104;
      const y = tier >= 3 ? 860 : 760;
      const w = W - 80;
      const x = 40 + (1 - ease) * (b.team === 'blue' ? 300 : -300);

      ctx.save();
      ctx.globalAlpha = alpha;
      if (tier >= 4) {
        // 史詩級：全畫面光芒
        ctx.translate(W / 2, y + h / 2);
        ctx.rotate(this.time * 0.6);
        for (let i = 0; i < 16; i++) {
          ctx.rotate((Math.PI * 2) / 16);
          ctx.fillStyle = i % 2 ? 'rgba(255,220,100,0.12)' : 'rgba(255,255,255,0.06)';
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(-90, -1100);
          ctx.lineTo(90, -1100);
          ctx.fill();
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, dark);
      g.addColorStop(0.5, color);
      g.addColorStop(1, dark);
      ctx.shadowColor = tier >= 3 ? '#ffd23f' : 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = tier >= 3 ? 40 : 16;
      ctx.fillStyle = g;
      roundRect(ctx, x, y, w, h, 30);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = tier >= 3 ? 6 : 3;
      ctx.strokeStyle = tier >= 3 ? '#ffe680' : 'rgba(255,255,255,0.6)';
      ctx.stroke();
      // 掃光
      ctx.save();
      roundRect(ctx, x, y, w, h, 30);
      ctx.clip();
      const sx = x - 200 + ((k * 1.6) % 1) * (w + 400);
      const sg = ctx.createLinearGradient(sx - 80, 0, sx + 80, 0);
      sg.addColorStop(0, 'rgba(255,255,255,0)');
      sg.addColorStop(0.5, 'rgba(255,255,255,0.35)');
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(sx - 80, y, 160, h);
      ctx.restore();

      let tx = x + 30;
      const cy = y + h / 2;
      const av = avatarImg(b.avatar);
      const iconSize = h * 0.62;
      if (av) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(tx + iconSize / 2, cy, iconSize / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(av, tx, cy - iconSize / 2, iconSize, iconSize);
        ctx.restore();
        tx += iconSize + 16;
      }
      if (b.icon) {
        const bounce = 1 + Math.sin(this.time * 10) * 0.06;
        ctx.font = `${Math.round(iconSize * bounce)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.icon, tx, cy + 4);
        tx += iconSize + 20;
      }
      const textW = x + w - 30 - tx;
      const fit = (str, size, weight) => fitFont(ctx, str, textW, size, weight);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const big = tier >= 4 ? 60 : tier >= 3 ? 50 : tier >= 2 ? 42 : 36;
      fit(b.text, big, 900);
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      const ty = b.sub ? cy - h * 0.16 : cy;
      ctx.strokeText(b.text, tx, ty);
      ctx.fillStyle = '#fff';
      ctx.fillText(b.text, tx, ty);
      if (b.sub) {
        fit('➜ ' + b.sub, Math.round(big * 0.7), 800);
        ctx.fillStyle = '#ffe680';
        ctx.strokeText('➜ ' + b.sub, tx, cy + h * 0.22);
        ctx.fillText('➜ ' + b.sub, tx, cy + h * 0.22);
      }
      ctx.restore();
    }

    drawEnd() {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(5,6,15,0.6)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(18,20,36,0.92)';
      roundRect(ctx, 50, 500, W - 100, 860, 40);
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = this.winner ? C.teams[this.winner].color : '#ffd23f';
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const w = this.winner;
      const pulse = 1 + Math.sin(this.time * 4) * 0.04;
      ctx.save();
      ctx.translate(W / 2, 640);
      ctx.scale(pulse, pulse);
      ctx.font = '900 120px "PingFang TC","Noto Sans TC",sans-serif';
      ctx.lineWidth = 12;
      ctx.strokeStyle = '#000';
      const title = w ? `${C.teams[w].name}勝利！` : '平手！';
      ctx.strokeText(title, 0, 0);
      ctx.fillStyle = w ? C.teams[w].color : '#ffd23f';
      ctx.fillText(title, 0, 0);
      ctx.restore();
      ctx.font = 'bold 40px "PingFang TC","Noto Sans TC",sans-serif';
      ctx.fillStyle = '#ddd';
      ctx.fillText(this.endReason === 'castle' ? '敵方城堡已被攻破' : '時間到，城堡血量較多者勝', W / 2, 760);
      ctx.font = '900 54px "PingFang TC","Noto Sans TC",sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(`總比分  ${this.series.red} : ${this.series.blue}`, W / 2, 860);

      ctx.font = '900 46px "PingFang TC","Noto Sans TC",sans-serif';
      ctx.fillStyle = '#ffd23f';
      ctx.fillText('👑 本局 MVP 👑', W / 2, 990);
      for (const team of ['red', 'blue']) {
        const p = this.mvp && this.mvp[team];
        const y = team === 'red' ? 1080 : 1160;
        const line = p ? `${C.teams[team].name}：${short(p.name, 10)}（${Math.round(p.score)} 分・擊殺 ${p.kills}）` : `${C.teams[team].name}：—`;
        fitFont(ctx, line, W - 180, 40, 'bold');
        ctx.fillStyle = C.teams[team].color;
        ctx.fillText(line, W / 2, y);
      }
      fitFont(ctx, '下一局 10 秒後開始・現在送禮下局生效', W - 180, 38, 'bold');
      ctx.fillStyle = '#fff';
      ctx.fillText(`下一局 ${Math.ceil(this.endTimer)} 秒後開始・現在送禮下局生效`, W / 2, 1300);
    }
  }

  DG.Game = Game;
})();
