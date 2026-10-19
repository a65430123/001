# ⚔ 彈幕攻城戰 — TikTok 直播互動遊戲

紅藍兩隊攻城對戰。觀眾在直播間**留言選邊、按讚出兵、送禮物召喚兵種與技能**，先攻破對方城堡的一隊獲勝。

- 直立 1080×1920 畫面，放進 **TikTok LIVE Studio** 的「連結（Link）」來源即可（OBS 也可以）
- 透過 **TikFinity** 讀取你直播間的留言、禮物、按讚、追蹤、分享（TikFinity 原本的音效、TTS、其他小工具可以照常一起用）
- 每個禮物都有不同效果，大禮物有全螢幕特效、橫幅、震動、音效
- 本局戰神榜、MVP、比分累計，每局自動重開
- 預設使用 TikTok 禮物表；抖音請在網址加 `?platform=douyin`

---

## 架構

```
TikTok 直播間 ──► TikFinity 桌面版 ──(ws://localhost:21213)──► 遊戲畫面 ──► TikTok LIVE Studio「連結」來源
```

遊戲直接連 TikFinity 桌面版內建的 WebSocket，不用申請任何 API、不用輸入帳號密碼。

## 一、第一次設定（Windows）

1. 安裝並開啟 **TikFinity 桌面版**（Windows 版，網頁版不行），登入後在 TikFinity 裡**連上你的 TikTok 帳號**。
2. 下載這個專案，進到 `douyin-live-game` 資料夾，雙擊 **`開始-TikFinity直播.bat`**
   - 不用安裝任何東西：有 Node.js 就用 Node.js，沒有就用 Windows 內建的 PowerShell
   - 出現 `遊戲網址： http://localhost:3000/` 就是啟動成功，**直播期間不要關這個黑色視窗**
   - 若 Windows 跳出防火牆詢問，選「允許」（只在本機使用）
3. 先用瀏覽器打開 <http://localhost:3000/?sim=1> 試玩：右側有模擬控制台，可以點按鈕模擬留言、送禮；按「🤖 自動模擬」會有 30 位假觀眾一起玩。

## 二、放進 TikTok LIVE Studio

1. 開啟 TikTok LIVE Studio，切到**直式（9:16）**版面。
2. 在場景的「來源」按 **＋ 新增來源 → 連結（Link）**。
3. 網址填 `http://localhost:3000/`，解析度填 **寬 1080、高 1920**。
4. 把來源拉滿整個畫面（或你想要的區域），按預覽確認。
5. **開播**，然後確認 TikFinity 顯示已連上直播間。
6. 畫面左下角會短暫顯示 `● TikFinity 已連線`（4 秒後自動隱藏）。若一直顯示「等待 TikFinity 連線」，代表 TikFinity 桌面版沒開。

> 建議開播後先用小帳號送一朵玫瑰，確認遊戲有反應。

**常見狀況**

| 狀況 | 解法 |
|---|---|
| 一直顯示「等待 TikFinity 連線」 | 確認 TikFinity **桌面版**有開啟（不是網頁版）。若在 TikFinity 改過 WebSocket 連接埠，網址加 `?tikfinity=ws://localhost:你的埠號/` |
| 顯示已連線，但送禮沒反應 | TikFinity 開著不代表已接上直播：確認 TikFinity 裡已連上你的直播間，而且已經開播 |
| 來源變成一個很小的方框、拉不大 | TikTok LIVE Studio 的已知問題（網頁來源有時以 0×0 載入）。刪掉來源重新新增；仍不行就改用 OBS 開遊戲，再用 OBS 虛擬攝影機當 LIVE Studio 的攝影機來源 |
| 畫面卡住不動 | LIVE Studio 的連結來源沒有重新整理按鈕：把網址改成 `http://localhost:3000/?r=2`（數字每次換一個）就會重新載入 |
| 沒有聲音 | 部分版本的連結來源不會播放網頁聲音，可在遊戲網址加 `?mute=1` 關掉音效，改用 TikFinity 的音效提醒 |
| 黑色視窗說連接埠被使用 | 已經開過一次了，關掉舊的視窗再開；或其他程式占用 3000 埠 |

> **小提醒**：TikFinity 的「留言關鍵字觸發」等功能如果也設定了 `1`、`2`、`666`，會和遊戲同時觸發，記得避開。

## 三、玩法（可以把這段貼在直播簡介）

| 觀眾行為 | 效果 |
|---|---|
| 留言 `1`／`紅` | 加入紅隊，戰場出現一名掛著你名字的小兵 |
| 留言 `2`／`藍` | 加入藍隊 |
| 留言 `666`／`衝`／`加油` | 你的兵進入衝鋒狀態（加速）；你的留言會冒在你的兵頭上 |
| 按讚 | 每累積 20 個讚，替你的隊伍召喚一名小兵 |
| 追蹤 | 獲得一名騎士 |
| 分享 | 獲得 3 名小兵 |
| 送禮 | 見下表（沒選邊的人送禮，會自動分配到人少的那隊） |

| TikTok 禮物 | 效果 |
|---|---|
| 🌹 玫瑰 Rose | 3 名小兵 |
| 🎵 TikTok | 2 名騎士（高速） |
| 🏹 GG | 2 名弓箭手（遠程） |
| 🍦 冰淇淋 Ice Cream Cone | 城堡無敵護盾 6 秒 |
| 🫰 比心 Finger Heart | 全軍補滿血、城堡 +300 |
| 📿 友誼項鍊 Friendship Necklace | 全隊狂暴 10 秒 |
| 🧴 香水 Perfume | 召喚巨人 |
| 🍩 甜甜圈 Doughnut | 冰凍敵方全軍 5 秒 |
| 🫶 雙手比心 Hand Hearts | 天降 10 道落雷 |
| 🎊 彩帶 Confetti | 空投 12 小兵 + 3 弓箭手 + 1 戰車 |
| 💸 撒錢槍 Money Gun | 3 台戰車 + 4 名法師 |
| 🌌 銀河 Galaxy | 巨龍降臨 + 12 顆隕石 + 全隊狂暴 |
| 🦁 獅子 Lion／🪐 宇宙 Universe | 隱藏大招：多隻巨龍 + 隕石雨 |
| **其他任何禮物** | 依金幣價值自動對應：小兵 → 騎士 → 巨人 → 空投 → 巨龍 |

- 連擊禮物（例如連送玫瑰）會**即時**生效，每多送一個就多出兵，不會重複計算。
- 禮物數量會相乘（例如玫瑰 ×10 = 30 名小兵）。每隊同時在場上限 150，超過的會排隊出兵。
- 每局 5 分鐘，城堡被攻破或時間到（血量比例高者勝）就結算，12 秒後自動開新局；休息時送的禮物會在下一局開場生效。
- TikTok 各地區可送的禮物不同。表上沒有的禮物不用擔心，都會依價值自動給效果。

想改禮物效果、兵種數值、留言關鍵字：編輯 [`js/config.js`](js/config.js) 的 `GIFT_SETS.tiktok`，存檔後重新整理遊戲畫面即可。禮物名稱比對中英文都可以（TikTok 傳來的通常是英文名稱）。

## 四、網址參數

| 參數 | 說明 |
|---|---|
| `?sim=1` | 開啟模擬控制台（按 `S` 也能開關） |
| `?bots=1` | 一打開就開始自動模擬 |
| `?demo=60` | 60 秒沒有真實觀眾互動時，自動播放暖場示範；有人互動就停 |
| `?round=180` | 每局秒數 |
| `?mute=1` | 靜音 |
| `?platform=douyin` | 改用抖音禮物表 |
| `?tikfinity=ws://localhost:21213/` | TikFinity 的 WebSocket 位址（預設就是這個，改過埠號才需要） |
| `?source=bridge` | 不用 TikFinity，改用內建的 TikTok 直連（見下方） |
| `?ws=ws://…` | 改連其他工具的 WebSocket（多個用逗號分隔） |

多個參數用 `&` 連接，例如 `http://localhost:3000/?demo=60&round=240`。

## 五、不用 TikFinity 的直連模式（備用）

如果 TikFinity 暫時不能用，也可以讓遊戲自己連 TikTok：

1. 安裝 **Node.js**（<https://nodejs.org>，LTS 版本）。
2. 雙擊 **`進階-不用TikFinity直連.bat`**，輸入你的 TikTok 帳號（`@` 後面那串）。第一次會自動安裝套件。
3. LIVE Studio 的連結來源網址改成 `http://localhost:3000/?source=bridge`。

- 直連模式使用開源套件 [tiktok-live-connector](https://github.com/zerodytrash/TikTok-Live-Connector)，**不是 TikTok 官方 API**，TikTok 改版時可能暫時失效，屆時在資料夾執行 `npm update` 更新套件。
- 該套件透過 Euler Stream 簽章服務連線，免費額度一般直播足夠；若出現頻率限制錯誤，可申請 API key，啟動時加 `--sign-key 你的key`。
- 兩種模式都只「讀取」直播間事件，不會用你的帳號發言或操作。

**其他接入方式**

- 用 Node.js 版伺服器（`node bridge/server.js`）並以 `?source=bridge` 開啟遊戲時，任何工具只要送出 TikFinity／tiktok-live-connector 格式的 `{ "event": "gift", "data": { … } }`，或下面的通用格式，都可以透過 `ws://localhost:3000/ws` 或 `POST http://localhost:3000/event` 送進遊戲：

```json
{ "type": "chat",   "user": { "id": "123", "name": "小明" }, "text": "1" }
{ "type": "like",   "user": { "id": "123", "name": "小明" }, "count": 10 }
{ "type": "gift",   "user": { "id": "123", "name": "小明" }, "gift": { "name": "Galaxy", "count": 1, "diamond": 1000 } }
{ "type": "follow", "user": { "id": "123", "name": "小明" } }
```

```bash
curl -X POST localhost:3000/event -d '{"type":"gift","user":{"name":"土豪"},"gift":{"name":"Galaxy","count":1}}'
```

- 抖音：網址加 `?platform=douyin`，可接 DouyinBarrageGrab（`?ws=ws://127.0.0.1:8888`）或抖音直播開放平台推送（`POST /event`），格式皆已內建支援。

## 檔案結構

```
douyin-live-game/
├── 開始-TikFinity直播.bat  ★ Windows 一鍵啟動（搭配 TikFinity）
├── 進階-不用TikFinity直連.bat  備用：不用 TikFinity，直接連 TikTok
├── tools/serve.ps1       沒有 Node.js 時用的 PowerShell 網頁伺服器
├── index.html            頁面與模擬控制台
├── js/config.js          ★ 禮物效果、兵種數值、關鍵字（改這裡）
├── js/game.js            遊戲引擎：戰鬥、特效、繪圖
├── js/tiktok.js          TikFinity／TikTok 事件轉換（連擊禮物去重）
├── js/connector.js       各平台事件格式轉換與 WebSocket 連線
├── js/audio.js           即時合成音效
├── js/main.js            進入點、模擬控制台、自動模擬
├── css/style.css
└── bridge/server.js      Node.js 本機伺服器：提供網頁、/ws 廣播、POST /event、TikTok 直連
```
