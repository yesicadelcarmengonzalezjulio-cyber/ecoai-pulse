/* evaluar_pm10.js · ecoai pulse
 * Reproduce las métricas del artículo e informe: Random Forest vs. persistencia,
 * hold-out cronológico 80/20 y anomalías por residuo estandarizado (|z| >= 2.5).
 * Uso:  node evaluar_pm10.js reporte_sisaire.csv
 * El Random Forest es el mismo de app.js (implementado desde cero, sin librerías).
 * Entrada: CSV de SISAIRE con columnas "Estacion","Fecha inicial","Fecha final","PM10".
 */
const fs=require('fs');
const mean = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const std = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
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


const csv=fs.readFileSync(process.argv[2]||'reporte_sisaire.csv','utf8').trim().split('\n').slice(1).map(l=>{const c=l.replace(/"/g,'').split(',');return {d:c[1],v:+c[3]}});
csv.sort((a,b)=>a.d<b.d?-1:1);
const v=csv.map(r=>r.v), d=csv.map(r=>r.d);
const g=(i,k)=>v[Math.max(0,i-k)];
// Variables de entrada: PM10 actual, rezagos de 1, 2 y 5 registros, media de 6 registros y tendencia (y_t - y_{t-3})
const feat=i=>{let m=0;for(let k=0;k<6;k++)m+=g(i,k);return [g(i,0),g(i,1),g(i,2),g(i,5),m/6,g(i,0)-g(i,3)]};
const X=[],y=[],idx=[];
for(let i=6;i<v.length-1;i++){X.push(feat(i));y.push(v[i+1]-v[i]);idx.push(i+1)}   // el modelo predice el cambio y_{t+1}-y_t
const cut=Math.floor(X.length*.8);
function evaluar(seed){
  const rf=new RandomForest({seed}).fit(X.slice(0,cut),y.slice(0,cut));
  let ae=0,se=0,aeP=0,seP=0;const rows=[];
  for(let i=cut;i<X.length;i++){const e=y[i]-rf.predict(X[i]);ae+=Math.abs(e);se+=e*e;aeP+=Math.abs(y[i]);seP+=y[i]*y[i];
    rows.push({fecha:d[idx[i]],obs:v[idx[i]],esp:v[idx[i]-1]+rf.predict(X[i]),res:e})}
  const m=X.length-cut;return {mae:ae/m,rmse:Math.sqrt(se/m),maeP:aeP/m,rmseP:Math.sqrt(seP/m),rows};
}
const f=(x,n=2)=>x.toFixed(n);
const base=evaluar(11);
console.log(`Registros: ${v.length} | ejemplos: ${X.length} | entrenamiento: ${cut} | prueba: ${X.length-cut} (${d[idx[cut]]} a ${d[idx[X.length-1]]})`);
console.log(`Persistencia: MAE ${f(base.maeP)}  RMSE ${f(base.rmseP)}`);
console.log(`Random Forest (semilla 11): MAE ${f(base.mae)}  RMSE ${f(base.rmse)}`);
const S=[];for(let s=1;s<=10;s++)S.push(evaluar(s));
const sd=a=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1))};
const ma=S.map(r=>r.mae),rm=S.map(r=>r.rmse);
console.log(`Random Forest (semillas 1-10): MAE ${f(mean(ma))} ± ${f(sd(ma))} [${f(Math.min(...ma))}-${f(Math.max(...ma))}]  RMSE ${f(mean(rm))} ± ${f(sd(rm))} [${f(Math.min(...rm))}-${f(Math.max(...rm))}]`);
console.log(`Semillas que superan a la persistencia: MAE ${ma.filter(x=>x<base.maeP).length}/10, RMSE ${rm.filter(x=>x<base.rmseP).length}/10`);
const sig=std(base.rows.map(r=>r.res));
console.log(`\nAnomalías (z = residuo / ${f(sig,3)}, umbral |z| >= 2.5):`);
for(const r of base.rows){const z=r.res/sig;if(Math.abs(z)>=2.5)console.log(`${r.fecha}  observado ${f(r.obs)}  esperado ${f(r.esp)}  z ${f(z)}  ${z>0?'positiva (por encima de lo esperado)':'negativa (por debajo de lo esperado)'}`)}
