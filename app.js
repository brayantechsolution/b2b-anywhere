/* =====================================================================
   CABINE ONLINE — mesa de DJ sincronizada pela internet
   Como a sincronização funciona:
   - Cada deck tem um estado compartilhado (s) com uma "âncora": no horário
     de servidor aT o deck estava na posição aP, tocando com a taxa rate(s).
   - Qualquer comando gera uma nova âncora e é enviado para a sala.
   - Cada computador calcula a posição de todos os decks a partir das âncoras
     e toca a mixagem localmente. Como todos usam o mesmo relógio (o do
     servidor), as faixas ficam alinhadas na batida em qualquer lugar.
   ===================================================================== */
"use strict";
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "x" + Math.random().toString(36).slice(2) + Date.now().toString(36));
function polar(cx, cy, r, deg) { const a = (deg - 90) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
function arc(cx, cy, r, a0, a1) { if (Math.abs(a1 - a0) < 0.6) return ""; const [x0, y0] = polar(cx, cy, r, a0), [x1, y1] = polar(cx, cy, r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${x1.toFixed(2)} ${y1.toFixed(2)}`; }
let toastT; function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600); }
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const colorOf = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 75% 60%)`; };

/* ---------------- knob e fader ---------------- */
function makeKnob({ label, min = -1, max = 1, value = 0, def = value, bipolar = min < 0, size = 40, color = "var(--acc)", onChange }) {
  const el = document.createElement("div"); el.className = "knob";
  const s = size, c = s / 2, r = c - 2.5, rb = c - 7;
  el.innerHTML = `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    <path d="${arc(c, c, r, -135, 135)}" stroke="#23262e" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path class="va" stroke="${color}" stroke-width="3" fill="none" stroke-linecap="round"/>
    <circle cx="${c}" cy="${c}" r="${rb}" fill="url(#kg)" stroke="#000" stroke-width="1"/>
    <line class="ind" x1="${c}" y1="${c - rb + 3}" x2="${c}" y2="${c - rb * 0.35}" stroke="#e5e7eb" stroke-width="2.4" stroke-linecap="round"/>
  </svg>${label ? `<span class="kl">${label}</span>` : ""}`;
  const va = $(".va", el), ind = $(".ind", el); let v = value;
  function render() { const t = (v - min) / (max - min), ang = -135 + t * 270; const a0 = bipolar ? 0 : -135;
    va.setAttribute("d", arc(c, c, r, Math.min(a0, ang), Math.max(a0, ang))); ind.setAttribute("transform", `rotate(${ang} ${c} ${c})`); }
  function set(nv, fire = true) { v = clamp(nv, min, max); if (bipolar && Math.abs(v) < (max - min) * 0.012) v = 0; render(); if (fire && onChange) onChange(v); }
  let sy = 0, sv = 0;
  el.addEventListener("pointerdown", (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); sy = e.clientY; sv = v; });
  el.addEventListener("pointermove", (e) => { if (!el.hasPointerCapture(e.pointerId)) return; const k = e.shiftKey ? 600 : 170; set(sv + (sy - e.clientY) / k * (max - min)); });
  el.addEventListener("dblclick", () => set(def));
  el.addEventListener("wheel", (e) => { e.preventDefault(); set(v - Math.sign(e.deltaY) * (max - min) / 60); }, { passive: false });
  render(); return { el, set, get: () => v, reset: () => set(def) };
}
function makeFader({ orient = "v", length = 160, value = 0, def = value, thick = 40, onChange, ticks = 10, center = false }) {
  const el = document.createElement("div"); el.className = "fader " + orient;
  if (orient === "v") { el.style.height = length + "px"; el.style.width = thick + "px"; } else { el.style.width = length + "px"; el.style.height = thick + "px"; }
  el.innerHTML = '<div class="trk"></div><svg class="ticks"></svg><div class="cap"></div>';
  const cap = $(".cap", el), tk = $(".ticks", el);
  const W = orient === "v" ? thick : length, H = orient === "v" ? length : thick; tk.setAttribute("width", W); tk.setAttribute("height", H); tk.style.left = 0; tk.style.top = 0;
  let lines = ""; for (let i = 0; i <= ticks; i++) { const p = i / ticks; const big = center ? (i === ticks / 2) : (i % 5 === 0);
    if (orient === "v") { const y = 9 + p * (H - 18); lines += `<line x1="${big ? 2 : 5}" x2="10" y1="${y}" y2="${y}" stroke="${big ? "#5a606c" : "#353a45"}"/><line x1="${W - 10}" x2="${W - (big ? 2 : 5)}" y1="${y}" y2="${y}" stroke="${big ? "#5a606c" : "#353a45"}"/>`; }
    else { const x = 11 + p * (W - 22); lines += `<line y1="${big ? 2 : 6}" y2="12" x1="${x}" x2="${x}" stroke="${big ? "#5a606c" : "#353a45"}"/>`; } }
  tk.innerHTML = lines;
  let v = value, dragging = false;
  function render() { if (orient === "v") cap.style.top = ((1 - v) * (length - 18)) + "px"; else cap.style.left = (v * (length - 22)) + "px"; }
  function set(nv, fire = true) { v = clamp(nv, 0, 1); if (center && Math.abs(v - 0.5) < 0.006) v = 0.5; render(); if (fire && onChange) onChange(v); }
  function fromEvent(e) { const r = el.getBoundingClientRect();
    if (orient === "v") { const s = r.height / length; return 1 - ((e.clientY - r.top) / s - 9) / (length - 18); }
    const s = r.width / length; return ((e.clientX - r.left) / s - 11) / (length - 22); }
  let grab = 0;
  el.addEventListener("pointerdown", (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); dragging = true; const f = fromEvent(e); grab = (Math.abs(f - v) < 0.08) ? f - v : 0; set(f - grab); });
  el.addEventListener("pointermove", (e) => { if (el.hasPointerCapture(e.pointerId)) set(fromEvent(e) - grab); });
  const up = () => { dragging = false; }; el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  el.addEventListener("dblclick", () => set(def));
  render(); return { el, set, get: () => v, reset: () => set(def), dragging: () => dragging };
}
function vuEl(n = 16) { const d = document.createElement("div"); d.className = "vu"; for (let i = 0; i < n; i++) { const s = document.createElement("i"); s.dataset.c = i >= n - 2 ? "r" : i >= n - 5 ? "y" : "g"; d.appendChild(s); } return d; }
function setVu(el, level) { const segs = el.children, n = segs.length, lit = Math.round(level * n); for (let i = 0; i < n; i++) { const s = segs[i]; const want = i < lit ? s.dataset.c : ""; if (s.className !== want) s.className = want; } }

/* =====================================================================
   Estado
   ===================================================================== */
const HC = ["#ff3b3b", "#ffb020", "#facc15", "#4ade80", "#22d3c5", "#3b82f6", "#a78bfa", "#f472b6"];
const RANGES = [6, 10, 16, 50];
const blankDeck = () => ({ v: 0, track: null, grid: null, playing: false, aT: 0, aP: 0, tempo: 0, range: 10, bend: 1, cue: 0,
  hot: Array(8).fill(null), loop: { in: null, out: null, active: false }, sync: false, quant: true });
const decks = [1, 2, 3, 4].map((n) => ({ n, s: blankDeck(), buf: null, bufPath: null, peaks: null, ov: null, src: null,
  previewing: false, jogging: false, nudging: false, remain: true, win: 6, ui: {} }));
let glob = { master: null, v: 0 };
let net = null, me = null, R = null;          // rede, usuário, sala atual
let AC = null;
const canCtl = () => !!(R && R.role === "dj");

/* =====================================================================
   Relógio compartilhado
   ===================================================================== */
let off = 0, K = null, rtt = null;
const epochNow = () => performance.timeOrigin + performance.now();
const nowS = () => epochNow() + off;                     // horário do servidor (ms)
async function measureOffset() {
  let best = null;
  for (let i = 0; i < 7; i++) { try { const s = await net.timeSample(); if (!best || s.rtt < best.rtt) best = s; } catch (e) { break; } }
  if (!best) return false;
  rtt = best.rtt;
  if (Math.abs(best.off - off) > 15 || K == null) { off = best.off; checkK(true); }
  updateConn();
  return true;
}
function sampleK() {
  if (!AC || AC.state !== "running") return null;
  const ts = AC.getOutputTimestamp ? AC.getOutputTimestamp() : null;
  if (ts && ts.performanceTime > 0 && ts.contextTime > 0) return (performance.timeOrigin + ts.performanceTime + off) / 1000 - ts.contextTime;
  return nowS() / 1000 - AC.currentTime;
}
function checkK(force) {
  const k = sampleK(); if (k == null) return;
  if (K == null || force || Math.abs(k - K) > 0.012) { K = k; const w = AC.currentTime + 0.05; decks.forEach((d) => renderAudio(d, w)); }
}
setInterval(() => checkK(false), 4000);
setInterval(() => { if (R) measureOffset(); }, 60000);

/* =====================================================================
   Áudio
   ===================================================================== */
function audio() {
  if (AC) return AC;
  AC = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
  mixerGraph(AC);
  AC.onstatechange = () => { if (AC.state === "running") checkK(true); };
  return AC;
}
function fxBpm() {
  const m = glob.master && decks[glob.master - 1].s.grid ? decks[glob.master - 1] : decks.find((d) => d.s.playing && d.s.grid);
  return m ? effBpm(m) : 120;
}

/* =====================================================================
   Análise de BPM e grid (worker)
   ===================================================================== */
const WORKER_SRC = `
onmessage=function(e){
  var x=e.data.x,sr=e.data.sr,id=e.data.id,n=x.length;
  var a=Math.exp(-2*Math.PI*150/sr),y1=0,y2=0,lp=new Float32Array(n),i,f,k;
  for(i=0;i<n;i++){y1=(1-a)*x[i]+a*y1;y2=(1-a)*y1+a*y2;lp[i]=y2;}
  var hop=Math.max(8,Math.round(sr/230)),win=hop*2,nf=Math.floor((n-win)/hop);
  if(nf<400){postMessage({id:id,fail:true});return;}
  var fps=sr/hop,TOFF=(win-hop/2)/sr,cL=new Float32Array(nf),cF=new Float32Array(nf);
  for(f=0;f<nf;f++){var s=f*hop,sl=0,sf=0;for(k=s;k<s+win;k++){sl+=lp[k]*lp[k];sf+=x[k]*x[k];}cL[f]=Math.log(1+1e4*sl/win);cF[f]=Math.log(1+1e3*sf/win);}
  var dL=new Float32Array(nf),dF=new Float32Array(nf),mL=0,mF=0;
  for(f=1;f<nf;f++){dL[f]=Math.max(0,cL[f]-cL[f-1]);dF[f]=Math.max(0,cF[f]-cF[f-1]);mL+=dL[f];mF+=dF[f];}
  mL=mL/nf||1;mF=mF/nf||1;
  var env=new Float32Array(nf);for(f=0;f<nf;f++)env[f]=dL[f]/mL+0.5*dF[f]/mF;
  var W=Math.round(fps*0.25),cs=new Float64Array(nf+1);for(f=0;f<nf;f++)cs[f+1]=cs[f]+env[f];
  var on=new Float32Array(nf);for(f=0;f<nf;f++){var lo=Math.max(0,f-W),hi=Math.min(nf,f+W+1);on[f]=Math.max(0,env[f]-(cs[hi]-cs[lo])/(hi-lo));}
  function fold(bpm,NB,from,to){var P=fps*60/bpm,h=new Float64Array(NB),inv=1/P,ph=(from*inv)%1;for(var f=from;f<to;f++){h[(ph*NB)|0]+=on[f];ph+=inv;if(ph>=1)ph-=1;}return h;}
  function score(h){var NB=h.length,best=0,sum=0;for(var b=0;b<NB;b++){sum+=h[b];var v=h[b]+0.5*(h[(b+1)%NB]+h[(b-1+NB)%NB]);if(v>best)best=v;}return best/(sum/NB*2+1e-9);}
  var seg=Math.min(nf,Math.round(fps*120)),st=Math.max(0,Math.floor((nf-seg)/2)),bestB=120,bestS=-1,bpm,r;
  for(bpm=75;bpm<=180;bpm+=0.05){r=score(fold(bpm,48,st,st+seg));if(r>bestS){bestS=r;bestB=bpm;}}
  var b2=bestB,s2=-1;
  for(bpm=bestB-0.12;bpm<=bestB+0.12;bpm+=0.002){r=score(fold(bpm,96,0,nf));if(r>s2){s2=r;b2=bpm;}}
  if(Math.abs(b2-Math.round(b2))<0.03)b2=Math.round(b2);
  var NB=240,h=fold(b2,NB,0,nf),sm=new Float64Array(NB),b,j;
  for(b=0;b<NB;b++){var acc=0;for(j=-3;j<=3;j++)acc+=h[(b+j+NB)%NB]*(4-Math.abs(j));sm[b]=acc;}
  var pb=0;for(b=1;b<NB;b++)if(sm[b]>sm[pb])pb=b;
  var L=sm[(pb-1+NB)%NB],C=sm[pb],R=sm[(pb+1)%NB],den=L-2*C+R,off=den!==0?0.5*(L-R)/den:0;
  var phase=((pb+0.5+off)/NB+1)%1,P=fps*60/b2,Ps=60/b2;
  var t0=phase*P/fps+TOFF,best4=-1,k4=0;
  for(var q=0;q<4;q++){var tot=0;for(var t=t0+q*Ps;(t-TOFF)*fps<nf;t+=4*Ps){var fi=Math.round((t-TOFF)*fps);for(var dd=-2;dd<=2;dd++){var ii=fi+dd;if(ii>=0&&ii<nf)tot+=on[ii];}}if(tot>best4){best4=tot;k4=q;}}
  var mx=0;for(f=0;f<nf;f++)if(on[f]>mx)mx=on[f];
  var ff=-1;for(f=0;f<nf;f++)if(on[f]>=0.35*mx){ff=f;break;}
  if(ff>=0){var tF=ff/fps+TOFF,qb=Math.round((tF-t0)/Ps);if(Math.abs(tF-(t0+qb*Ps))<0.25*Ps){k4=((qb%4)+4)%4;}}
  t0=t0+k4*Ps;t0=t0-Math.floor(t0/(4*Ps))*4*Ps;
  postMessage({id:id,bpm:b2,t0:t0});
};`;
let worker = null, wid = 0; const wjobs = {};
try { worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" })));
  worker.onmessage = (e) => { const j = wjobs[e.data.id]; if (j) { delete wjobs[e.data.id]; j(e.data); } }; } catch (e) { worker = null; }
function analyze(buf) { return new Promise((res) => {
  if (!worker) { res({ fail: true }); return; }
  const q = Math.max(1, Math.round(buf.sampleRate / 11025)), L = buf.getChannelData(0), Rr = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L, n = Math.floor(L.length / q), x = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; const o = i * q; for (let k = 0; k < q; k++) s += L[o + k] + Rr[o + k]; x[i] = s / (2 * q); }
  const id = ++wid; wjobs[id] = res; worker.postMessage({ id, x, sr: buf.sampleRate / q }, [x.buffer]); }); }

/* =====================================================================
   Modelo do deck (posição calculada pelas âncoras)
   ===================================================================== */
const baseRate = (s) => 1 + s.tempo * s.range / 100;
const rateOf = (s) => baseRate(s) * s.bend;
const trackDur = (d) => (d.s.track ? d.s.track.dur : 0);
const spb = (d) => 60 / d.s.grid.bpm;
const beatAt = (d, p) => (p - d.s.grid.t0) / spb(d);
const timeOfBeat = (d, b) => d.s.grid.t0 + b * spb(d);
const effBpm = (d) => (d.s.grid ? d.s.grid.bpm * baseRate(d.s) : 0);
function posAt(d, tMs) {
  const s = d.s; if (!s.track) return 0; const dur = s.track.dur;
  if (!s.playing || tMs <= s.aT) return Math.min(s.aP, dur);
  let p = s.aP + (tMs - s.aT) / 1000 * rateOf(s);
  const L = s.loop;
  if (L.active && L.out != null && L.in != null && s.aP <= L.out + 1e-6 && p > L.out) { const len = L.out - L.in; if (len > 0) p = L.in + ((p - L.in) % len); }
  return Math.min(p, dur);
}
const pos = (d) => posAt(d, nowS());
function quant(d, p) { if (!d.s.quant || !d.s.grid) return p; return timeOfBeat(d, Math.round(beatAt(d, p))); }
function refFor(d) {
  const m = glob.master ? decks[glob.master - 1] : null;
  if (m && m !== d && m.s.grid) return m;
  return decks.find((x) => x !== d && x.s.grid && x.s.playing && !x.s.sync) || decks.find((x) => x !== d && x.s.grid && x.s.playing) || null;
}
function stopSource(d, when) { if (d.src) { const s = d.src; d.src = null; try { s.stop(when || 0); } catch (e) { /* já parado */ } } }
function renderAudio(d, when) {
  if (!AC) return;
  if (K == null) { const k = sampleK(); if (k == null) return; K = k; }
  when = when == null ? AC.currentTime + 0.03 : Math.max(when, AC.currentTime);
  stopSource(d, when);
  const s = d.s; if (!d.buf || !s.playing || !s.track || d.bufPath !== s.track.path) return;
  const startAc = Math.max(when, s.aT / 1000 - K);
  const p = posAt(d, (startAc + K) * 1000);
  if (p >= d.buf.duration - 0.003) return;
  const src = AC.createBufferSource(); src.buffer = d.buf; src.playbackRate.value = rateOf(s);
  const L = s.loop; if (L.active && L.in != null && L.out != null && p <= L.out) { src.loop = true; src.loopStart = L.in; src.loopEnd = L.out; }
  src.connect(G.ch[d.n - 1].input); src.start(startAc, p); d.src = src;
}

/* =====================================================================
   Comandos (geram nova âncora, tocam localmente e vão para a sala)
   ===================================================================== */
function commit(d, mut, o = {}) {
  if (!canCtl()) return false;
  const t = o.at != null ? o.at : nowS() + (o.lead || 0) * 1000;
  const s = d.s, p = posAt(d, t);
  const np = mut(s, p, t);
  s.aT = t; s.aP = clamp(np == null ? p : np, 0, Math.max(0, trackDur(d))); s.v = nowS();
  renderAudio(d); refreshDeck(d); queueDeck(d);
  if (o.follow !== false) followUp(d, t);
  return true;
}
function setTempoForSync(f, m) {
  const t = (effBpm(m) / f.s.grid.bpm - 1) * 100; let r = f.s.range;
  if (Math.abs(t) > r) r = RANGES.find((x) => x >= Math.abs(t)) || 50;
  f.s.range = r; f.s.tempo = clamp(t / r, -1, 1);
}
function alignedPos(d, m, at, mod, t) {
  const bm = beatAt(m, posAt(m, t)), bd = beatAt(d, at);
  let diff = ((bm - bd) % mod + mod) % mod; if (diff > mod / 2) diff -= mod;
  let np = timeOfBeat(d, bd + diff); if (np < 0) np += mod * spb(d);
  return np;
}
function followUp(d, t) {
  decks.forEach((f) => {
    if (f === d || !f.s.sync || !f.s.grid || !d.s.grid || refFor(f) !== d) return;
    commit(f, (fs, fp) => { setTempoForSync(f, d); if (fs.playing && d.s.playing && d.s.bend === 1 && !d.jogging) return alignedPos(f, d, fp, 1, t); }, { at: t, follow: false });
  });
}
function setMaster(n) {
  if (!canCtl()) return;
  glob = { master: n, v: nowS() };
  if (n && decks[n - 1].s.sync) commit(decks[n - 1], (s) => { s.sync = false; });
  send("glob", glob); saveSoon(); decks.forEach(refreshDeck);
}
function autoMaster(d) { if (!glob.master && d.s.grid && !d.s.sync) setMaster(d.n); }
function togglePlay(d) {
  if (!canCtl() || !d.s.track) return;
  if (d.s.playing) { commit(d, (s) => { s.playing = false; s.bend = 1; }); return; }
  d.previewing = false; const m = refFor(d);
  commit(d, (s, p, t) => { let at = p >= trackDur(d) - 0.05 ? 0 : p; s.playing = true; s.bend = 1;
    if (s.sync && m && m.s.playing && s.grid && m.s.grid) { setTempoForSync(d, m); at = alignedPos(d, m, at, 1, t); } return at; }, { lead: 0.03 });
  autoMaster(d);
}
function cueDown(d) {
  if (!canCtl() || !d.s.track) return;
  if (d.s.playing && !d.previewing) { commit(d, (s) => { s.playing = false; s.bend = 1; return s.cue; }); return; }
  if (!d.s.playing) { commit(d, (s, p) => { if (Math.abs(p - s.cue) > 0.01) s.cue = quant(d, p); s.playing = true; return s.cue; }, { lead: 0.02 }); d.previewing = true; }
}
function cueUp(d) { if (d.previewing) { d.previewing = false; commit(d, (s) => { s.playing = false; return s.cue; }); } }
function hotCue(d, i, shift) {
  if (!canCtl() || !d.s.track) return;
  if (shift) { commit(d, (s) => { s.hot[i] = null; }); return; }
  if (d.s.hot[i] == null) { commit(d, (s, p) => { s.hot[i] = quant(d, p); }); return; }
  d.previewing = false; const m = refFor(d);
  commit(d, (s, p, t) => { let at = s.hot[i]; s.playing = true; s.bend = 1; if (s.loop.active && (at < s.loop.in || at > s.loop.out)) s.loop.active = false;
    if (s.sync && m && m.s.playing && s.grid && m.s.grid) at = alignedPos(d, m, at, 1, t); return at; }, { lead: 0.02 });
  autoMaster(d);
}
function loopIn(d) { commit(d, (s, p) => { s.loop = { in: quant(d, p), out: null, active: false }; return p; }); }
function loopOut(d) { if (d.s.loop.in == null) return; commit(d, (s, p) => { const q = quant(d, p); if (q <= s.loop.in + 0.03) return; s.loop.out = q; s.loop.active = true; if (p > q || p < s.loop.in) return s.loop.in; return p; }); }
function reloop(d) { commit(d, (s, p) => { if (s.loop.active) { s.loop.active = false; return p; } if (s.loop.in != null && s.loop.out != null) { s.loop.active = true; return s.loop.in; } }); }
function loopScale(d, f) { if (d.s.loop.in == null || d.s.loop.out == null) return;
  commit(d, (s, p) => { const L = (s.loop.out - s.loop.in) * f; if (L < 0.02) return; s.loop.out = Math.min(trackDur(d), s.loop.in + L); if (s.loop.active && p > s.loop.out) return s.loop.in; }); }
function beatLoop(d) { if (!d.s.track) return; if (!d.s.grid) { toast("Aguarde a análise do BPM"); return; }
  commit(d, (s, p) => { const b = Math.floor(beatAt(d, p) + 0.02); s.loop = { in: Math.max(0, timeOfBeat(d, b)), out: Math.min(trackDur(d), timeOfBeat(d, b + 4)), active: true }; return p; }); }
function beatJump(d, dir) { if (!d.s.track || !d.s.grid) return; commit(d, (s, p) => { s.loop.active = false; return clamp(p + dir * 4 * spb(d), 0, trackDur(d)); }); }
function seekTo(d, t) { if (!d.s.track) return; commit(d, (s) => { if (s.loop.active && (t < s.loop.in || t > s.loop.out)) s.loop.active = false; return t; }); }
function syncPress(d) {
  if (!canCtl()) return; const s = d.s;
  if (s.sync) { commit(d, (s) => { s.sync = false; }); return; }
  if (!s.track) return;
  if (!s.grid) { toast(d.analyzing ? "Ainda analisando o BPM…" : "Esta faixa não tem BPM detectado"); return; }
  if (glob.master === d.n) { toast("Este deck é o MASTER. Aperte SYNC no outro deck."); return; }
  const m = refFor(d); if (!m) { toast("Nenhum deck de referência: toque outra faixa primeiro"); return; }
  if (!glob.master) setMaster(m.n);
  commit(d, (s, p, t) => { s.sync = true; s.bend = 1; setTempoForSync(d, m); if (s.playing && m.s.playing) return alignedPos(d, m, p, 4, t); });
}
function nudge(d, dir, fine) {
  if (!canCtl() || !d.s.track) return;
  if (dir === 0) { d.nudging = false; commit(d, (s) => { s.bend = 1; }); return; }
  d.nudging = true; commit(d, (s) => { s.sync = false; s.bend = 1 + dir * (fine ? 0.008 : 0.035); });
}

/* =====================================================================
   Rede: envio com limite de frequência, estado salvo e mensagens
   ===================================================================== */
const sendTimers = {}, sendLast = {};
function throttle(key, fn, ms) {
  const now = performance.now(), last = sendLast[key] || 0;
  if (now - last >= ms) { sendLast[key] = now; fn(); }
  else if (!sendTimers[key]) sendTimers[key] = setTimeout(() => { sendTimers[key] = null; sendLast[key] = performance.now(); fn(); }, ms - (now - last));
}
function send(t, d) { if (R && R.chan) { try { R.chan.send(t, d); } catch (e) { console.warn(e); } } }
function queueDeck(d) { throttle("deck" + d.n, () => send("deck", { n: d.n, s: d.s }), 50); saveSoon(); }
let saveT = null;
function snapshot() { return { decks: decks.map((d) => d.s), M: { ...M }, glob, savedAt: Date.now() }; }
function saveSoon() { if (!canCtl()) return; clearTimeout(saveT); saveT = setTimeout(saveNow, 1200); }
function saveNow() { clearTimeout(saveT); if (!R || !canCtl()) return; const id = R.id; net.saveState(id, snapshot()).catch((e) => console.warn("save", e)); }
const peerRole = {};
function onMsg(t, d, u) {
  if (!R || !d) return;
  const ctl = t === "deck" || t === "mix" || t === "glob";
  if (ctl && peerRole[u] === "spectator") return;
  if (t === "deck") onRemoteDeck(d);
  else if (t === "mix") setMixRemote(d.k, d.v);
  else if (t === "glob") { if ((d.v || 0) > (glob.v || 0)) { glob = d; decks.forEach(refreshDeck); } }
  else if (t === "hello") { if (canCtl()) { clearTimeout(snapT); snapT = setTimeout(() => send("snap", snapshot()), 120 + Math.random() * 400); } }
  else if (t === "snap") { clearTimeout(snapT); applyState(d); }
  else if (t === "chat") addChat(d);
}
let snapT = null;
function onRemoteDeck({ n, s }) {
  const d = decks[n - 1]; if (!d || !s) return;
  if ((s.v || 0) <= (d.s.v || 0)) return;
  if (!Array.isArray(s.hot)) s.hot = Array(8).fill(null);
  if (!s.loop) s.loop = { in: null, out: null, active: false };
  const oldPath = d.s.track && d.s.track.path;
  d.s = s;
  if ((s.track && s.track.path) !== oldPath) ensureBuffer(d); else renderAudio(d);
  refreshDeck(d);
}
function applyState(st) {
  if (!st || typeof st !== "object") return;
  if (st.M) for (const k in st.M) if (k in M_DEFAULT) setMixRemote(k, st.M[k]);
  if (st.glob && (st.glob.v || 0) > (glob.v || 0)) glob = st.glob;
  if (Array.isArray(st.decks)) st.decks.forEach((s, i) => { if (s && decks[i]) onRemoteDeck({ n: i + 1, s }); });
  decks.forEach(refreshDeck);
}

/* ---------- mixer compartilhado ---------- */
function setMix(k, v) { if (!canCtl()) return; M[k] = v; applyKey(k); throttle("mix:" + k, () => send("mix", { k, v: M[k] }), 50); saveSoon(); }
function setMixRemote(k, v) { if (!(k in M_DEFAULT)) return; M[k] = v; applyKey(k); if (ctl[k]) ctl[k].set(v, false); if (segUi[k]) segUi[k](v); }

/* =====================================================================
   Músicas: enviar (DJ) e baixar (todos)
   ===================================================================== */
const ZRES = 200, OVW = 400;
const bufCache = new Map(), peakCache = new Map();
function setBusy(d, txt) { const b = d.ui.busy; b.textContent = txt; b.classList.toggle("show", !!txt); }
function setBuffer(d, buf, path) {
  d.buf = buf; d.bufPath = path;
  let pk = peakCache.get(path);
  if (!pk) {
    const L = buf.getChannelData(0), Rr = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    const nb = Math.ceil(buf.duration * ZRES), per = buf.sampleRate / ZRES, peaks = new Float32Array(nb);
    for (let b = 0; b < nb; b++) { let m = 0; const s0 = Math.floor(b * per), s1 = Math.min(L.length, Math.floor((b + 1) * per));
      for (let s = s0; s < s1; s += 2) { const v = Math.abs(L[s] + Rr[s]) * 0.5; if (v > m) m = v; } peaks[b] = m; }
    let mx = 0; for (const v of peaks) if (v > mx) mx = v; if (mx > 0) for (let i = 0; i < nb; i++) peaks[i] /= mx;
    const ov = new Float32Array(OVW), g = nb / OVW; for (let i = 0; i < OVW; i++) { let m = 0; for (let b = Math.floor(i * g); b < Math.floor((i + 1) * g); b++) if (peaks[b] > m) m = peaks[b]; ov[i] = m; }
    pk = { peaks, ov }; peakCache.set(path, pk);
  }
  d.peaks = pk.peaks; d.ov = pk.ov; d.ui.el.classList.add("loaded");
}
function pruneCache() { const used = new Set(decks.map((d) => d.s.track && d.s.track.path).filter(Boolean)); for (const k of [...bufCache.keys()]) if (!used.has(k)) { bufCache.delete(k); peakCache.delete(k); } }
async function ensureBuffer(d) {
  const path = d.s.track && d.s.track.path;
  if (!path) { stopSource(d); d.buf = null; d.bufPath = null; d.peaks = null; d.ov = null; d.ui.el.classList.remove("loaded"); setBusy(d, ""); refreshDeck(d); return; }
  if (d.bufPath === path && d.buf) { renderAudio(d); return; }
  stopSource(d); d.buf = null; d.bufPath = null; d.peaks = null; d.ui.el.classList.add("loaded"); setBusy(d, "BAIXANDO MÚSICA…");
  try {
    let buf = bufCache.get(path);
    if (!buf) { const blob = await net.download(path); audio(); buf = await AC.decodeAudioData(await blob.arrayBuffer()); bufCache.set(path, buf); }
    if (!d.s.track || d.s.track.path !== path) return;
    setBuffer(d, buf, path); setBusy(d, ""); renderAudio(d); refreshDeck(d);
  } catch (e) { if (d.s.track && d.s.track.path === path) setBusy(d, "ERRO AO BAIXAR · RECARREGUE"); toast(e.message || "Falha ao baixar a música"); console.error(e); }
  pruneCache();
}
async function loadLocalFile(d, file) {
  if (!canCtl()) { toast("Espectadores não podem carregar músicas"); return; }
  if (file.size > 50 * 1024 * 1024) { toast("Arquivo maior que 50 MB"); return; }
  audio(); setBusy(d, "PREPARANDO…");
  try {
    const buf = await AC.decodeAudioData(await file.arrayBuffer());
    const ext = ((file.name.split(".").pop() || "mp3").toLowerCase().replace(/[^a-z0-9]/g, "")) || "mp3";
    const path = R.id + "/" + uuid() + "." + ext;
    setBusy(d, "ENVIANDO PARA A SALA…");
    d.analyzing = true;
    const [res] = await Promise.all([analyze(buf), net.upload(path, file)]);
    d.analyzing = false;
    const grid = res && !res.fail ? { bpm: res.bpm, t0: res.t0 } : null;
    bufCache.set(path, buf); setBuffer(d, buf, path);
    commit(d, (s) => { s.track = { path, name: file.name.replace(/\.[^.]+$/, "").slice(0, 120), dur: buf.duration }; s.grid = grid; s.playing = false; s.cue = 0;
      s.hot = Array(8).fill(null); s.loop = { in: null, out: null, active: false }; s.sync = false; s.bend = 1; return 0; });
    setBusy(d, ""); pruneCache();
    if (!grid) toast("Não foi possível detectar o BPM de " + file.name);
  } catch (e) { d.analyzing = false; setBusy(d, ""); toast(e.message || "Não foi possível carregar o arquivo"); console.error(e); }
}

/* =====================================================================
   Interface do deck
   ===================================================================== */
const ICON_UP = '<svg viewBox="0 0 24 24"><path d="M12 5l7 9h-4v5H9v-5H5z"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M4 4l9 8-9 8zM15 5h3v14h-3zM20 5h2v14h-2z"/></svg>';
function buildDeck(d) {
  const el = document.createElement("section"); el.className = "deck"; el.dataset.d = d.n;
  el.innerHTML = `
  <div class="screen">
    <div class="s-head"><span class="pnum">${d.n}</span>
      <div class="s-title"><b class="ttl">Sem faixa</b><span class="sub">--:-- · --- BPM</span></div>
      <div class="s-btns"><button data-g="l" title="Mover o grid para trás (Shift: fino)">GRID<br>◀</button><button data-g="r" title="Mover o grid para frente (Shift: fino)">GRID<br>▶</button><button data-g="h" title="Dividir o BPM por 2">BPM<br>÷2</button><button data-g="d" title="Multiplicar o BPM por 2">BPM<br>×2</button><button data-g="b" title="Mudar qual batida é o início do compasso">BAR<br>1▸</button><button class="ej" title="Carregar faixa">⏏<br>LOAD</button></div>
    </div>
    <div class="busy"></div>
    <canvas class="wz" width="800" height="252"></canvas>
    <canvas class="ph" width="800" height="28"></canvas>
    <div class="s-info">
      <div class="ib pl"><span>PLAYER</span><b>${d.n}</b><i class="qz on">QUANTIZE</i></div>
      <div class="ib tm"><span><em class="tl">REMAIN</em> · <span class="tl2">TIME</span></span><b class="time">00:00<small>.000</small></b></div>
      <div class="ib tp"><span>TEMPO<em class="rng">±10</em></span><b class="tpct">+0.00%</b></div>
      <div class="ib bp"><span class="badges"><em class="m">MASTER</em><em class="s">SYNC</em></span><b class="bpm">---.-</b><span class="bpm0">BPM</span></div>
    </div>
    <canvas class="wo" width="800" height="68"></canvas>
    <div class="empty"><div class="ring">${ICON_UP}</div><b>TOQUE PARA CARREGAR</b><span>ou arraste um arquivo de áudio (mp3, wav, m4a…)</span></div>
    <input type="file" accept="audio/*" hidden>
  </div>
  <div class="hot">${"ABCDEFGH".split("").map((l, i) => `<button class="pad" style="--c:${HC[i]}" data-i="${i}" title="Hot cue ${l} (Shift+clique apaga)">${l}</button>`).join("")}</div>
  <div class="loops"><button class="sbtn" data-a="in">IN</button><button class="sbtn" data-a="out">OUT</button><button class="sbtn" data-a="re">RELOOP/EXIT</button><button class="sbtn" data-a="b4">4 BEAT</button><button class="sbtn" data-a="half">½X</button><button class="sbtn" data-a="dbl">2X</button></div>
  <div class="body">
    <div class="lcol"><button class="sq qbtn on">QUANTIZE</button><span class="lbl">BEAT JUMP</span>
      <div class="row2"><button class="sq bj" data-j="-1">◀</button><button class="sq bj" data-j="1">▶</button></div><div class="grow"></div>
      <button class="round cue">CUE</button><button class="round play">${ICON_PLAY}</button></div>
    <div class="ccol">
      <div class="jog"><div class="led"></div><div class="plat"></div><div class="rot"></div><div class="hub"><div><b class="hpos">0:00</b>de <span class="hdur">0:00</span></div></div></div>
      <span class="nlab l">NUDGE</span><span class="nlab r">NUDGE</span>
      <button class="nudge minus" title="Segure para atrasar (Shift: suave)">−</button><button class="nudge plus" title="Segure para adiantar (Shift: suave)">+</button>
      <div class="dlabel">DECK ${d.n} <span>(CH ${d.n})</span></div>
    </div>
    <div class="dr"><button class="sq mst">MASTER</button><button class="sq syn">SYNC</button><span class="lbl">TEMPO −</span><div class="tslot"></div><span class="lbl">+</span>
      <button class="mini rbtn">±10%</button><button class="mini treset">RESET</button></div>
  </div>`;
  const u = d.ui; u.el = el; u.ttl = $(".ttl", el); u.sub = $(".sub", el); u.wz = $(".wz", el); u.ph = $(".ph", el); u.wo = $(".wo", el); u.busy = $(".busy", el);
  u.time = $(".time", el); u.tl = $(".tl", el); u.tl2 = $(".tl2", el); u.tpct = $(".tpct", el); u.rng = $(".rng", el); u.bpm = $(".bpm", el); u.bpm0 = $(".bpm0", el);
  u.bm = $(".badges .m", el); u.bs = $(".badges .s", el); u.qz = $(".qz", el); u.qbtn = $(".qbtn", el); u.mst = $(".mst", el); u.syn = $(".syn", el); u.rbtn = $(".rbtn", el);
  u.jog = $(".jog", el); u.rot = $(".rot", el); u.hpos = $(".hpos", el); u.hdur = $(".hdur", el); u.cue = $(".cue", el); u.play = $(".play", el); u.pads = $$(".pad", el); u.loops = $$(".sbtn", el);
  const fi = $("input[type=file]", el);
  const pick = () => { if (!canCtl()) return; audio(); fi.click(); };
  $(".empty", el).onclick = pick; $(".ej", el).onclick = pick;
  fi.onchange = () => { if (fi.files[0]) loadLocalFile(d, fi.files[0]); fi.value = ""; };
  el.addEventListener("dragover", (e) => { e.preventDefault(); if (canCtl()) el.classList.add("drag"); });
  el.addEventListener("dragleave", (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove("drag"); });
  el.addEventListener("drop", (e) => { e.preventDefault(); el.classList.remove("drag"); const f = [...e.dataTransfer.files].find((f) => f.type.startsWith("audio") || /\.(mp3|wav|ogg|m4a|aac|flac|opus|aiff?)$/i.test(f.name)); if (f) loadLocalFile(d, f); });
  u.play.onclick = () => togglePlay(d);
  u.cue.addEventListener("pointerdown", (e) => { e.preventDefault(); u.cue.setPointerCapture(e.pointerId); cueDown(d); });
  u.cue.addEventListener("pointerup", () => cueUp(d));
  u.pads.forEach((p) => p.onclick = (e) => hotCue(d, +p.dataset.i, e.shiftKey));
  u.loops.forEach((b) => b.onclick = () => ({ in: loopIn, out: loopOut, re: reloop, b4: beatLoop, half: (x) => loopScale(x, 0.5), dbl: (x) => loopScale(x, 2) })[b.dataset.a](d));
  $$(".bj", el).forEach((b) => b.onclick = () => beatJump(d, +b.dataset.j));
  u.qbtn.onclick = () => commit(d, (s) => { s.quant = !s.quant; });
  u.mst.onclick = () => { if (!d.s.grid) { toast("Carregue uma faixa com BPM detectado"); return; } setMaster(glob.master === d.n ? null : d.n); };
  u.syn.onclick = () => syncPress(d);
  $(".tm", el).onclick = () => { d.remain = !d.remain; refreshDeck(d); };
  $$("[data-g]", el).forEach((b) => b.onclick = (e) => { if (!d.s.grid) return;
    commit(d, (s) => { const g = { ...s.grid }, P = 60 / g.bpm;
      if (b.dataset.g === "l") g.t0 -= e.shiftKey ? 0.001 : 0.005; else if (b.dataset.g === "r") g.t0 += e.shiftKey ? 0.001 : 0.005;
      else if (b.dataset.g === "b") g.t0 += P; else if (b.dataset.g === "h") g.bpm /= 2; else if (b.dataset.g === "d") g.bpm *= 2;
      const P2 = 60 / g.bpm; g.t0 = ((g.t0 % (4 * P2)) + 4 * P2) % (4 * P2); s.grid = g; }); });
  u.wz.addEventListener("wheel", (e) => { e.preventDefault(); d.win = clamp(d.win * (e.deltaY > 0 ? 1.2 : 1 / 1.2), 2, 24); }, { passive: false });
  u.wo.addEventListener("pointerdown", (e) => { if (!d.s.track) return; const r = u.wo.getBoundingClientRect(); seekTo(d, (e.clientX - r.left) / r.width * trackDur(d)); });
  const tf = makeFader({ orient: "v", length: 206, value: 0.5, center: true, ticks: 16, onChange: (v) => commit(d, (s) => { s.sync = false; s.tempo = (v - 0.5) * 2; }) });
  $(".tslot", el).appendChild(tf.el); u.tempoF = tf;
  u.rbtn.onclick = () => commit(d, (s) => { const t = s.tempo * s.range; s.range = RANGES[(RANGES.indexOf(s.range) + 1) % RANGES.length];
    if (Math.abs(t) > s.range) s.range = RANGES.find((x) => x >= Math.abs(t)) || 50; s.tempo = t / s.range; });
  $(".treset", el).onclick = () => tf.set(0.5);
  $$(".nudge", el).forEach((b) => { const dir = b.classList.contains("plus") ? 1 : -1;
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add("held"); nudge(d, dir, e.shiftKey); });
    const up = () => { if (!b.classList.contains("held")) return; b.classList.remove("held"); nudge(d, 0); }; b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); });
  let lastA = 0, lastT = 0;
  const ang = (e) => { const r = u.jog.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)); };
  u.jog.addEventListener("pointerdown", (e) => { if (!d.s.track || !canCtl()) return; e.preventDefault(); u.jog.setPointerCapture(e.pointerId); d.jogging = true; lastA = ang(e); lastT = performance.now(); u.jog.classList.add("touch");
    if (d.s.sync && d.s.playing) commit(d, (s) => { s.sync = false; }); });
  u.jog.addEventListener("pointermove", (e) => { if (!d.jogging) return; const a = ang(e), t = performance.now(); let da = a - lastA; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
    const dt = Math.max(1, t - lastT) / 1000; lastA = a; lastT = t;
    if (d.s.playing) { const b = 1 + clamp(da / dt * 0.05, -0.5, 0.5); commit(d, (s) => { s.bend = b; }, { follow: false }); }
    else commit(d, (s, p) => { const np = clamp(p + da * 1.8 / (2 * Math.PI), 0, trackDur(d)); if (s.loop.active && (np < s.loop.in || np > s.loop.out)) s.loop.active = false; return np; }, { follow: false }); });
  const end = () => { if (!d.jogging) return; d.jogging = false; u.jog.classList.remove("touch"); commit(d, (s) => { s.bend = 1; }); };
  u.jog.addEventListener("pointerup", end); u.jog.addEventListener("pointercancel", end);
  return el;
}

/* =====================================================================
   Desenho
   ===================================================================== */
const fmt = (t, dec = true) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return String(m).padStart(2, "0") + ":" + (dec ? s.toFixed(1).padStart(4, "0") : String(Math.floor(s)).padStart(2, "0")); };
function refreshDeck(d) {
  const u = d.ui, s = d.s; if (!u.el) return;
  u.ttl.textContent = s.track ? s.track.name : "Sem faixa";
  u.sub.textContent = s.track ? (fmt(s.track.dur, false) + " · " + (s.grid ? s.grid.bpm.toFixed(2) + " BPM" : d.analyzing ? "analisando BPM…" : "BPM ?")) : "--:-- · --- BPM";
  const t = s.tempo * s.range; u.tpct.textContent = (t >= 0 ? "+" : "−") + Math.abs(t).toFixed(2) + "%"; u.rng.textContent = "±" + s.range; u.rbtn.textContent = "±" + s.range + "%";
  u.bpm.textContent = s.grid ? effBpm(d).toFixed(1) : (d.analyzing ? "···" : "---.-"); u.bpm0.textContent = s.grid ? "ORIG " + s.grid.bpm.toFixed(2) : "BPM";
  u.bm.classList.toggle("on", glob.master === d.n); u.bs.classList.toggle("on", s.sync);
  u.mst.classList.toggle("on", glob.master === d.n); u.syn.classList.toggle("on", s.sync);
  u.qz.classList.toggle("on", s.quant); u.qbtn.classList.toggle("on", s.quant);
  u.tl.style.color = d.remain ? "#fff" : ""; u.tl2.style.color = d.remain ? "" : "#fff";
  u.play.classList.toggle("lit", s.playing); u.cue.classList.toggle("lit", !!s.track && !s.playing);
  u.pads.forEach((p, i) => p.classList.toggle("set", s.hot[i] != null));
  u.loops[0].classList.toggle("armed", s.loop.in != null && s.loop.out == null); u.loops[2].classList.toggle("on", !!s.loop.active);
  if (!u.tempoF.dragging()) u.tempoF.set(0.5 + s.tempo / 2, false);
  if (s.track) u.hdur.textContent = fmt(s.track.dur, false);
  u.el.classList.toggle("loaded", !!s.track);
}
function phaseErr(d, m, t) { const bd = beatAt(d, posAt(d, t)), bm = beatAt(m, posAt(m, t)); let diff = ((bd - bm) % 1 + 1) % 1; if (diff > 0.5) diff -= 1; return diff * spb(d) / rateOf(d.s); }
function drawDeck(d) {
  const u = d.ui, s = d.s; if (!s.track || !d.peaks) return;
  const T = nowS(), p = posAt(d, T), dur = s.track.dur, m = refFor(d);
  const c = u.wz, g = c.getContext("2d"), W = c.width, H = c.height, STRIP = 34; g.clearRect(0, 0, W, H);
  const win = d.win, t0 = p - win * 0.5, spp = win / W, wTop = STRIP + 4, wH = H - wTop, mid = wTop + wH / 2;
  g.fillStyle = "#0b0c10"; g.fillRect(0, 0, W, STRIP);
  if (s.loop.in != null && s.loop.out != null) { const x0 = (s.loop.in - t0) / spp, x1 = (s.loop.out - t0) / spp; g.fillStyle = s.loop.active ? "#22d3c533" : "#ffffff10"; g.fillRect(x0, wTop, x1 - x0, wH); }
  if (s.grid) { const P = spb(d), k0 = Math.ceil((t0 - s.grid.t0) / P), k1 = Math.floor((t0 + win - s.grid.t0) / P);
    for (let k = k0; k <= k1; k++) { const x = (timeOfBeat(d, k) - t0) / spp, bar = ((k % 4) + 4) % 4 === 0;
      g.fillStyle = bar ? "#ffffffaa" : "#ffffff3a"; g.fillRect(x - (bar ? 1.5 : 0.75), wTop, bar ? 3 : 1.5, wH);
      g.fillStyle = bar ? "#ffffff" : "#c9ced8"; g.fillRect(x - (bar ? 2 : 1.5), STRIP - 10, bar ? 4 : 3, 10); } }
  for (let x = 0; x < W; x += 2) { const t = t0 + x * spp; if (t < 0 || t > dur) continue; const b0 = Math.floor(t * ZRES), b1 = Math.max(b0 + 1, Math.floor((t + spp * 2) * ZRES));
    let mm = 0; for (let b = b0; b < b1; b++) { const v = d.peaks[b] || 0; if (v > mm) mm = v; } const h = mm * (wH * 0.46);
    g.fillStyle = t < p ? "#2f5fb3" : "#4f8dff"; g.fillRect(x, mid - h, 2, h * 2); g.fillStyle = t < p ? "#9fb6dd" : "#e8f0ff"; g.fillRect(x, mid - h * 0.35, 2, h * 0.7); }
  const mark = (t, col, w = 3) => { const x = (t - t0) / spp; if (x < -4 || x > W + 4) return; g.fillStyle = col; g.fillRect(x - w / 2, wTop, w, wH); g.beginPath(); g.moveTo(x - 7, wTop); g.lineTo(x + 7, wTop); g.lineTo(x, wTop + 9); g.fill(); };
  mark(s.cue, "#ff8a3d"); s.hot.forEach((h, i) => h != null && mark(h, HC[i]));
  let refOk = false; g.font = "bold 15px JetBrains Mono, monospace"; g.textBaseline = "top";
  if (m && m.s.grid && m.s.playing && s.grid) { refOk = true;
    const pm = posAt(m, T), rd = rateOf(s), rm = rateOf(m.s), dMin = (t0 - p) / rd, dMax = (t0 + win - p) / rd;
    const k0 = Math.ceil(beatAt(m, pm + dMin * rm)), k1 = Math.floor(beatAt(m, pm + dMax * rm));
    for (let k = k0; k <= k1; k++) { const dt = (timeOfBeat(m, k) - pm) / rm, x = ((p + dt * rd) - t0) / spp, bar = ((k % 4) + 4) % 4 === 0;
      g.fillStyle = Math.abs(dt) < 0.06 ? "#ffffff" : (bar ? "#ff3b3b" : "#c62828"); g.fillRect(x - (bar ? 2.5 : 1.5), 2, bar ? 5 : 3, STRIP - 14);
      if (bar) { g.fillStyle = "#ff3b3b55"; g.fillRect(x - 1, wTop, 2, wH); } }
    g.fillStyle = "#ff3b3b"; g.fillText((m.n === glob.master ? "MASTER " : "REF DECK ") + m.n, 8, 3);
  } else { g.fillStyle = "#3c414c"; g.fillText(d.n === glob.master ? "ESTE DECK É O MASTER" : "SEM REFERÊNCIA", 8, 3); }
  g.fillStyle = "#ffffff"; g.fillRect(W / 2 - 1.5, 0, 3, H); g.beginPath(); g.moveTo(W / 2 - 9, H); g.lineTo(W / 2 + 9, H); g.lineTo(W / 2, H - 12); g.fill();
  const pc = u.ph, pg = pc.getContext("2d"), PW = pc.width, PH = pc.height; pg.clearRect(0, 0, PW, PH);
  const cw = (PW - 170) / 4; let txt = "—", txtCol = "#3c414c";
  if (s.grid) { const bd = beatAt(d, p), cur = ((Math.floor(bd) % 4) + 4) % 4, fr = bd - Math.floor(bd), flash = Math.max(0, 1 - fr * 3);
    if (refOk) { const bm = beatAt(m, posAt(m, T)), mc = ((Math.floor(bm) % 4) + 4) % 4, mfr = bm - Math.floor(bm);
      for (let i = 0; i < 4; i++) { pg.fillStyle = i === mc ? `rgba(255,255,255,${0.35 + 0.65 * Math.max(0, 1 - mfr * 3)})` : "#1b1e24"; pg.fillRect(i * cw + 2, 1, cw - 4, PH / 2 - 2); }
      const e = phaseErr(d, m, T) * 1000; txt = (e >= 0 ? "+" : "−") + Math.abs(e).toFixed(0) + " ms"; txtCol = Math.abs(e) <= 5 ? "#4ade80" : Math.abs(e) <= 20 ? "#facc15" : "#ff3b3b";
      if (Math.abs(effBpm(d) / effBpm(m) - 1) > 0.0005) txt += " · BPM≠"; }
    else for (let i = 0; i < 4; i++) { pg.fillStyle = "#14161b"; pg.fillRect(i * cw + 2, 1, cw - 4, PH / 2 - 2); }
    for (let i = 0; i < 4; i++) { pg.fillStyle = i === cur && s.playing ? `rgba(255,59,59,${0.45 + 0.55 * flash})` : i === cur ? "#5a1c1c" : "#1b1e24"; pg.fillRect(i * cw + 2, PH / 2 + 1, cw - 4, PH / 2 - 2); } }
  pg.fillStyle = txtCol; pg.font = "bold 20px JetBrains Mono, monospace"; pg.textBaseline = "middle"; pg.textAlign = "right"; pg.fillText(txt, PW - 4, PH / 2 + 1); pg.textAlign = "left";
  const o = u.wo, og = o.getContext("2d"), OW = o.width, OH = o.height; og.clearRect(0, 0, OW, OH); const bw = OW / OVW, pr = p / dur, mid2 = (OH - 14) / 2;
  for (let i = 0; i < OVW; i++) { const h = d.ov[i] * (mid2 * 0.95); og.fillStyle = (i / OVW) < pr ? "#5b6170" : "#4f8dff"; og.fillRect(i * bw, mid2 - h, Math.max(1, bw - 0.6), h * 2);
    og.fillStyle = (i / OVW) < pr ? "#9aa1ad" : "#ffb020"; og.fillRect(i * bw, mid2 - h * 0.3, Math.max(1, bw - 0.6), h * 0.6); }
  og.fillStyle = "#3c414c"; og.font = "11px JetBrains Mono, monospace"; og.textBaseline = "bottom";
  for (let mn = 1; mn * 60 < dur; mn++) { const x = mn * 60 / dur * OW; og.fillRect(x, OH - 12, 1, 5); og.fillText(mn + ":00", x + 3, OH); }
  const om = (t, col) => { og.fillStyle = col; og.fillRect(t / dur * OW - 1.5, 0, 3, OH - 14); };
  om(s.cue, "#ff8a3d"); s.hot.forEach((h, i) => h != null && om(h, HC[i])); og.fillStyle = "#fff"; og.fillRect(pr * OW - 1.5, 0, 3, OH - 12);
  const tt = d.remain ? dur - p : p, mm2 = Math.floor(tt / 60), ss = tt - mm2 * 60;
  u.time.innerHTML = (d.remain ? "-" : "") + String(mm2).padStart(2, "0") + ":" + String(Math.floor(ss)).padStart(2, "0") + "<small>." + String(Math.floor((ss % 1) * 1000)).padStart(3, "0") + "</small>";
  u.hpos.textContent = fmt(p, false);
  u.rot.style.transform = `rotate(${(p / 1.8) * 360}deg)`; u.jog.style.setProperty("--p", (p / dur).toFixed(4));
  if (s.grid && s.playing) u.bpm.textContent = (effBpm(d) * s.bend).toFixed(1);
}
function frame() {
  if (R) { decks.forEach(drawDeck); mixerFrame(); }
  requestAnimationFrame(frame);
}

/* =====================================================================
   Layout da mesa
   ===================================================================== */
const stage = $("#stage"), wrap = $("#wrap");
function fit() { if (!R) return; stage.style.transform = "none"; const W = stage.scrollWidth, H = stage.scrollHeight, aw = wrap.clientWidth - 24, ah = wrap.clientHeight - 24;
  const s = Math.min(aw / W, ah / H); stage.style.transform = `translate(${(wrap.clientWidth - W * s) / 2}px,${(wrap.clientHeight - H * s) / 2}px) scale(${s})`; }
function setMode(m) { stage.dataset.mode = m; $$(".tgroup .tbtn").forEach((b) => b.classList.toggle("on", b.dataset.mode === String(m)));
  $$(".strip", mixerEl).forEach((s, i) => s.classList.toggle("idle", m == 2 && i > 1)); try { localStorage.setItem("cabine-modo", m); } catch (e) { } fit(); }
const THEMES = [{ n: "ÂMBAR", a: "#ffb020", b: "#22d3c5" }, { n: "CIANO", a: "#22d3c5", b: "#ff5c7a" }, { n: "LIMA", a: "#a3e635", b: "#60a5fa" }, { n: "ROSA", a: "#ff5c9a", b: "#8b9cff" }, { n: "GELO", a: "#e5e7eb", b: "#38bdf8" }];
let th = 0;
function applyTheme() { const t = THEMES[th]; document.documentElement.style.setProperty("--acc", t.a); document.documentElement.style.setProperty("--acc2", t.b); $("#themeBtn").textContent = "TEMA: " + t.n; try { localStorage.setItem("cabine-tema", th); } catch (e) { } }

/* =====================================================================
   Sala: entrar, sair, presença, chat
   ===================================================================== */
function updateConn(status) {
  const c = $("#conn"); if (!c) return; if (status) c.dataset.st = status;
  const st = c.dataset.st || "", on = st === "SUBSCRIBED";
  const txt = on ? (net.mode === "demo" ? "DEMO LOCAL" : "ONLINE" + (rtt != null ? ` · ${Math.round(rtt)} ms` : "")) : st === "CHANNEL_ERROR" || st === "TIMED_OUT" ? "SEM CONEXÃO · TENTANDO DE NOVO" : st === "CLOSED" ? "DESCONECTADO" : "CONECTANDO…";
  c.innerHTML = `<i class="dot ${on ? "live" : ""}"></i><span>${txt}</span>`;
}
let lastPeers = new Map();
function onPeers(list) {
  const byUid = new Map();
  for (const p of list) { if (!p || !p.uid) continue; if (!byUid.has(p.uid) || p.role === "dj") byUid.set(p.uid, p); peerRole[p.uid] = p.role; }
  if (!byUid.has(me.uid)) byUid.set(me.uid, { uid: me.uid, name: me.name, role: R.role });
  for (const [uid, p] of byUid) if (!lastPeers.has(uid) && uid !== me.uid && lastPeers.size) addChat({ sys: true, text: `${p.name} entrou na sala` });
  for (const [uid, p] of lastPeers) if (!byUid.has(uid)) addChat({ sys: true, text: `${p.name} saiu da sala` });
  lastPeers = byUid;
  const arr = [...byUid.values()].sort((a, b) => (a.uid === me.uid ? -1 : b.uid === me.uid ? 1 : (a.role === b.role ? 0 : a.role === "dj" ? -1 : 1)));
  const djs = arr.filter((p) => p.role === "dj"), sp = arr.filter((p) => p.role !== "dj");
  $("#peers").innerHTML = djs.slice(0, 6).map((p) => `<span class="peer ${p.uid === me.uid ? "me" : ""}" title="${esc(p.name)}"><span class="av" style="background:${colorOf(p.uid)}">${esc((p.name || "?")[0].toUpperCase())}</span>${esc(p.name)}${p.uid === R.owner ? '<span class="owner-badge">★</span>' : ""}<i>${p.uid === me.uid ? "VOCÊ" : "DJ"}</i></span>`).join("")
    + (djs.length > 6 ? `<span class="peer"><i>+${djs.length - 6} DJS</i></span>` : "")
    + `<span class="peer" title="${esc(sp.map((p) => p.name).join(", ") || "Ninguém assistindo")}"><i>ESPECTADORES (${sp.length})</i></span>`;
}
const chatMsgs = []; let unread = 0;
function addChat(m) {
  chatMsgs.push(m); if (chatMsgs.length > 200) chatMsgs.shift();
  const list = $("#chatList"), div = document.createElement("div");
  if (m.sys) { div.className = "cm sys"; div.textContent = m.text; }
  else { div.className = "cm"; const t = new Date(m.ts || Date.now()); div.innerHTML = `<b style="color:${colorOf(m.uid)}">${esc(m.name)}</b>${esc(m.text)}<small>${t.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</small>`; }
  list.appendChild(div); list.scrollTop = list.scrollHeight;
  if (!$("#chat").classList.contains("open") && !m.sys) { unread++; const b = $("#chatBadge"); b.hidden = false; b.textContent = unread; }
}
function resetDecks() {
  decks.forEach((d) => { stopSource(d); d.s = blankDeck(); d.buf = null; d.bufPath = null; d.peaks = null; d.ov = null; d.previewing = d.jogging = d.nudging = false; if (d.ui.el) { setBusy(d, ""); refreshDeck(d); } });
  for (const k in M_DEFAULT) setMixRemote(k, M_DEFAULT[k]); glob = { master: null, v: 0 }; bufCache.clear(); peakCache.clear();
}
async function enterRoom(id, role) {
  audio(); try { await AC.resume(); } catch (e) { }
  const room = await net.getRoom(id);
  R = { id, code: room.code, name: room.name, owner: room.owner, role, chan: null };
  showView("room"); document.body.classList.toggle("spect", role !== "dj");
  $("#rName").textContent = room.name; $("#rCode").textContent = room.code;
  const qs = new URLSearchParams(location.search); qs.set("sala", room.code); history.replaceState(null, "", location.pathname + "?" + qs.toString());
  $("#chatList").innerHTML = ""; chatMsgs.length = 0; unread = 0; $("#chatBadge").hidden = true; lastPeers = new Map();
  resetDecks(); fit();
  await measureOffset(); checkK(true);
  applyState(room.state);
  updateConn("CONNECTING");
  R.chan = await net.channel(id, { uid: me.uid, name: me.name, role }, {
    onMsg, onPeers,
    onStatus: (st, err) => { updateConn(st); if (st === "SUBSCRIBED") send("hello", { uid: me.uid }); if (err) console.warn(err); },
  });
  addChat({ sys: true, text: role === "dj" ? `Você entrou como DJ. Código da sala: ${room.code}` : "Você entrou como espectador: ouve tudo, mas não mexe na mesa." });
}
async function leaveRoom() {
  if (!R) return; saveNow();
  try { R.chan && R.chan.leave(); } catch (e) { }
  decks.forEach((d) => stopSource(d)); R = null; document.body.classList.remove("spect"); $("#chat").classList.remove("open");
  const qs = new URLSearchParams(location.search); qs.delete("sala"); history.replaceState(null, "", location.pathname + (qs.toString() ? "?" + qs : ""));
  showLobby();
}

/* =====================================================================
   Login, cadastro e lobby
   ===================================================================== */
function showView(v) { $("#vAuth").classList.toggle("show", v === "auth"); $("#vLobby").classList.toggle("show", v === "lobby"); $("#room").classList.toggle("show", v === "room"); if (v === "room") setTimeout(fit, 0); }
let authTab = "in";
function setAuthTab(t) { authTab = t; $$(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t)); $("#fUser").hidden = t !== "up";
  $("#aBtn").textContent = t === "up" ? "CRIAR CONTA" : "ENTRAR"; $("#aPass").autocomplete = t === "up" ? "new-password" : "current-password"; $("#aMsg").textContent = ""; $("#aMsg").className = "msg"; }
function msg(el, text, kind) { el.textContent = text || ""; el.className = "msg" + (kind ? " " + kind : ""); }
async function showLobby() {
  showView("lobby"); $("#meName").textContent = me.name; $("#meAv").textContent = (me.name || "?")[0].toUpperCase(); $("#meAv").style.background = colorOf(me.uid);
  const code = new URLSearchParams(location.search).get("sala"); if (code) { $("#jCode").value = code.toUpperCase(); $("#jCode").focus(); }
  const list = $("#rList"); list.innerHTML = '<div class="empty-list">Carregando…</div>';
  try {
    const rooms = await net.myRooms();
    if (!rooms.length) { list.innerHTML = '<div class="empty-list">Você ainda não participa de nenhuma sala. Crie uma ou entre com um código.</div>'; return; }
    list.innerHTML = "";
    for (const r of rooms) {
      const it = document.createElement("div"); it.className = "ritem";
      it.innerHTML = `<div class="rn"><b>${esc(r.name)}</b><span>${esc(r.code)}</span></div>${r.isOwner ? '<span class="tag own">DONO</span>' : ""}<span class="tag ${r.role === "dj" ? "dj" : ""}">${r.role === "dj" ? "DJ" : "ESPECTADOR"}</span>
        <button class="sm pri" data-a="go">ENTRAR</button><button class="sm dan" data-a="rm">${r.isOwner ? "APAGAR" : "SAIR"}</button>`;
      $('[data-a="go"]', it).onclick = () => enterRoom(r.id, r.role).catch((e) => msg($("#lMsg"), e.message, "err"));
      const rm = $('[data-a="rm"]', it); let armed = false;
      rm.onclick = async () => { if (!armed) { armed = true; rm.textContent = "CONFIRMAR?"; setTimeout(() => { armed = false; rm.textContent = r.isOwner ? "APAGAR" : "SAIR"; }, 3000); return; }
        try { if (r.isOwner) await net.deleteRoom(r.id); else await net.leaveRoom(r.id); showLobby(); } catch (e) { msg($("#lMsg"), e.message, "err"); } };
      list.appendChild(it);
    }
  } catch (e) { list.innerHTML = `<div class="empty-list">Não foi possível carregar as salas: ${esc(e.message)}</div>`; }
}

/* =====================================================================
   Inicialização
   ===================================================================== */
async function boot() {
  try { net = await window.createNet(); }
  catch (e) { document.body.innerHTML = `<div class="center"><div class="card"><h3>Não foi possível conectar</h3><p class="howto">${esc(e.message)}</p></div></div>`; return; }
  if (net.mode === "demo") $("#demoBanner").hidden = false;
  decks.forEach((d) => stage.appendChild(buildDeck(d)));
  mixerEl = buildMixer(); stage.appendChild(mixerEl); fxUi(); decks.forEach(refreshDeck);
  try { const t = +localStorage.getItem("cabine-tema"); if (t >= 0 && t < THEMES.length) th = t; } catch (e) { }
  applyTheme();
  let mode = 4; try { mode = +localStorage.getItem("cabine-modo") || 4; } catch (e) { } setMode(mode === 2 ? 2 : 4);
  // eventos fixos
  $$(".tabs button").forEach((b) => b.onclick = () => setAuthTab(b.dataset.tab));
  $("#authForm").onsubmit = async (e) => {
    e.preventDefault(); const btn = $("#aBtn"), m = $("#aMsg"); const email = $("#aEmail").value.trim(), pass = $("#aPass").value, user = $("#aUser").value.trim();
    if (authTab === "up" && (user.length < 3 || user.length > 24)) { msg(m, "O nome de DJ precisa ter de 3 a 24 caracteres.", "err"); return; }
    btn.disabled = true; msg(m, authTab === "up" ? "Criando conta…" : "Entrando…");
    try {
      if (authTab === "up") { const r = await net.signUp(email, pass, user); if (r.needsConfirm) { msg(m, "Conta criada! Enviamos um link de confirmação para o seu e-mail. Confirme e depois clique em ENTRAR.", "ok"); setAuthTab("in"); $("#aMsg").textContent = "Conta criada! Confirme o e-mail e depois entre."; $("#aMsg").className = "msg ok"; return; } me = r.profile; }
      else me = await net.signIn(email, pass);
      msg(m, ""); showLobby();
    } catch (err) { msg(m, err.message, "err"); } finally { btn.disabled = false; }
  };
  $("#logout").onclick = async () => { await net.signOut(); me = null; showView("auth"); };
  $("#createForm").onsubmit = async (e) => { e.preventDefault(); try { const r = await net.createRoom($("#cName").value.trim()); $("#cName").value = ""; await enterRoom(r.id, "dj"); } catch (err) { msg($("#lMsg"), err.message, "err"); } };
  $("#joinForm").onsubmit = async (e) => { e.preventDefault(); try { const r = await net.joinRoom($("#jCode").value.trim(), $("#jRole").value); await enterRoom(r.id, r.role); } catch (err) { msg($("#lMsg"), err.message, "err"); } };
  $("#jCode").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });
  $("#leaveBtn").onclick = leaveRoom;
  $("#copyInvite").onclick = async () => { const qs = new URLSearchParams(); qs.set("sala", R.code); if (net.mode === "demo") qs.set("demo", "1");
    const link = location.origin + location.pathname + "?" + qs.toString();
    try { await navigator.clipboard.writeText(link); toast("Link de convite copiado: " + link); } catch (e) { toast("Convite: " + link); } };
  $$(".tgroup .tbtn").forEach((b) => b.onclick = () => setMode(+b.dataset.mode));
  $("#themeBtn").onclick = () => { th = (th + 1) % THEMES.length; applyTheme(); };
  const modal = $("#modal"); $("#helpBtn").onclick = () => modal.classList.add("open"); $("#closeModal").onclick = () => modal.classList.remove("open");
  modal.onclick = (e) => { if (e.target === modal) modal.classList.remove("open"); };
  const mf = $("#multiFile"); $("#loadAll").onclick = () => { if (!canCtl()) return; audio(); mf.click(); };
  mf.onchange = () => { const files = [...mf.files]; const order = stage.dataset.mode === "2" ? [decks[0], decks[1]] : decks;
    let free = order.filter((d) => !d.s.track); if (!free.length) free = order; files.slice(0, free.length).forEach((f, i) => loadLocalFile(free[i], f)); mf.value = ""; };
  $("#chatBtn").onclick = () => { const c = $("#chat"); c.classList.toggle("open"); if (c.classList.contains("open")) { unread = 0; $("#chatBadge").hidden = true; $("#chatIn").focus(); } };
  $("#chatClose").onclick = () => $("#chat").classList.remove("open");
  $("#chatForm").onsubmit = (e) => { e.preventDefault(); const t = $("#chatIn").value.trim(); if (!t || !R) return; const m = { uid: me.uid, name: me.name, text: t.slice(0, 300), ts: Date.now() }; send("chat", m); addChat(m); $("#chatIn").value = ""; };
  const KEYS = { q: [0, "p"], a: [0, "c"], w: [1, "p"], s: [1, "c"], o: [2, "p"], k: [2, "c"], p: [3, "p"], l: [3, "c"] }, held = new Set();
  addEventListener("keydown", (e) => { if (!R || e.repeat || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; const k = e.key.toLowerCase();
    if (KEYS[k]) { const [i, a] = KEYS[k]; const d = decks[i]; if (a === "p") togglePlay(d); else { held.add(k); cueDown(d); } e.preventDefault(); }
    else if (e.key === "ArrowLeft") { ctl.xf.set(ctl.xf.get() - 0.1); e.preventDefault(); }
    else if (e.key === "ArrowRight") { ctl.xf.set(ctl.xf.get() + 0.1); e.preventDefault(); }
    else if (e.key === "ArrowDown") { ctl.xf.set(0.5); e.preventDefault(); }
    else if (e.key === "Escape") { modal.classList.remove("open"); $("#chat").classList.remove("open"); } });
  addEventListener("keyup", (e) => { const k = e.key.toLowerCase(); if (held.has(k)) { held.delete(k); cueUp(decks[KEYS[k][0]]); } });
  addEventListener("resize", fit);
  addEventListener("beforeunload", () => { if (R && canCtl()) saveNow(); });
  setInterval(() => { $("#clock").textContent = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }, 1000);
  if (document.fonts) document.fonts.ready.then(fit);
  requestAnimationFrame(frame);
  me = await net.session().catch(() => null);
  if (me) showLobby(); else showView("auth");
}
boot();
