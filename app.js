/* =====================================================================
   ecoai pulse · Monitoreo ambiental inteligente
   ---------------------------------------------------------------------
   Versión de datos reales: estación Juan Mina (Barranquilla) · PM10.
   - Datos: reporte_sisaire.csv (SISAIRE-IDEAM), cargado al abrir la página.
       · Con servidor (GitHub Pages, Netlify, `python -m http.server`) se
         lee el CSV con fetch().
       · Si se abre index.html con doble clic (file://), el navegador
         bloquea fetch(); entonces se usa la copia incluida en
         reporte_sisaire.js (generada a partir del mismo CSV).
     No hay datos simulados, telemetría ni otras estaciones.
   - IA: Random Forest de regresión implementado desde cero (sin librerías).
       · Variable objetivo: cambio de PM10 entre registros consecutivos.
       · Entradas: valor actual, rezagos 1, 2 y 5, promedio de 6 registros
         y tendencia (y_t - y_{t-3}). Sin hora del día ni variables simuladas.
       · Validación hold-out cronológica 80/20 con MAE y RMSE frente a la
         persistencia (repetir el último valor).
       · Anomalías por residuo estandarizado: |z| >= 2.5, positivas y negativas.
   - La misma lógica se reproduce en evaluar_pm10.js (Node) para el artículo.
   ===================================================================== */
(() => {
'use strict';

/* ---------- utilidades ---------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mean = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const std = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
const fmt = (v, d = 1) => Number(v).toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const DAY = 86400000;
const dateFull  = t => new Date(t).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
const dateShort = t => new Date(t).toLocaleDateString('es-CO', { month: 'short', year: '2-digit' }).replace('.', '');
const durTxt = ms => { const d = ms / DAY; if (d >= 1) { const r = Math.round(d); return `${r} ${r === 1 ? 'día' : 'días'}`; } const h = ms / 3600e3; return `${+h.toFixed(1)} h`; };
const stepTxt = ms => ms >= DAY * .9 ? 'registro diario' : `registro de ${durTxt(ms)}`;

/* ---------- iconos (SVG en línea) ---------- */
const ICONS = {
  wind: '<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  radio: '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-5 3 3 5-7"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>'
};
const ico = (n, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>`;

/* ---------- constantes del proyecto ---------- */
const CSV_FILE = 'reporte_sisaire.csv';
const REF_OMS = 45;      // guía OMS 2021, promedio de 24 h (µg/m³)
const REF_COL = 75;      // Resolución 2254 de 2017, nivel máximo diario (µg/m³)
const Z_TH = 2.5;        // umbral de anomalía (|z|)
const SEED = 11;         // semilla del modelo de validación (reproducible)
const HORIZON = 7;       // pasos (registros diarios) del pronóstico
const GAP_MS = 4 * DAY;  // un salto mayor se dibuja como interrupción

/* ---------- estado ---------- */
const D = { t: [], v: [], step: DAY, station: 'Juan Mina', source: CSV_FILE };
const S = { days: 365, chartPts: [], model: null, fc: null };

/* =====================================================================
   RANDOM FOREST (regresión)
   ===================================================================== */
class RandomForest {
  constructor(o = {}) {
    this.nTrees = o.nTrees || 40; this.maxDepth = o.maxDepth || 7; this.minLeaf = o.minLeaf || 3;
    this.mtry = o.mtry || 0; this.rnd = mulberry32(o.seed || 1); this.trees = []; this.imp = [];
  }
  fit(X, y) {
    const n = X.length, p = X[0].length; this.p = p; this.imp = new Array(p).fill(0); this.trees = [];
    const mtry = this.mtry || Math.max(2, Math.ceil(p / 2));
    for (let t = 0; t < this.nTrees; t++) {
      const idx = new Array(n);
      for (let i = 0; i < n; i++) idx[i] = Math.floor(this.rnd() * n);   // bootstrap
      this.trees.push(this._grow(X, y, idx, 0, mtry));
    }
    return this;
  }
  _grow(X, y, idx, depth, mtry) {
    const n = idx.length; let s = 0; for (const i of idx) s += y[i];
    const mean = s / n;
    if (depth >= this.maxDepth || n < 2 * this.minLeaf) return { v: mean };
    const p = this.p, feats = [...Array(p).keys()];
    for (let i = 0; i < mtry; i++) { const j = i + Math.floor(this.rnd() * (p - i)); [feats[i], feats[j]] = [feats[j], feats[i]]; }
    let best = null; const base = s * s / n;
    for (let q = 0; q < mtry; q++) {
      const f = feats[q];
      const order = idx.slice().sort((a, b) => X[a][f] - X[b][f]);
      let sl = 0;
      for (let k = 1; k < n; k++) {
        sl += y[order[k - 1]];
        if (k < this.minLeaf || n - k < this.minLeaf) continue;
        const a = X[order[k - 1]][f], b = X[order[k]][f];
        if (a === b) continue;
        const sr = s - sl, score = sl * sl / k + sr * sr / (n - k);
        if (!best || score > best.score) best = { score, f, thr: (a + b) / 2 };
      }
    }
    if (!best || best.score - base <= 1e-12) return { v: mean };
    this.imp[best.f] += best.score - base;
    const L = [], R = [];
    for (const i of idx) (X[i][best.f] <= best.thr ? L : R).push(i);
    if (!L.length || !R.length) return { v: mean };
    return { f: best.f, thr: best.thr, l: this._grow(X, y, L, depth + 1, mtry), r: this._grow(X, y, R, depth + 1, mtry) };
  }
  _pred(node, x) { while (node.f !== undefined) node = x[node.f] <= node.thr ? node.l : node.r; return node.v; }
  predict(x) { let s = 0; for (const t of this.trees) s += this._pred(t, x); return s / this.trees.length; }
  predictSpread(x) {
    const a = this.trees.map(t => this._pred(t, x)), m = mean(a);
    return { mean: m, std: Math.sqrt(mean(a.map(v => (v - m) ** 2))) };
  }
  importance() { const t = this.imp.reduce((s, v) => s + v, 0) || 1; return this.imp.map(v => v / t); }
}


/* ---------- ingeniería de características ---------- */
function featVec(v, i) {
  const g = k => v[Math.max(0, i - k)];
  let m = 0; for (let k = 0; k < 6; k++) m += g(k);
  return [g(0), g(1), g(2), g(5), m / 6, g(0) - g(3)];
}
const FEAT_NAMES = ['valor actual', 'valor del registro anterior', 'valor de hace 2 registros', 'valor de hace 5 registros', 'promedio de 6 registros', 'tendencia reciente'];

function buildModel() {
  const v = D.v, n = v.length;
  if (n < 40) return null;
  const X = [], y = [], tIdx = [];
  for (let i = 6; i < n - 1; i++) { X.push(featVec(v, i)); y.push(v[i + 1] - v[i]); tIdx.push(i + 1); }   // el modelo predice el cambio
  if (X.length < 30) return null;
  const cut = Math.floor(X.length * .8);
  const ev = new RandomForest({ seed: SEED }).fit(X.slice(0, cut), y.slice(0, cut));          // validación hold-out
  let ae = 0, se = 0, aeP = 0, seP = 0; const rows = [];
  for (let i = cut; i < X.length; i++) {
    const p = ev.predict(X[i]), e = y[i] - p, j = tIdx[i];
    ae += Math.abs(e); se += e * e; aeP += Math.abs(y[i]); seP += y[i] * y[i];
    rows.push({ t: D.t[j], obs: v[j], exp: v[j - 1] + p, res: e });
  }
  const m = Math.max(1, X.length - cut), sigma = Math.max(std(rows.map(r => r.res)), 1e-6);
  rows.forEach(r => { r.z = r.res / sigma; });
  const rf = new RandomForest({ seed: SEED + 1 }).fit(X, y);                                   // modelo final (100 %)
  return { rf, ev, rows, sigma, nTrain: cut, nTest: m, mae: ae / m, rmse: Math.sqrt(se / m), maeP: aeP / m, rmseP: Math.sqrt(seP / m), names: FEAT_NAMES,
           anomalies: rows.filter(r => Math.abs(r.z) >= Z_TH) };
}

function buildForecast(m) {
  const v = D.v.slice(-8), t = D.t.slice(-8), step = D.step, out = { t: [], mean: [], lo: [], hi: [], H: HORIZON, step };
  for (let k = 1; k <= HORIZON; k++) {
    const x = featVec(v, v.length - 1), sp = m.rf.predictSpread(x);
    v.push(Math.max(0, v[v.length - 1] + sp.mean));
    t.push(t[t.length - 1] + step);
    const band = 1.64 * Math.sqrt(m.sigma ** 2 * k + sp.std ** 2);
    out.t.push(t[t.length - 1]); out.mean.push(v[v.length - 1]);
    out.lo.push(Math.max(0, v[v.length - 1] - band)); out.hi.push(v[v.length - 1] + band);
  }
  return out;
}
function recompute() { S.model = buildModel(); S.fc = S.model ? buildForecast(S.model) : null; }

/* =====================================================================
   ESTADOS Y ALERTAS
   ===================================================================== */
function statusOf(v) {
  if (v >= REF_COL) return { cls: 'bad', text: '● Supera Res. 2254 (75)', level: 3 };
  if (v >= REF_OMS) return { cls: 'bad', text: '● Supera guía OMS (45)', level: 2 };
  if (v >= REF_OMS * .8) return { cls: 'warn', text: '● Cerca de la guía OMS', level: 1 };
  return { cls: '', text: '● Dentro de la guía OMS', level: 0 };
}
const sign = z => (z > 0 ? 'por encima' : 'por debajo');

function buildAlerts() {
  const out = [], n = D.v.length, v = D.v[n - 1], s = statusOf(v), m = S.model, fc = S.fc;
  if (s.level >= 2) out.push({ lvl: 'bad', t: 'PM10 por encima de la referencia', d: `${fmt(v)} µg/m³ · guía OMS 24 h: ${REF_OMS} · Res. 2254: ${REF_COL}` });
  else if (s.level === 1) out.push({ lvl: 'warn', t: 'PM10 cerca de la guía OMS', d: `${Math.round(v / REF_OMS * 100)}% de la referencia (${REF_OMS} µg/m³)` });
  else if (fc && Math.max(...fc.mean) >= REF_OMS) out.push({ lvl: 'warn', t: 'PM10 podría superar la guía OMS', d: `Pronóstico RF: ${fmt(Math.max(...fc.mean))} µg/m³ en ${durTxt(fc.H * fc.step)}` });
  if (m) {
    const last = m.rows[m.rows.length - 1];
    if (last && last.t === D.t[n - 1] && Math.abs(last.z) >= Z_TH) out.push({ lvl: 'warn', t: 'Cambio atípico en el último registro', d: `Se aparta ${sign(last.z)} de lo esperado por el modelo (z = ${fmt(last.z, 1)})` });
    const pos = m.anomalies.filter(a => a.z > 0).length, neg = m.anomalies.length - pos;
    out.push({ lvl: m.anomalies.length ? 'warn' : 'ok', t: `Anomalías en la prueba piloto: ${m.anomalies.length}`,
      d: m.anomalies.length ? `${pos} positiva${pos === 1 ? '' : 's'} y ${neg} negativa${neg === 1 ? '' : 's'} en ${m.nTest} registros · ` + m.anomalies.map(a => `${dateFull(a.t)} (z ${a.z > 0 ? '+' : ''}${fmt(a.z, 1)})`).join('; ') : `Ningún registro con |z| ≥ ${Z_TH} en ${m.nTest} registros` });
  }
  if (!out.length) out.push({ lvl: 'ok', t: 'Sin alertas activas', d: 'El último registro está dentro de lo esperado' });
  return out.slice(0, 4);
}

/* =====================================================================
   RENDER
   ===================================================================== */
function renderCards() {
  const n = D.v.length, box = $('#cards');
  if (!n) { box.innerHTML = ''; return; }
  const v = D.v[n - 1], mu = mean(D.v), sd = Math.sqrt(D.v.reduce((s, x) => s + (x - mu) ** 2, 0) / (n - 1));
  const mx = Math.max(...D.v), mxT = D.t[D.v.indexOf(mx)], s = statusOf(v);
  const nO = D.v.filter(x => x > REF_OMS).length, nC = D.v.filter(x => x > REF_COL).length, fc = S.fc;
  const cards = [
    { l: 'PM10 · último registro', v: fmt(v, 1), u: 'µg/m³', c: '#e8795a', i: 'wind', f: s.text, fc: s.cls },
    { l: 'Media de la serie', v: fmt(mu, 1), u: 'µg/m³', c: '#4a8fc7', i: 'chart', f: `DE ${fmt(sd, 1)} · n = ${n}`, fc: '' },
    { l: 'Máximo registrado', v: fmt(mx, 1), u: 'µg/m³', c: '#e0614f', i: 'up', f: dateFull(mxT), fc: '' },
    { l: `Registros > ${REF_OMS}`, v: String(nO), u: 'guía OMS', c: '#e9a23b', i: 'alert', f: `${fmt(nO / n * 100, 1)}% de la serie`, fc: nO ? 'warn' : '' },
    { l: `Registros > ${REF_COL}`, v: String(nC), u: 'Res. 2254', c: '#d9503f', i: 'alert', f: `${fmt(nC / n * 100, 1)}% de la serie`, fc: nC ? 'bad' : '' },
    { l: 'Pronóstico RF · siguiente', v: fc ? fmt(fc.mean[0], 1) : '--', u: 'µg/m³', c: '#2fb08a', i: 'target', f: fc ? `Rango 90%: ${fmt(fc.lo[0], 1)} – ${fmt(fc.hi[0], 1)}` : 'Datos insuficientes', fc: '' }
  ];
  box.innerHTML = cards.map(c => `<article class="mcard" style="--c:${c.c}">
      <div class="mcard-top"><span>${c.l}</span><span style="color:${c.c}">${ico(c.i, 16)}</span></div>
      <div class="mcard-val"><b>${c.v}</b><small>${c.u}</small></div>
      <div class="mcard-foot ${c.fc}">${c.f}</div></article>`).join('');
}

function niceTicks(min, max, n = 5) {
  const span = max - min || 1, raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
  const s = (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
  const a = Math.floor(min / s) * s, b = Math.ceil(max / s) * s, t = [];
  for (let v = a; v <= b + s / 2; v += s) t.push(+v.toFixed(6));
  return t;
}

function drawChart() {
  const cv = $('#chart'), ctx = cv.getContext('2d'), dpr = window.devicePixelRatio || 1;
  const W = cv.parentElement.clientWidth, Hh = 300;
  cv.width = Math.round(W * dpr); cv.height = Hh * dpr; cv.style.width = '100%'; cv.style.height = Hh + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, Hh);
  S.chartPts = [];
  if (D.t.length < 2) return;
  const L = 46, R = 14, T = 12, B = 26, pw = W - L - R, ph = Hh - T - B;
  const tEnd = D.t.at(-1), tStart = S.days ? tEnd - S.days * DAY : D.t[0];
  let pts = []; for (let i = 0; i < D.t.length; i++) if (D.t[i] >= tStart) pts.push({ t: D.t[i], v: D.v[i] });
  if (pts.length < 2) pts = D.t.slice(-2).map((t, i) => ({ t, v: D.v.slice(-2)[i] }));
  const fc = S.fc, m = S.model;
  const tMax = fc ? fc.t.at(-1) : tEnd, t0 = Math.min(tStart, pts[0].t);

  let ymin = Math.min(...pts.map(p => p.v)), ymax = Math.max(...pts.map(p => p.v));
  if (fc) { ymin = Math.min(ymin, ...fc.lo); ymax = Math.max(ymax, ...fc.hi); }
  const refs = [REF_OMS, REF_COL].filter(r => r <= ymax * 1.6);
  refs.forEach(r => { ymax = Math.max(ymax, r); });
  const pad = (ymax - ymin) * .08 || 1;
  const ticks = niceTicks(Math.max(0, ymin - pad), ymax + pad, 5), y0 = ticks[0], y1 = ticks.at(-1);
  const X = t => L + (t - t0) / (tMax - t0) * pw, Y = v => T + (1 - (v - y0) / (y1 - y0)) * ph;

  ctx.font = '10.5px "JetBrains Mono",monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.strokeStyle = '#e8eee6'; ctx.fillStyle = '#7a897e'; ctx.lineWidth = 1;
  const yd = (y1 - y0) / (ticks.length - 1) < 1 ? 1 : 0;
  ticks.forEach(v => { const y = Math.round(Y(v)) + .5; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - R, y); ctx.stroke(); ctx.fillText(fmt(v, yd), L - 8, y); });
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let i = 0; i <= 5; i++) { const t = t0 + (tMax - t0) * i / 5; ctx.fillText(S.days && S.days <= 90 ? new Date(t).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }).replace('.', '') : dateShort(t), clamp(X(t), L + 22, W - R - 22), Hh - B + 8); }
  // referencias (guía OMS y Res. 2254)
  refs.forEach((r, k) => {
    if (r < y0 || r > y1) return;
    ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = k ? 'rgba(179,50,31,.75)' : 'rgba(217,116,31,.8)'; ctx.beginPath(); ctx.moveTo(L, Y(r)); ctx.lineTo(W - R, Y(r)); ctx.stroke(); ctx.restore();
    ctx.fillStyle = k ? '#b3321f' : '#b9701d'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(k ? `Res. 2254 · ${r}` : `OMS 2021 · ${r}`, L + 6, Y(r) - 3);
  });
  // serie real, con interrupciones donde faltan registros
  const g = '#e8795a', segs = []; let cur = [];
  pts.forEach((p, i) => { if (i && p.t - pts[i - 1].t > GAP_MS) { segs.push(cur); cur = []; } cur.push(p); }); segs.push(cur);
  const grad = ctx.createLinearGradient(0, T, 0, T + ph); grad.addColorStop(0, g + '40'); grad.addColorStop(1, g + '00');
  segs.forEach(sg => {
    if (sg.length > 1) { ctx.beginPath(); sg.forEach((p, i) => i ? ctx.lineTo(X(p.t), Y(p.v)) : ctx.moveTo(X(p.t), Y(p.v))); ctx.lineTo(X(sg.at(-1).t), T + ph); ctx.lineTo(X(sg[0].t), T + ph); ctx.closePath(); ctx.fillStyle = grad; ctx.fill(); }
    ctx.beginPath(); sg.forEach((p, i) => i ? ctx.lineTo(X(p.t), Y(p.v)) : ctx.moveTo(X(p.t), Y(p.v)));
    ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    if (sg.length === 1) { ctx.beginPath(); ctx.arc(X(sg[0].t), Y(sg[0].v), 2.5, 0, 7); ctx.fillStyle = g; ctx.fill(); }
  });
  S.chartPts = pts.map(p => ({ x: X(p.t), y: Y(p.v), t: p.t, v: p.v, fc: false }));
  // anomalías (▲ positiva, ▼ negativa) dentro de la ventana
  if (m) m.anomalies.forEach(a => {
    if (a.t < t0) return; const x = X(a.t), y = Y(a.obs), up = a.z > 0, c = up ? '#d9741f' : '#7a3fa0';
    ctx.beginPath(); if (up) { ctx.moveTo(x, y - 12); ctx.lineTo(x - 6, y - 2); ctx.lineTo(x + 6, y - 2); } else { ctx.moveTo(x, y + 12); ctx.lineTo(x - 6, y + 2); ctx.lineTo(x + 6, y + 2); }
    ctx.closePath(); ctx.fillStyle = c; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
    const q = S.chartPts.find(p => p.t === a.t); if (q) q.an = a;
  });
  // pronóstico
  if (fc) {
    const last = pts.at(-1);
    ctx.beginPath(); ctx.moveTo(X(last.t), Y(last.v));
    fc.t.forEach((t, i) => ctx.lineTo(X(t), Y(fc.hi[i])));
    for (let i = fc.t.length - 1; i >= 0; i--) ctx.lineTo(X(fc.t[i]), Y(fc.lo[i]));
    ctx.closePath(); ctx.fillStyle = g + '22'; ctx.fill();
    ctx.save(); ctx.setLineDash([6, 5]); ctx.strokeStyle = '#5d6e62'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(X(last.t), Y(last.v)); fc.t.forEach((t, i) => ctx.lineTo(X(t), Y(fc.mean[i]))); ctx.stroke(); ctx.restore();
    fc.t.forEach((t, i) => S.chartPts.push({ x: X(t), y: Y(fc.mean[i]), t, v: fc.mean[i], lo: fc.lo[i], hi: fc.hi[i], fc: true }));
    ctx.strokeStyle = '#c3cfc3'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(last.t) + .5, T); ctx.lineTo(X(last.t) + .5, T + ph); ctx.stroke();
  }
  const lp = pts.at(-1); ctx.beginPath(); ctx.arc(X(lp.t), Y(lp.v), 4.5, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = g; ctx.stroke();
}

function renderMeta() {
  const win = S.days === 30 ? 'últimos 30 días' : S.days === 90 ? 'últimos 90 días' : S.days === 365 ? 'último año' : 'serie completa';
  $('#trendSub').textContent = `Estación ${D.station} · PM10 diario · ${win} de la serie`;
  $('#stationName').textContent = D.station;
  const last = D.t.at(-1);
  $('#lastRead').textContent = last ? `Último registro: ${dateFull(last)} · Fuente SISAIRE-IDEAM (${D.source})` : 'Último registro: --';
  $$('#rangeTabs button').forEach(b => b.classList.toggle('on', +b.dataset.d === S.days));
  const n = D.v.length, m = S.model;
  $('#dsSource').textContent = `SISAIRE-IDEAM · ${D.station}`;
  $('#dsRecords').textContent = n ? `${n} · ${dateFull(D.t[0])} a ${dateFull(last)}` : '--';
  $('#dsTest').textContent = m ? `${m.nTest} reg. · ${dateFull(m.rows[0].t)} a ${dateFull(m.rows.at(-1).t)}` : '--';
  $('#dsMetrics').textContent = m ? `RF ${fmt(m.mae, 2)} · ${fmt(m.rmse, 2)} | pers. ${fmt(m.maeP, 2)} · ${fmt(m.rmseP, 2)}` : '--';
}

function renderMap() {
  const n = D.v.length, lvl = n ? statusOf(D.v[n - 1]).level : 0;
  $('#mapPoints').innerHTML = `<button class="pt sel" style="left:50%;top:52%;--pc:${lvl >= 1 ? '#f4a63c' : '#35d08d'}" aria-label="${D.station}" tabindex="-1"><span class="lbl">${D.station}</span></button>`;
  $('#mapCount').textContent = `SISAIRE-IDEAM · PM10`;
}
function renderAlerts() {
  $('#alertList').innerHTML = D.v.length ? buildAlerts().map(a => `<li><i class="dot ${a.lvl}"></i><div><b>${a.t}</b><span>${a.d}</span></div></li>`).join('') : '<li><i class="dot warn"></i><div><b>Sin datos</b><span>No se ha cargado la serie de PM10</span></div></li>';
}

function renderAI() {
  const box = $('#aiBody'), m = S.model, fc = S.fc;
  if (!m || !fc) { box.innerHTML = '<p class="muted">Se necesitan al menos 40 registros para entrenar el modelo.</p>'; $('#aiFoot').textContent = ''; return; }
  const n = D.v.length, last = D.v[n - 1], items = [];
  const end = fc.mean.at(-1), pct = (end - last) / last * 100;
  items.push({ c: '', h: `<b>Pronóstico a ${durTxt(fc.H * fc.step)}:</b> ${fmt(end, 1)} µg/m³ (${pct >= 0 ? '↗ +' : '↘ '}${fmt(pct, 1)}% frente al último registro). Rango probable ${fmt(fc.lo.at(-1), 1)} – ${fmt(fc.hi.at(-1), 1)}.` });
  const mx = Math.max(...fc.mean);
  items.push(last >= REF_OMS ? { c: 'warn', h: `El último registro (<b>${fmt(last)} µg/m³</b>) supera la guía OMS (${REF_OMS}). Conviene vigilar la estación.` }
    : mx >= REF_OMS ? { c: 'warn', h: `El modelo anticipa llegar a <b>${fmt(mx)} µg/m³</b>, por encima de la guía OMS (${REF_OMS}).` }
    : { c: '', h: `Se espera que el PM10 se mantenga por debajo de la guía OMS (${REF_OMS} µg/m³) en el horizonte del pronóstico.` });
  const mejora = (1 - m.mae / m.maeP) * 100;
  items.push({ c: mejora > 0 ? '' : 'warn', h: `<b>Frente a la persistencia:</b> MAE ${fmt(m.mae, 2)} vs ${fmt(m.maeP, 2)} µg/m³ (${mejora >= 0 ? 'mejora' : 'empeora'} ${fmt(Math.abs(mejora), 1)}%). ${Math.abs(mejora) < 5 ? 'La diferencia es pequeña: repetir el último valor es una línea base difícil de superar.' : ''}` });
  const imp = m.rf.importance(), top = imp.map((v, i) => [m.names[i], v]).sort((a, b) => b[1] - a[1]).slice(0, 2);
  items.push({ c: '', h: `<b>Qué pesa más en la predicción:</b> ${top.map(([nm, v]) => `${nm} (${Math.round(v * 100)}%)`).join(' y ')}.` });
  const z = m.rows.at(-1).z;
  items.push(Math.abs(z) >= Z_TH ? { c: 'warn', h: `<b>Posible anomalía:</b> el último registro se aparta ${sign(z)} de lo esperado (z = ${fmt(z, 1)}).` } : { c: '', h: `<b>Sin anomalía reciente:</b> el último registro está dentro de lo esperado (z = ${fmt(z, 1)}).` });
  items.push({ c: '', h: `<b>Ojo con el periodo de prueba:</b> el 20% final de la serie tiene una media de ${fmt(mean(m.rows.map(r => r.obs)), 1)} µg/m³, frente a ${fmt(mean(D.v), 1)} de toda la serie; el modelo no se ha probado en los episodios altos.` });
  box.innerHTML = `<ul class="insights">${items.map(i => `<li class="${i.c}"><span>${i.h}</span></li>`).join('')}</ul>`;
  $('#aiFoot').textContent = `Random Forest · ${m.rf.trees.length} árboles · profundidad ${m.rf.maxDepth} · MAE ${fmt(m.mae, 2)} · RMSE ${fmt(m.rmse, 2)} (persistencia ${fmt(m.maeP, 2)} · ${fmt(m.rmseP, 2)}) · validación 80/20`;
}

function renderAll() { renderCards(); renderMeta(); renderMap(); drawChart(); renderAlerts(); renderAI(); }

/* =====================================================================
   CARGA DE DATOS REALES (CSV de SISAIRE)
   ===================================================================== */
function parseDate(s) {
  if (!s) return NaN;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);        // 2026-05-31 (fecha local, sin desfase de zona horaria)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime();
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);    // 31/05/2026
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime();
  return Date.parse(s.replace(' ', 'T'));
}
function splitLine(line, delim) {                        // respeta comillas
  const out = []; let cur = '', q = false;
  for (const ch of line) { if (ch === '"') q = !q; else if (ch === delim && !q) { out.push(cur.trim()); cur = ''; } else cur += ch; }
  out.push(cur.trim()); return out;
}
function parseCSV(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 31) throw new Error('pocos datos');
  const delim = [';', '\t', ','].find(d => lines[0].includes(d)) || ',';
  const head = splitLine(lines[0], delim).map(s => s.toLowerCase());
  let si = head.findIndex(h => /estaci/.test(h)), ci = head.findIndex(h => /fecha|date|time|hora/.test(h)), vi = head.findIndex(h => /pm10|valor|value|concentr|medic/.test(h));
  if (ci < 0) ci = 0; if (vi < 0 || vi === ci) vi = ci === 0 ? 1 : 0;
  const rows = []; let station = null;
  for (let k = 1; k < lines.length; k++) {
    const c = splitLine(lines[k], delim);
    if (si >= 0) { if (station === null) station = c[si]; if (c[si] !== station) continue; }   // una sola estación por archivo
    const t = parseDate(c[ci]), x = parseFloat((c[vi] || '').replace(',', '.'));
    if (isFinite(t) && isFinite(x) && x >= 0) rows.push([t, x]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  const u = rows.filter((r, i) => !i || r[0] !== rows[i - 1][0]).slice(-3000);
  if (u.length < 30) throw new Error('pocos datos válidos');
  const diffs = u.slice(1).map((r, i) => r[0] - u[i][0]).sort((a, b) => a - b);
  const title = s => s.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
  return { t: u.map(r => r[0]), v: u.map(r => r[1]), step: Math.max(60000, diffs[Math.floor(diffs.length / 2)]), station: station ? title(station) : 'Juan Mina' };
}
function applyCSV(text, name) {
  const d = parseCSV(text);
  D.t = d.t; D.v = d.v; D.step = d.step; D.station = d.station; D.source = name || CSV_FILE;
  $('#banner').hidden = true;
  recompute(); renderAll();
  return d;
}
async function loadDefault(silent) {
  $('#banner').hidden = true;
  let text = null, how = '';
  try { if (location.protocol === 'file:') throw new Error('file://'); const r = await fetch(CSV_FILE + '?' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error('http ' + r.status); text = await r.text(); how = 'archivo'; }
  catch (e) { if (typeof window.SISAIRE_CSV === 'string') { text = window.SISAIRE_CSV; how = 'copia integrada'; } }
  try {
    if (text === null) throw new Error('sin datos');
    const d = applyCSV(text, CSV_FILE);
    if (!silent) toast(`PM10 de ${d.station}: ${d.v.length} registros (${how})`);
    return true;
  } catch (e) {
    $('#banner').hidden = false; renderAll();
    if (!silent) toast('No se pudo cargar el CSV de SISAIRE');
    return false;
  }
}

/* ---------- reporte CSV ---------- */
function downloadReport() {
  if (!D.v.length) { toast('No hay datos para el reporte'); return; }
  const m = S.model, fc = S.fc, ex = new Map(m ? m.rows.map(r => [r.t, r]) : []);
  const iso = t => { const d = new Date(t), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const rows = ['fecha,pm10_ugm3,pm10_esperado_RF,z_residuo,anomalia,pm10_pronostico_RF'];
  D.t.forEach((t, i) => { const r = ex.get(t); rows.push([iso(t), D.v[i].toFixed(2), r ? r.exp.toFixed(2) : '', r ? r.z.toFixed(2) : '', r && Math.abs(r.z) >= Z_TH ? (r.z > 0 ? 'positiva' : 'negativa') : '', ''].join(',')); });
  if (fc) fc.t.forEach((t, i) => rows.push([iso(t), '', '', '', '', fc.mean[i].toFixed(2)].join(',')));
  const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `reporte_ecoai_pm10_${D.station.toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast('Reporte descargado');
}

/* ---------- toast ---------- */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3200); }

/* ---------- textura del mapa (bosque) ---------- */
function drawForest() {
  const cv = $('#forest'), box = cv.parentElement, w = box.clientWidth, h = box.clientHeight, dpr = window.devicePixelRatio || 1;
  cv.width = w * dpr; cv.height = h * dpr; const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0b2216'; ctx.fillRect(0, 0, w, h);
  const r = mulberry32(42), cols = ['#0f2d1c', '#13381f', '#174425', '#0a2014', '#1c5230', '#0d2a19'];
  for (let i = 0; i < w * h / 55; i++) {
    const x = r() * w, y = r() * h, rad = 5 + r() * 13;
    ctx.globalAlpha = .55 + r() * .4; ctx.fillStyle = cols[Math.floor(r() * cols.length)];
    ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
    if (r() < .35) { ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(120,190,130,.13)'; ctx.beginPath(); ctx.arc(x - rad * .3, y - rad * .3, rad * .45, 0, 7); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
}

/* ---------- estilos y ayuda (se inyectan desde JS) ---------- */
function injectCSS() {
  const css = document.createElement('style');
  css.textContent = `
  #chart{cursor:crosshair}
  .tip .tt{color:#b9ccbf;font-size:10.5px}
  .tip.below{transform:translate(-50%,24%)}
  .hov{position:absolute;width:11px;height:11px;margin:-5.5px 0 0 -5.5px;border-radius:50%;background:#fff;border:2.5px solid;pointer-events:none;z-index:2;box-shadow:0 1px 5px rgba(0,0,0,.25)}
  #helpFab{position:fixed;right:18px;bottom:18px;z-index:40;padding:11px 16px;border-radius:99px;background:var(--green);color:#fff;font-size:13px;font-weight:600;border:1px solid rgba(255,255,255,.2);box-shadow:0 10px 26px rgba(16,38,26,.3);transition:.15s}
  #helpFab:hover{background:var(--green-d);transform:translateY(-1px)}
  .help-link{margin-top:12px;padding:8px 13px;border-radius:99px;border:1px solid #9fd5b4;background:#dff2e6;color:#165a38;font-size:12px;font-weight:600}
  .help-link:hover{background:#cfeadb}
  @media(max-width:640px){#helpFab{right:10px;bottom:10px;padding:9px 13px;font-size:12px}}
  .help-ov{position:fixed;inset:0;z-index:100;background:rgba(5,20,12,.58);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:18px;animation:helpIn .18s ease}
  @keyframes helpIn{from{opacity:0}to{opacity:1}}
  .help-dlg{width:min(680px,100%);max-height:88vh;display:flex;flex-direction:column;background:var(--card);border-radius:14px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.4);outline:none;color:var(--ink);font-family:var(--sans)}
  .help-h{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:18px 22px;background:var(--green);color:#fff}
  .help-h small{font-family:var(--mono);font-size:10px;letter-spacing:.12em;opacity:.85}
  .help-h h2{margin:4px 0 0;font-size:20px;letter-spacing:-.03em}
  .help-x{width:30px;height:30px;border-radius:8px;color:#fff;font-size:15px;flex:none}
  .help-x:hover{background:rgba(255,255,255,.18)}
  .help-b{padding:20px 22px 22px;overflow-y:auto;display:flex;flex-direction:column;gap:16px}
  .help-s{display:flex;gap:13px}
  .help-s .n{flex:none;width:26px;height:26px;border-radius:50%;background:#dff2e6;color:#165a38;font-weight:700;font-size:13px;display:grid;place-items:center;margin-top:1px}
  .help-s h3{margin:0 0 4px;font-size:14.5px;letter-spacing:-.02em}
  .help-s p{margin:0;font-size:13px;line-height:1.55;color:#34463b}
  .help-s ul{margin:6px 0 0;padding-left:18px;font-size:13px;line-height:1.55;color:#34463b}
  .help-live{background:#eef7f1;border:1px solid #cfe6d8;border-radius:10px;padding:12px 14px;font-size:12.5px;line-height:1.55;color:#1d3b2a}
  .help-note{background:#fff6ea;border:1px solid #f1dcc0;border-radius:10px;padding:11px 14px;font-size:12px;line-height:1.5;color:#4a3a22;margin:0}
  .help-f{padding:12px 22px;border-top:1px solid var(--line);display:flex;justify-content:flex-end}
  .help-f .btn{padding:9px 18px}`;
  document.head.appendChild(css);
}

function helpHTML() {
  const m = S.model, n = D.v.length;
  let live = '<b>Reuniendo datos…</b> el modelo se entrena en cuanto hay registros suficientes.';
  if (m) {
    const mej = (1 - m.mae / m.maeP) * 100;
    live = `Con los <b>${n}</b> registros cargados: <b>${m.rf.trees.length}</b> árboles (profundidad máx. ${m.rf.maxDepth}) · en el 20% de prueba (${m.nTest} registros) el MAE es <b>${fmt(m.mae, 2)}</b> y el RMSE <b>${fmt(m.rmse, 2)}</b>, frente a <b>${fmt(m.maeP, 2)}</b> y <b>${fmt(m.rmseP, 2)}</b> de la persistencia → ` +
      (mej > 1 ? `el modelo reduce el MAE en un <b>${fmt(mej, 1)}%</b>, una mejora pequeña.` : mej >= -1 ? 'rinde casi igual que la línea base.' : 'aquí la línea base es mejor.');
  }
  return `
  <header class="help-h"><div><small>GUÍA RÁPIDA</small><h2 id="helpTitle">¿Cómo funciona ecoai pulse?</h2></div>
    <button class="help-x" type="button" aria-label="Cerrar">✕</button></header>
  <div class="help-b">
    <section class="help-s"><span class="n">1</span><div><h3>¿Qué datos usa?</h3>
      <p>Únicamente los registros <b>reales</b> de PM10 de la estación <b>${D.station}</b> descargados de SISAIRE-IDEAM (archivo <b>${CSV_FILE}</b>, ${n} registros diarios). La página no genera datos simulados. La serie tiene huecos (por ejemplo, no hay registros entre junio de 2023 y febrero de 2025) y se dibuja interrumpida en esos tramos.</p></div></section>

    <section class="help-s"><span class="n">2</span><div><h3>¿Qué es un Random Forest?</h3>
      <p>Un conjunto de ${m ? m.rf.trees.length : 40} <b>árboles de decisión</b>, cada uno entrenado con una muestra distinta de los datos. La predicción final es el <b>promedio</b> de todos; cuando discrepan, la <b>banda sombreada</b> del gráfico se ensancha (≈ 90%, aproximada).</p></div></section>

    <section class="help-s"><span class="n">3</span><div><h3>Pronóstico a ${durTxt(HORIZON * D.step)}</h3>
      <p>El modelo aprende <b>cuánto cambia</b> el PM10 entre un registro y el siguiente a partir del valor actual, los registros anteriores (1, 2 y 5), el promedio de 6 registros y la tendencia reciente. No usa hora del día ni variables meteorológicas. Para mirar más lejos repite la predicción ${HORIZON} veces, y cuanto más lejos, más incierta.</p></div></section>

    <section class="help-s"><span class="n">4</span><div><h3>Validación hold-out (el “examen”)</h3>
      <p>Los registros se ordenan en el tiempo: el <b>80% más antiguo</b> entrena y el <b>20% más reciente</b> se reserva como prueba. Se miden el <b>MAE</b> y el <b>RMSE</b> y se comparan con la <b>persistencia</b> (repetir el último valor). Después el modelo se reentrena con todos los datos para pronosticar.</p></div></section>

    <section class="help-s"><span class="n">5</span><div><h3>Referencias y anomalías</h3>
      <ul>
        <li><b>45 µg/m³</b>: guía OMS 2021 (24 h). <b>75 µg/m³</b>: nivel máximo diario de la Resolución 2254 de 2017.</li>
        <li><b>≥ 80%</b> de 45 → “Cerca de la guía OMS”; <b>≥ 45</b> → “Supera guía OMS”; <b>≥ 75</b> → “Supera Res. 2254”.</li>
        <li><b>Anomalías:</b> en la prueba, se marca con ▲ (positiva) o ▼ (negativa) el registro cuyo residuo estandarizado cumple |z| ≥ ${Z_TH}, es decir, que se aparta por encima o por debajo de lo esperado por el modelo.</li>
      </ul></div></section>

    <div class="help-live">${live}</div>
    <p class="help-note"><b>Límites:</b> una sola estación y un solo contaminante. El 20% de prueba corresponde a un periodo de PM10 bajo, por lo que no mide el desempeño en episodios altos. Las alertas son un apoyo a la interpretación y no reemplazan la evaluación regulatoria de la autoridad ambiental.</p>
  </div>
  <div class="help-f"><button class="btn btn-primary help-ok" type="button">Entendido</button></div>`;
}
let helpEl = null, helpOpener = null;
function openHelp() {
  closeHelp();
  const ov = document.createElement('div'); ov.className = 'help-ov';
  ov.innerHTML = `<div class="help-dlg" role="dialog" aria-modal="true" aria-labelledby="helpTitle" tabindex="-1">${helpHTML()}</div>`;
  document.body.appendChild(ov); helpEl = ov; helpOpener = document.activeElement;
  ov.addEventListener('click', e => { if (e.target === ov) closeHelp(); });
  ov.querySelector('.help-x').addEventListener('click', closeHelp);
  ov.querySelector('.help-ok').addEventListener('click', closeHelp);
  document.body.style.overflow = 'hidden';
  const dlg = ov.querySelector('.help-dlg'); if (dlg && dlg.focus) dlg.focus();
}
function closeHelp() {
  if (!helpEl) return;
  helpEl.remove(); helpEl = null; document.body.style.overflow = '';
  if (helpOpener && helpOpener.focus) helpOpener.focus();
}
function buildHelp() {
  const fab = document.createElement('button'); fab.id = 'helpFab'; fab.type = 'button';
  fab.setAttribute('aria-label', 'Cómo funciona el modelo'); fab.textContent = 'ℹ️ ¿Cómo funciona?';
  fab.addEventListener('click', openHelp); document.body.appendChild(fab);
  const foot = $('#aiFoot');
  if (foot && foot.after) { const b = document.createElement('button'); b.type = 'button'; b.className = 'help-link'; b.textContent = 'ℹ️ ¿Cómo funciona?'; b.addEventListener('click', openHelp); foot.after(b); }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeHelp(); });
}

/* =====================================================================
   EVENTOS E INICIO
   ===================================================================== */
function init() {
  $$('[data-ico]').forEach(el => { el.innerHTML = ico(el.dataset.ico, +el.dataset.size || 18); });
  injectCSS();
  $('#rangeTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.days = +b.dataset.d; renderMeta(); drawChart(); });
  $('#btnRefresh').addEventListener('click', async () => {
    const b = $('#btnRefresh'); b.classList.add('spin'); setTimeout(() => b.classList.remove('spin'), 800);
    await loadDefault(false);
  });
  $('#btnReport').addEventListener('click', downloadReport);
  $('#btnRetry').addEventListener('click', async () => { const b = $('#btnRetry'); b.textContent = 'Reintentando…'; await loadDefault(false); b.textContent = 'Reintentar'; });
  $('#fileCsv').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { try { const d = applyCSV(r.result, f.name); toast(`PM10 de ${d.station}: ${d.v.length} registros cargados`); } catch (err) { toast('El CSV no tiene el formato esperado (Estacion, Fecha inicial, PM10)'); } };
    r.readAsText(f); e.target.value = '';
  });

  // tooltip interactivo del gráfico (serie real, anomalías y pronóstico Random Forest)
  const cv = $('#chart'), tip = $('#chartTip'), hov = document.createElement('div');
  hov.className = 'hov'; hov.hidden = true; cv.parentElement.appendChild(hov);
  cv.addEventListener('mousemove', e => {
    if (!S.chartPts.length) return;
    const x = e.clientX - cv.getBoundingClientRect().left; let b = S.chartPts[0];
    for (const p of S.chartPts) if (Math.abs(p.x - x) < Math.abs(b.x - x)) b = p;
    tip.innerHTML = `<span class="tt">${dateFull(b.t)}${b.fc ? ' · pronóstico RF' : ''}</span><br><b>${fmt(b.v, 2)} µg/m³</b>` +
      (b.fc ? `<br><span class="tt">rango ${fmt(b.lo, 2)} – ${fmt(b.hi, 2)}</span>` : '') +
      (b.an ? `<br><span class="tt">anomalía ${b.an.z > 0 ? 'positiva' : 'negativa'} · z = ${fmt(b.an.z, 2)} · esperado ${fmt(b.an.exp, 2)}</span>` : '');
    tip.style.left = clamp(b.x, 90, cv.clientWidth - 90) + 'px'; tip.style.top = b.y + 'px';
    tip.classList.toggle('below', b.y < 90); tip.hidden = false;
    hov.style.left = b.x + 'px'; hov.style.top = b.y + 'px'; hov.style.borderColor = b.fc ? '#5d6e62' : '#e8795a'; hov.hidden = false;
  });
  cv.addEventListener('mouseleave', () => { tip.hidden = true; hov.hidden = true; });

  buildHelp();
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { drawForest(); drawChart(); }, 120); });
  drawForest(); renderAll();
  loadDefault(true);
}

document.addEventListener('DOMContentLoaded', init);
})();
