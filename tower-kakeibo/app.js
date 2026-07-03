/* ================================================================
   タワー家計簿 — 月20万円のタワーを守る家計簿ゲーム
   ================================================================ */

let BUDGET = 200000; // 1ヶ月のタワー = 予算（設定で変更可能。下で保存値を読み込む）

const $ = s => document.querySelector(s);
const yen = n => "¥" + Math.round(n).toLocaleString("ja-JP");

/* ---------------- データ保存 ---------------- */

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

const DEFAULT_CATS = ["食費","外食","コンビニ","日用品","交通","医療","衣類","光熱費","通信","娯楽","その他"];
const CAT_COLORS = ["#7ec850","#f2a03d","#e8557a","#5ab8e8","#b08cf0","#f06a5a",
                    "#f7d354","#5ae8c8","#8898f0","#f08cd0","#a0a8c0","#c8e858","#e89858"];

let records = load("kk_records", []);      // {id,date,store,payment,amount,category,raw,createdAt}
let categories = load("kk_categories", DEFAULT_CATS.slice());
BUDGET = load("kk_budget", 200000);        // 目標金額（ユーザーが設定で変更可能）

function catColor(cat) {
  const i = categories.indexOf(cat);
  return CAT_COLORS[(i < 0 ? categories.length : i) % CAT_COLORS.length];
}

function addRecord(rec) {
  rec.id = Date.now() + "-" + Math.random().toString(36).slice(2, 7);
  rec.createdAt = new Date().toISOString();
  records.push(rec);
  if (rec.category && !categories.includes(rec.category)) {
    categories.push(rec.category);
    save("kk_categories", categories);
  }
  save("kk_records", records);
  refreshAll();
}

function deleteRecord(id) {
  records = records.filter(r => r.id !== id);
  save("kk_records", records);
  refreshAll();
}

function deleteYear(year) {
  records = records.filter(r => !r.date.startsWith(year + "-"));
  save("kk_records", records);
  refreshAll();
}

/* ---------------- 月ごとの集計 ---------------- */

function ymOf(dateStr) { return dateStr.slice(0, 7); } // "2026-07"
function currentYM() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
function monthRecords(ym) { return records.filter(r => ymOf(r.date) === ym); }
function monthSpent(ym) { return monthRecords(ym).reduce((s, r) => s + r.amount, 0); }
function monthCats(ym) {
  const m = {};
  for (const r of monthRecords(ym)) m[r.category] = (m[r.category] || 0) + r.amount;
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

let viewYM = currentYM(); // メインページで表示中の月

/* ================================================================
   メインページ：レトロゲームシーン
   ================================================================ */

const cv = $("#scene");
const ctx = cv.getContext("2d");
const SW = 360, SH = 600;
const GROUND_Y = 504;

ctx.imageSmoothingEnabled = false;

/* --- 時間帯 --- */
function skyPhase(h) {
  if (h >= 5 && h < 8)   return "dawn";
  if (h >= 8 && h < 16)  return "day";
  if (h >= 16 && h < 19) return "dusk";
  return "night";
}
const SKY = {
  dawn:  ["#3a2a5a", "#7a4a6a", "#e88a6a", "#ffb88a"],
  day:   ["#3a7ac8", "#5a9ad8", "#8ac0e8", "#b8e0f4"],
  dusk:  ["#4a2a5a", "#a84a5a", "#e8784a", "#f7b054"],
  night: ["#050818", "#0a1030", "#101a44", "#1a2858"],
};
const GROUND = {
  dawn:  ["#4a7a3a", "#3a5a2e"],
  day:   ["#5a9a42", "#468038"],
  dusk:  ["#3e6a34", "#2e5028"],
  night: ["#1a3020", "#122418"],
};

/* --- 天気 --- */
let weather = load("kk_weather", { kind: "clear", ts: 0 });

function weatherKind(code) {
  if (code == null) return "clear";
  if (code === 0 || code === 1) return "clear";
  if (code <= 3 || code === 45 || code === 48) return "cloudy";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "thunder";
  return "rain";
}

function fetchWeather() {
  if (Date.now() - weather.ts < 60 * 60 * 1000) return; // 1時間キャッシュ
  if (!navigator.geolocation) { randomWeather(); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude, longitude } = pos.coords;
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=weather_code`)
      .then(r => r.json())
      .then(j => {
        weather = { kind: weatherKind(j.current && j.current.weather_code), ts: Date.now() };
        save("kk_weather", weather);
      })
      .catch(randomWeather);
  }, randomWeather, { timeout: 8000, maximumAge: 600000 });
}
function randomWeather() {
  const kinds = ["clear", "clear", "clear", "cloudy", "rain", "snow"];
  weather = { kind: kinds[Math.floor(Math.random() * kinds.length)], ts: Date.now() };
  save("kk_weather", weather);
}

/* --- 星・雲・粒 --- */
const stars = Array.from({ length: 90 }, () => ({
  x: Math.floor(Math.random() * SW), y: Math.floor(Math.random() * (GROUND_Y - 160)),
  tw: Math.random() * 6.28, s: Math.random() < 0.2 ? 2 : 1,
}));
const clouds = Array.from({ length: 6 }, (_, i) => ({
  x: Math.random() * SW, y: 30 + i * 42 + Math.random() * 14,
  w: 48 + Math.random() * 40, v: 0.06 + Math.random() * 0.08,
}));
let drops = [];      // 雨・雪
let particles = [];  // 崩れる破片
let flash = 0;       // 雷

/* --- タワー描画のジオメトリ --- */
function towerGeom(ym) {
  const mi = parseInt(ym.slice(5), 10) - 1;
  const t = TOWERS[mi];
  const maxW = Math.max(...t.rows.map(r => r.length));
  const cell = Math.max(4, Math.min(13, Math.floor(420 / t.rows.length), Math.floor(300 / maxW)));
  return { t, cell, maxW, x0: Math.floor((SW - maxW * cell) / 2) };
}
function visibleRowCount(ym) {
  const { t } = towerGeom(ym);
  const ratio = Math.min(1, monthSpent(ym) / BUDGET);
  return Math.max(0, t.rows.length - Math.floor(t.rows.length * ratio + 1e-9));
}

/* 破片アニメーション：表示行数が減ったら破片を飛ばす */
let lastVisible = {};
function checkCrumble(ym) {
  const vis = visibleRowCount(ym);
  if (lastVisible[ym] != null && vis < lastVisible[ym]) {
    const { t, cell, x0 } = towerGeom(ym);
    for (let ri = vis; ri < lastVisible[ym]; ri++) {
      const row = t.rows[ri];
      const y = GROUND_Y - (t.rows.length - ri) * cell;
      const h = Math.ceil(cell / 2);
      for (let ci = 0; ci < row.length; ci++) {
        if (row[ci] === ".") continue;
        for (const [dx, dy] of [[0, 0], [h, 0], [0, h], [h, h]]) {
          if (Math.random() < 0.3) continue;
          particles.push({
            x: x0 + ci * cell + dx, y: y + dy,
            vx: (Math.random() - 0.5) * 2.4, vy: -Math.random() * 2.2,
            c: t.colors[row[ci]], s: h, life: 60 + Math.random() * 40,
          });
        }
      }
    }
  }
  lastVisible[ym] = vis;
}

/* --- 空グラデーション（4色→16バンドに補間） --- */
const bandCache = {};
function hexRGB(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}
function skyBands(phase) {
  if (bandCache[phase]) return bandCache[phase];
  const base = SKY[phase], out = [];
  const per = 5;
  for (let i = 0; i < base.length - 1; i++) {
    const a = hexRGB(base[i]), b = hexRGB(base[i + 1]);
    for (let j = 0; j < per; j++) {
      const t = j / per;
      out.push(`rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`);
    }
  }
  out.push(base[base.length - 1]);
  return bandCache[phase] = out;
}

/* --- シーン描画 --- */
function drawScene(time) {
  const now = new Date();
  const phase = skyPhase(now.getHours());
  const gr = GROUND[phase];

  // 空（バンド状レトログラデーション）
  const bands = skyBands(phase);
  const bandH = Math.ceil(GROUND_Y / bands.length);
  for (let i = 0; i < bands.length; i++) {
    ctx.fillStyle = bands[i];
    ctx.fillRect(0, i * bandH, SW, bandH);
  }

  // 星（夜のみ）
  if (phase === "night") {
    for (const s of stars) {
      if (Math.sin(time / 500 + s.tw) > -0.3) {
        ctx.fillStyle = "#e8ecff";
        ctx.fillRect(s.x, s.y, s.s, s.s);
      }
    }
  }

  // 太陽・月
  const h = now.getHours() + now.getMinutes() / 60;
  if (phase !== "night") {
    const p = Math.max(0, Math.min(1, (h - 5) / 14)); // 5時〜19時
    const sx = 28 + p * (SW - 56);
    const sy = 180 - Math.sin(p * Math.PI) * 120;
    ctx.fillStyle = phase === "day" ? "#fff4b8" : "#ffb84a";
    ctx.fillRect(sx - 10, sy - 10, 20, 20);
    ctx.fillRect(sx - 14, sy - 4, 28, 8);
    ctx.fillRect(sx - 4, sy - 14, 8, 28);
  } else {
    const p = ((h + 24 - 19) % 24) / 10;
    const mx = 28 + Math.min(1, p) * (SW - 56);
    const my = 140 - Math.sin(Math.min(1, p) * Math.PI) * 80;
    ctx.fillStyle = "#f0f0d8";
    ctx.fillRect(mx - 8, my - 8, 16, 16);
    ctx.fillRect(mx - 10, my - 4, 20, 8);
    ctx.fillRect(mx - 4, my - 10, 8, 20);
    ctx.fillStyle = SKY.night[1];
    ctx.fillRect(mx - 2, my - 4, 8, 8);
  }

  // 雲
  const cloudy = weather.kind !== "clear";
  const nClouds = cloudy ? clouds.length : 2;
  for (let i = 0; i < nClouds; i++) {
    const c = clouds[i];
    c.x += c.v;
    if (c.x > SW + c.w) c.x = -c.w;
    ctx.fillStyle = phase === "night" ? "#2a3560" :
                    (weather.kind === "rain" || weather.kind === "thunder") ? "#8a90a8" : "#f0f4f8";
    ctx.fillRect(c.x, c.y, c.w, 10);
    ctx.fillRect(c.x + 8, c.y - 6, c.w - 20, 6);
    ctx.fillRect(c.x + 16, c.y - 10, Math.max(6, c.w - 34), 4);
    ctx.fillRect(c.x + 6, c.y + 10, c.w - 12, 5);
    ctx.fillRect(c.x - 5, c.y + 3, 5, 5);
    ctx.fillRect(c.x + c.w, c.y + 3, 5, 5);
  }

  // 雨・雪
  if (weather.kind === "rain" || weather.kind === "thunder" || weather.kind === "snow") {
    if (drops.length < 120) {
      drops.push({ x: Math.random() * SW, y: -8, v: weather.kind === "snow" ? 0.8 : 6 });
      drops.push({ x: Math.random() * SW, y: -8, v: weather.kind === "snow" ? 0.6 + Math.random() * 0.4 : 5 + Math.random() * 2 });
    }
    for (const d of drops) {
      d.y += d.v;
      if (weather.kind === "snow") { d.x += Math.sin(d.y / 14) * 0.6; }
      if (weather.kind === "snow") {
        ctx.fillStyle = "#f0f4f8";
        ctx.fillRect(d.x, d.y, 3, 3);
      } else {
        ctx.fillStyle = "#a8c8f0";
        ctx.fillRect(d.x, d.y, 2, 8);
      }
    }
    drops = drops.filter(d => d.y < GROUND_Y);
    // 雷フラッシュ
    if (weather.kind === "thunder") {
      if (flash <= 0 && Math.random() < 0.004) flash = 6;
      if (flash > 0) {
        ctx.fillStyle = `rgba(255,255,220,${flash / 12})`;
        ctx.fillRect(0, 0, SW, GROUND_Y);
        flash--;
      }
    }
  } else {
    drops = [];
  }

  // 地面
  ctx.fillStyle = gr[0];
  ctx.fillRect(0, GROUND_Y, SW, SH - GROUND_Y);
  ctx.fillStyle = gr[1];
  for (let x = 0; x < SW; x += 16) ctx.fillRect(x + (x % 32 ? 8 : 0), GROUND_Y + 16, 8, 5);
  for (let x = 8; x < SW; x += 24) ctx.fillRect(x, GROUND_Y + 44, 6, 4);
  for (let x = 4; x < SW; x += 28) ctx.fillRect(x, GROUND_Y + 70, 7, 4);
  ctx.fillRect(0, GROUND_Y, SW, 3);

  // タワー
  checkCrumble(viewYM);
  const { t, cell, x0 } = towerGeom(viewYM);
  const vis = visibleRowCount(viewYM);
  const total = t.rows.length;
  for (let ri = total - vis; ri < total; ri++) {
    const row = t.rows[ri];
    const y = GROUND_Y - (total - ri) * cell;
    for (let ci = 0; ci < row.length; ci++) {
      const ch = row[ci];
      if (ch === ".") continue;
      ctx.fillStyle = t.colors[ch];
      ctx.fillRect(x0 + ci * cell, y, cell, cell);
    }
  }

  // 瓦礫（崩れた分だけ地面に積もる）
  const destroyed = total - vis;
  if (destroyed > 0) {
    const seed = destroyed * 7 + parseInt(viewYM.slice(5), 10);
    const colors = Object.values(t.colors);
    for (let i = 0; i < destroyed * 5; i++) {
      const r1 = Math.abs(Math.sin(seed + i * 13.7));
      const r2 = Math.abs(Math.sin(seed + i * 31.3));
      const rx = SW / 2 + (r1 - 0.5) * (60 + destroyed * 6);
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(Math.floor(rx), GROUND_Y - 4 - Math.floor(r2 * 8), 4, 4);
    }
  }

  // 破片
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.life--;
    if (p.y > GROUND_Y - 2) { p.y = GROUND_Y - 2; p.vy = 0; p.vx *= 0.9; }
    ctx.fillStyle = p.c;
    ctx.fillRect(p.x, p.y, Math.max(1, p.s - 1), Math.max(1, p.s - 1));
  }
  particles = particles.filter(p => p.life > 0);
}

function loop(time) {
  drawScene(time);
  requestAnimationFrame(loop);
}

/* --- HUD更新 --- */
function updateHUD() {
  const [y, m] = viewYM.split("-").map(Number);
  const t = TOWERS[m - 1];
  const spent = monthSpent(viewYM);
  const remain = BUDGET - spent;
  const ratio = Math.max(0, Math.min(1, remain / BUDGET));

  $("#hud-month").textContent = `${y}年${m}月`;
  $("#hud-tower").textContent = `${t.name}（${t.place}）`;
  $("#hud-remain").textContent = yen(Math.max(0, remain));
  $("#hud-spent").textContent = `つかった金額 ${yen(spent)} / ${yen(BUDGET)}`;

  const fill = $("#hp-fill");
  fill.style.width = ratio * 100 + "%";
  fill.style.background = ratio > 0.5 ? "var(--ok)" : ratio > 0.2 ? "var(--accent)" : "var(--danger)";
  $("#hud-remain").style.color = ratio > 0.5 ? "var(--ok)" : ratio > 0.2 ? "var(--accent)" : "var(--danger)";

  const failed = spent > BUDGET;
  $("#gameover").classList.toggle("hidden", !failed);
  if (failed) $("#gameover-sub").textContent = yen(spent - BUDGET) + " オーバー...";

  // 過去の月で予算内なら CLEAR!
  const isPast = viewYM < currentYM();
  $("#clear-badge").classList.toggle("hidden", !(isPast && !failed && monthRecords(viewYM).length > 0));
}

function shiftMonth(d) {
  let [y, m] = viewYM.split("-").map(Number);
  m += d;
  if (m < 1) { m = 12; y--; }
  if (m > 12) { m = 1; y++; }
  viewYM = y + "-" + String(m).padStart(2, "0");
  lastVisible = {}; particles = [];
  updateHUD();
}
$("#prev-month").addEventListener("click", () => shiftMonth(-1));
$("#next-month").addEventListener("click", () => shiftMonth(1));

/* ---------------- 目標金額の設定 ---------------- */

function markPreset() {
  const v = parseInt($("#s-budget").value, 10);
  document.querySelectorAll(".preset-btn").forEach(b =>
    b.classList.toggle("on", parseInt(b.dataset.v, 10) === v));
}
$("#btn-settings").addEventListener("click", () => {
  $("#s-budget").value = BUDGET;
  markPreset();
  $("#settings-overlay").classList.remove("hidden");
});
$("#s-cancel").addEventListener("click", () => $("#settings-overlay").classList.add("hidden"));
$("#s-budget").addEventListener("input", markPreset);
document.querySelectorAll(".preset-btn").forEach(b =>
  b.addEventListener("click", () => { $("#s-budget").value = b.dataset.v; markPreset(); }));
$("#s-save").addEventListener("click", () => {
  const v = parseInt($("#s-budget").value, 10);
  if (!v || v < 1000) { alert("1,000円以上で入力してください"); return; }
  BUDGET = v;
  save("kk_budget", BUDGET);
  lastVisible = {}; particles = [];   // タワーの崩れ具合を再計算
  $("#settings-overlay").classList.add("hidden");
  refreshAll();
});

/* ================================================================
   OCR：レシート読み取り
   ================================================================ */

let ocrWorker = null;
let ocrCancelled = false;

async function getWorker(onProgress) {
  if (ocrWorker) return ocrWorker;
  if (typeof Tesseract === "undefined") throw new Error("offline");
  ocrWorker = await Tesseract.createWorker("jpn", 1, {
    logger: m => {
      if (m.status === "recognizing text") onProgress(m.progress);
      else onProgress(0);
    },
  });
  return ocrWorker;
}

async function runOCR(file) {
  ocrCancelled = false;
  $("#ocr-overlay").classList.remove("hidden");
  $("#ocr-status").textContent = "よみとりの じゅんび中...（初回は少し時間がかかります）";
  $("#ocr-progress-fill").style.width = "0%";
  try {
    const worker = await getWorker(p => {
      $("#ocr-status").textContent = "レシートを よみとり中...";
      $("#ocr-progress-fill").style.width = Math.round(p * 100) + "%";
    });
    const { data } = await worker.recognize(file);
    $("#ocr-overlay").classList.add("hidden");
    if (ocrCancelled) return;
    openConfirm(parseReceipt(data.text || ""), data.text || "");
  } catch (e) {
    $("#ocr-overlay").classList.add("hidden");
    if (ocrCancelled) return;
    alert("よみとりに失敗しました。手入力で登録できます。\n（初回はインターネット接続が必要です）");
    openConfirm({}, "");
  }
}
$("#ocr-cancel").addEventListener("click", () => {
  ocrCancelled = true;
  $("#ocr-overlay").classList.add("hidden");
});

/* --- レシート文字解析 --- */

const STORE_CHAINS = [
  "セブンイレブン","セブン-イレブン","ファミリーマート","ローソン","ミニストップ","デイリーヤマザキ",
  "イオン","イトーヨーカドー","西友","ライフ","マルエツ","サミット","オーケー","業務スーパー","成城石井","ヤオコー",
  "マツモトキヨシ","ウエルシア","ツルハ","スギ薬局","ココカラファイン","サンドラッグ",
  "ユニクロ","GU","無印良品","ニトリ","ダイソー","セリア","キャンドゥ",
  "スターバックス","ドトール","タリーズ","マクドナルド","モスバーガー","ケンタッキー","すき家","吉野家","松屋","サイゼリヤ","ガスト",
  "ヨドバシ","ビックカメラ","ヤマダ電機",
];

const CAT_KEYWORDS = [
  [/コンビニ|セブン|ファミリーマート|ローソン|ミニストップ|デイリー/, "コンビニ"],
  [/イオン|ヨーカドー|西友|ライフ|マルエツ|サミット|オーケー|業務スーパー|成城石井|ヤオコー|スーパー|生鮮|食品/, "食費"],
  [/マツモトキヨシ|ウエルシア|ツルハ|スギ薬局|ココカラ|サンドラッグ|ドラッグ/, "日用品"],
  [/薬局|病院|クリニック|医院|歯科/, "医療"],
  [/スターバックス|ドトール|タリーズ|マクドナルド|モスバーガー|ケンタッキー|すき家|吉野家|松屋|サイゼリヤ|ガスト|レストラン|カフェ|食堂|居酒屋/, "外食"],
  [/ユニクロ|GU|しまむら|洋服|クリーニング/, "衣類"],
  [/ニトリ|ダイソー|セリア|キャンドゥ|ホームセンター|カインズ/, "日用品"],
  [/JR|メトロ|バス|タクシー|ガソリン|ENEOS|出光|駐車/, "交通"],
  [/電気|ガス|水道/, "光熱費"],
  [/ドコモ|docomo|au|ソフトバンク|楽天モバイル/, "通信"],
  [/書店|本屋|映画|ゲーム|カラオケ/, "娯楽"],
];

function toHalfWidth(s) {
  return s.replace(/[０-９Ａ-Ｚａ-ｚ．，]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
          .replace(/[￥¥]/g, "¥");
}

function parseReceipt(raw) {
  const text = toHalfWidth(raw);
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const out = {};

  // --- 日付 ---
  let m = text.match(/(20\d{2})[年\/\-.](\d{1,2})[月\/\-.](\d{1,2})/);
  if (!m) {
    const r = text.match(/令和\s?(\d{1,2})[年.](\d{1,2})[月.](\d{1,2})/) || text.match(/R(\d{1,2})[.\/](\d{1,2})[.\/](\d{1,2})/);
    if (r) m = [null, 2018 + parseInt(r[1]), r[2], r[3]];
  }
  if (m) {
    const mo = String(parseInt(m[2])).padStart(2, "0");
    const da = String(parseInt(m[3])).padStart(2, "0");
    if (parseInt(m[2]) >= 1 && parseInt(m[2]) <= 12 && parseInt(m[3]) >= 1 && parseInt(m[3]) <= 31) {
      out.date = `${m[1]}-${mo}-${da}`;
    }
  }

  // --- 金額（合計行を優先、なければ最大の¥金額） ---
  const amounts = [];
  for (const line of lines) {
    const isTotal = /合計|お会計|ご請求|総額|お買上げ?計|クレジット計/.test(line) && !/小計|点数/.test(line);
    const nums = [...line.matchAll(/[¥]?\s?([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{1,6})\s?円?/g)]
      .map(x => parseInt(x[1].replace(/,/g, "")))
      .filter(n => n >= 10 && n < 10000000);
    for (const n of nums) amounts.push({ n, isTotal, hasYen: /[¥円]/.test(line) });
  }
  const totals = amounts.filter(a => a.isTotal);
  if (totals.length) out.amount = totals[totals.length - 1].n;
  else {
    const withYen = amounts.filter(a => a.hasYen);
    const pool = withYen.length ? withYen : amounts;
    if (pool.length) out.amount = Math.max(...pool.map(a => a.n));
  }

  // --- 決済方法 ---
  if (/クレジット|VISA|Master|MASTER|JCB|AMEX|ｸﾚｼﾞｯﾄ|カード支払/.test(text)) out.payment = "クレジット";
  else if (/PayPay|ペイペイ|楽天ペイ|d払い|au\s?PAY|メルペイ/i.test(text)) out.payment = "QRコード";
  else if (/Suica|スイカ|PASMO|パスモ|iD|QUICPay|nanaco|ナナコ|WAON|ワオン|Edy|エディ|電子マネー/i.test(text)) out.payment = "電子マネー";
  else if (/現金|お預り|お預かり|おつり|お釣/.test(text)) out.payment = "現金";

  // --- お店の名前 ---
  for (const chain of STORE_CHAINS) {
    if (text.includes(chain)) { out.store = chain; break; }
  }
  if (!out.store) {
    for (const line of lines.slice(0, 5)) {
      if (line.length >= 2 && line.length <= 24 &&
          !/[0-9]{4}|TEL|電話|領収|レシート|様|no\.|No\./i.test(line) &&
          /[ぁ-んァ-ヶ一-龠a-zA-Z]/.test(line)) {
        out.store = line;
        break;
      }
    }
  }

  // --- カテゴリー推定 ---
  const hay = (out.store || "") + " " + text.slice(0, 200);
  for (const [re, cat] of CAT_KEYWORDS) {
    if (re.test(hay)) { out.category = cat; break; }
  }

  return out;
}

/* ================================================================
   確認・編集フォーム
   ================================================================ */

function openConfirm(parsed, raw) {
  $("#confirm-title").textContent = raw ? "よみとり結果のかくにん" : "手入力";
  $("#f-date").value = parsed.date || new Date().toISOString().slice(0, 10);
  $("#f-store").value = parsed.store || "";
  $("#f-amount").value = parsed.amount || "";
  $("#f-payment").value = parsed.payment || "現金";
  $("#f-category").value = parsed.category || "";
  $("#f-raw").textContent = raw;
  $("#raw-details").style.display = raw ? "" : "none";
  $("#cat-list").innerHTML = categories.map(c => `<option value="${c}">`).join("");
  $("#confirm-overlay").classList.remove("hidden");
}

$("#f-cancel").addEventListener("click", () => $("#confirm-overlay").classList.add("hidden"));

$("#f-save").addEventListener("click", () => {
  const amount = parseInt($("#f-amount").value, 10);
  if (!amount || amount <= 0) { alert("金額を入力してください"); return; }
  const date = $("#f-date").value || new Date().toISOString().slice(0, 10);
  addRecord({
    date,
    store: $("#f-store").value.trim() || "（お店 未入力）",
    amount,
    payment: $("#f-payment").value,
    category: $("#f-category").value.trim() || "その他",
    raw: $("#f-raw").textContent || "",
  });
  $("#confirm-overlay").classList.add("hidden");
  // 追加した記録の月を表示してタワーが崩れる様子を見せる
  viewYM = ymOf(date);
  updateHUD();
  $("#pages").scrollTo({ left: 0, behavior: "smooth" });
});

/* ---------------- カメラ・手入力ボタン ---------------- */

function openCamera() { $("#cam-input").click(); }
$("#fab-camera").addEventListener("click", openCamera);
$("#btn-camera").addEventListener("click", openCamera);
$("#btn-manual").addEventListener("click", () => openConfirm({}, ""));
$("#cam-input").addEventListener("change", e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file) runOCR(file);
});

/* ================================================================
   円グラフ（カテゴリー）
   ================================================================ */

function arcPath(cx, cy, r, a0, a1) {
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
}

function renderChart() {
  const ym = currentYM();
  const cats = monthCats(ym);
  const total = cats.reduce((s, [, v]) => s + v, 0);
  const svg = $("#donut");
  $("#chart-total").textContent = yen(total);
  $("#chart-title").textContent = `今月のカテゴリー（${parseInt(ym.slice(5))}月）`;

  if (!total) {
    svg.innerHTML = `<circle cx="100" cy="100" r="80" fill="none" stroke="#2a3568" stroke-width="6" stroke-dasharray="4 6"/>`;
    $("#legend").innerHTML = `<div class="empty-msg">まだ記録がありません</div>`;
    return;
  }

  let a = -Math.PI / 2;
  let paths = "";
  for (const [cat, v] of cats) {
    const a1 = a + (v / total) * Math.PI * 2;
    const end = cats.length === 1 ? a1 - 0.0001 : a1;
    paths += `<path d="${arcPath(100, 100, 84, a, end)}" fill="${catColor(cat)}" stroke="#0a1030" stroke-width="2"/>`;
    a = a1;
  }
  paths += `<circle cx="100" cy="100" r="46" fill="#0a1030"/>`;
  svg.innerHTML = paths;

  $("#legend").innerHTML = cats.map(([cat, v]) => `
    <div class="legend-row">
      <span class="legend-chip" style="background:${catColor(cat)}"></span>
      <span class="legend-name">${esc(cat)}</span>
      <span class="legend-amt">${yen(v)}（${Math.round(v / total * 100)}%）</span>
    </div>`).join("");
}

/* ================================================================
   記録リスト・アーカイブ
   ================================================================ */

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function recHTML(r) {
  return `
  <div class="rec">
    <div class="rec-head">
      <span class="rec-store">${esc(r.store)}</span>
      <span>
        <span class="rec-amt">${yen(r.amount)}</span>
        <button class="rec-del" data-id="${r.id}">✕</button>
      </span>
    </div>
    <div class="rec-meta">
      <span>📅 ${r.date}</span><span>💳 ${esc(r.payment)}</span>
      <span style="color:${catColor(r.category)}">■ ${esc(r.category)}</span>
    </div>
    ${r.raw ? `<details><summary>レシート全文</summary><pre>${esc(r.raw)}</pre></details>` : ""}
  </div>`;
}

function renderRecords() {
  const list = monthRecords(currentYM()).slice().sort((a, b) => b.date.localeCompare(a.date));
  $("#record-list").innerHTML = list.length
    ? list.map(recHTML).join("")
    : `<div class="empty-msg">📷 レシートをさつえいして記録をはじめよう</div>`;
}

function renderArchive() {
  const byYear = {};
  for (const r of records) {
    const y = r.date.slice(0, 4);
    (byYear[y] = byYear[y] || []).push(r);
  }
  const years = Object.keys(byYear).sort().reverse();
  if (!years.length) {
    $("#archive-list").innerHTML = `<div class="empty-msg">まだアーカイブがありません</div>`;
    return;
  }
  const nowYM = currentYM();
  $("#archive-list").innerHTML = years.map(y => {
    const months = {};
    for (const r of byYear[y]) (months[ymOf(r.date)] = months[ymOf(r.date)] || []).push(r);
    const yearTotal = byYear[y].reduce((s, r) => s + r.amount, 0);
    const monthRows = Object.keys(months).sort().reverse().map(ym => {
      const spent = months[ym].reduce((s, r) => s + r.amount, 0);
      const mi = parseInt(ym.slice(5), 10);
      const status = ym === nowYM ? `<span class="month-status st-now">挑戦中</span>` :
        spent > BUDGET ? `<span class="month-status st-fail">FAIL</span>` :
        `<span class="month-status st-clear">CLEAR</span>`;
      const cats = {};
      for (const r of months[ym]) cats[r.category] = (cats[r.category] || 0) + r.amount;
      const catStr = Object.entries(cats).sort((a, b) => b[1] - a[1])
        .map(([c, v]) => `${esc(c)} ${yen(v)}`).join(" ／ ");
      return `
      <div class="month-row">
        <div class="month-row-head">
          <span>${mi}月 🗼${TOWERS[mi - 1].name}</span>
          <span>${yen(spent)} ${status}</span>
        </div>
        <div class="month-cats">${catStr}</div>
      </div>`;
    }).join("");
    return `
    <div class="year-block">
      <div class="year-head">
        <span class="year-title">${y}年　合計 ${yen(yearTotal)}</span>
        <button class="year-del" data-year="${y}">🗑 削除</button>
      </div>
      ${monthRows}
    </div>`;
  }).join("");
}

/* 削除（記録・年） */
document.addEventListener("click", e => {
  const del = e.target.closest(".rec-del");
  if (del) {
    if (confirm("この記録を削除しますか？")) deleteRecord(del.dataset.id);
    return;
  }
  const yd = e.target.closest(".year-del");
  if (yd) {
    const y = yd.dataset.year;
    if (confirm(`${y}年の記録をすべて削除しますか？`) &&
        confirm(`本当に削除しますか？ ${y}年のデータは元に戻せません。`)) {
      deleteYear(y);
    }
  }
});

/* ---------------- バックアップ ---------------- */

$("#btn-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ records, categories }, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `tower-kakeibo-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$("#btn-import").addEventListener("click", () => $("#import-input").click());
$("#import-input").addEventListener("change", e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const j = JSON.parse(fr.result);
      if (!Array.isArray(j.records)) throw 0;
      if (!confirm(`${j.records.length}件の記録を読み込みます。今のデータに追加しますか？`)) return;
      const ids = new Set(records.map(r => r.id));
      for (const r of j.records) if (!ids.has(r.id)) records.push(r);
      for (const c of (j.categories || [])) if (!categories.includes(c)) categories.push(c);
      save("kk_records", records);
      save("kk_categories", categories);
      refreshAll();
    } catch { alert("読み込めないファイルです"); }
  };
  fr.readAsText(file);
});

/* ================================================================
   ページインジケータ・起動
   ================================================================ */

const pagesEl = $("#pages");
pagesEl.addEventListener("scroll", () => {
  const i = Math.round(pagesEl.scrollLeft / pagesEl.clientWidth);
  document.querySelectorAll(".dot").forEach((d, di) => d.classList.toggle("active", di === i));
}, { passive: true });

function refreshAll() {
  updateHUD();
  renderChart();
  renderRecords();
  renderArchive();
}

/* 月が変わったら自動で新しいタワーを表示（リセット） */
setInterval(() => {
  const now = currentYM();
  if (viewYM < now && $("#pages").scrollLeft < 10) { /* 手動で過去を見ている場合は動かさない */ }
  updateHUD();
}, 60000);

refreshAll();
fetchWeather();
requestAnimationFrame(loop);

/* Service Worker 登録（オフライン対応・半永久利用） */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
