/* =====================================================================
   MIXER DE 4 CANAIS — layout de mixer de clube
   Esquerda: Sound Color FX + Phones · Centro: 4 canais · Direita: Master + Beat FX
   O app hospedeiro precisa definir: AC (AudioContext), setMix(k, v), canCtl(),
   fxBpm(), makeKnob(), makeFader(), vuEl(), setVu() e $/$$.
   ===================================================================== */
"use strict";
var G = null;
const FX_BEATS = [0.25, 0.5, 0.75, 1, 2, 4], FX_BEAT_LBL = ["1/4", "1/2", "3/4", "1", "2", "4"];
const COLOR_FX = [["SPACE", "SPACE"], ["DUBECHO", "DUB ECHO"], ["NOISE", "NOISE"], ["CRUSH", "CRUSH"], ["FILTER", "FILTER"]];
const BEAT_FX = ["ECHO", "DELAY", "REVERB", "FLANGER"];
const M_DEFAULT = (() => {
  const m = { colorMode: "FILTER", colorParam: 0.3, fxType: "ECHO", fxTarget: "M", fxOn: false, fxDepth: 0.5, fxBeat: 2, master: 0.8, xf: 0.5 };
  for (let i = 0; i < 4; i++) Object.assign(m, { [`ch.${i}.trim`]: 0, [`ch.${i}.hi`]: 0, [`ch.${i}.mid`]: 0, [`ch.${i}.low`]: 0, [`ch.${i}.color`]: 0, [`ch.${i}.fader`]: 0.8, [`ch.${i}.assign`]: "T" });
  return m;
})();
let M = { ...M_DEFAULT };
const ctl = {}, segUi = {};
let phones = 0.9; try { const v = parseFloat(localStorage.getItem("cabine-phones")); if (v >= 0 && v <= 1) phones = v; } catch (e) { }
let mixerEl = null, lastFxBpm = 0;

/* ---------------- grafo de áudio ---------------- */
function crushCurve(steps) { const n = 2048, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.round(x * steps) / steps; } return c; }
function impulse(sec, decay) { const len = Math.floor(AC.sampleRate * sec), b = AC.createBuffer(2, len, AC.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); } return b; }
function mixerGraph(a) {
  G = {};
  // master
  G.masterIn = a.createGain(); G.masterGain = a.createGain(); G.limiter = a.createDynamicsCompressor(); G.listen = a.createGain();
  G.limiter.threshold.value = -2; G.limiter.ratio.value = 20; G.limiter.attack.value = 0.002; G.limiter.release.value = 0.15;
  G.split = a.createChannelSplitter(2); G.anL = a.createAnalyser(); G.anR = a.createAnalyser(); G.anL.fftSize = G.anR.fftSize = 1024;
  G.masterIn.connect(G.masterGain); G.masterGain.connect(G.limiter); G.limiter.connect(G.listen); G.listen.connect(a.destination);
  G.limiter.connect(G.split); G.split.connect(G.anL, 0); G.split.connect(G.anR, 1);
  // beat fx
  G.fxBus = a.createGain(); G.masterSend = a.createGain(); G.masterSend.gain.value = 0; G.masterIn.connect(G.masterSend); G.masterSend.connect(G.fxBus);
  G.fxOut = a.createGain(); G.fxOut.connect(G.masterGain);
  G.echoIn = a.createGain(); G.delay = a.createDelay(4); G.fb = a.createGain(); G.fbLp = a.createBiquadFilter(); G.fbLp.type = "lowpass"; G.fbLp.frequency.value = 9000;
  G.fxBus.connect(G.echoIn); G.echoIn.connect(G.delay); G.delay.connect(G.fbLp); G.fbLp.connect(G.fb); G.fb.connect(G.delay); G.delay.connect(G.fxOut);
  G.revIn = a.createGain(); G.conv = a.createConvolver(); G.conv.buffer = impulse(2.8, 2.6); G.fxBus.connect(G.revIn); G.revIn.connect(G.conv); G.conv.connect(G.fxOut);
  G.flIn = a.createGain(); G.flDelay = a.createDelay(0.05); G.flDelay.delayTime.value = 0.004; G.flFb = a.createGain(); G.flFb.gain.value = 0.55;
  G.lfo = a.createOscillator(); G.lfo.type = "triangle"; G.lfo.frequency.value = 0.25; G.lfoAmt = a.createGain(); G.lfoAmt.gain.value = 0.0032;
  G.lfo.connect(G.lfoAmt); G.lfoAmt.connect(G.flDelay.delayTime); G.lfo.start();
  G.fxBus.connect(G.flIn); G.flIn.connect(G.flDelay); G.flDelay.connect(G.flFb); G.flFb.connect(G.flDelay); G.flDelay.connect(G.fxOut);
  // sound color fx compartilhados
  G.spaceIn = a.createGain(); G.spaceConv = a.createConvolver(); G.spaceConv.buffer = impulse(1.8, 3.2); G.spaceOut = a.createGain();
  G.spaceIn.connect(G.spaceConv); G.spaceConv.connect(G.spaceOut); G.spaceOut.connect(G.masterIn);
  G.dubIn = a.createGain(); G.dubDelay = a.createDelay(2); G.dubFb = a.createGain(); G.dubBp = a.createBiquadFilter(); G.dubBp.type = "bandpass"; G.dubBp.frequency.value = 1400; G.dubBp.Q.value = 0.8;
  G.dubIn.connect(G.dubDelay); G.dubDelay.connect(G.dubBp); G.dubBp.connect(G.dubFb); G.dubFb.connect(G.dubDelay); G.dubBp.connect(G.masterIn);
  const nb = a.createBuffer(1, a.sampleRate * 2, a.sampleRate), nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  G.noise = a.createBufferSource(); G.noise.buffer = nb; G.noise.loop = true; G.noise.start();
  // canais
  G.ch = [0, 1, 2, 3].map(() => { const c = {};
    c.trim = a.createGain(); c.low = a.createBiquadFilter(); c.mid = a.createBiquadFilter(); c.hi = a.createBiquadFilter();
    c.low.type = "lowshelf"; c.low.frequency.value = 220; c.mid.type = "peaking"; c.mid.frequency.value = 1000; c.mid.Q.value = 0.7; c.hi.type = "highshelf"; c.hi.frequency.value = 3500;
    c.filt = a.createBiquadFilter(); c.dry = a.createGain(); c.shaper = a.createWaveShaper(); c.steps = 6; c.shaper.curve = crushCurve(6); c.wet = a.createGain();
    c.noiseGain = a.createGain(); c.noiseGain.gain.value = 0; c.noiseFilt = a.createBiquadFilter(); G.noise.connect(c.noiseFilt); c.noiseFilt.connect(c.noiseGain);
    c.post = a.createGain(); c.fader = a.createGain(); c.xf = a.createGain(); c.an = a.createAnalyser(); c.an.fftSize = 1024;
    c.fxSend = a.createGain(); c.fxSend.gain.value = 0;
    c.spaceFilt = a.createBiquadFilter(); c.spaceSend = a.createGain(); c.spaceSend.gain.value = 0;
    c.dubFilt = a.createBiquadFilter(); c.dubSend = a.createGain(); c.dubSend.gain.value = 0;
    c.trim.connect(c.low); c.low.connect(c.mid); c.mid.connect(c.hi); c.hi.connect(c.filt);
    c.filt.connect(c.dry); c.dry.connect(c.post); c.filt.connect(c.shaper); c.shaper.connect(c.wet); c.wet.connect(c.post); c.noiseGain.connect(c.post);
    c.post.connect(c.fader); c.fader.connect(c.xf); c.xf.connect(G.masterIn); c.xf.connect(c.an);
    c.xf.connect(c.fxSend); c.fxSend.connect(G.fxBus);
    c.xf.connect(c.spaceFilt); c.spaceFilt.connect(c.spaceSend); c.spaceSend.connect(G.spaceIn);
    c.xf.connect(c.dubFilt); c.dubFilt.connect(c.dubSend); c.dubSend.connect(G.dubIn);
    c.input = c.trim; return c; });
  for (let i = 0; i < 4; i++) applyChannel(i); applyXf(); applyFx(); applyMaster(); applyPhones();
  return G;
}
const dB = (x) => Math.pow(10, x / 20);
function ramp(p, v) { if (!AC) return; p.setTargetAtTime(v, AC.currentTime, 0.012); }
function applyChannel(i) {
  if (!G) return; const c = G.ch[i], g = (k) => M[`ch.${i}.${k}`];
  ramp(c.trim.gain, dB(g("trim")));
  const eq = (v) => v < 0 ? v * 40 : v * 6; ramp(c.hi.gain, eq(g("hi"))); ramp(c.mid.gain, eq(g("mid"))); ramp(c.low.gain, eq(g("low")));
  ramp(c.fader.gain, g("fader") * g("fader"));
  const k = g("color"), a = Math.abs(k), P = M.colorParam, mode = COLOR_FX.some((x) => x[0] === M.colorMode) ? M.colorMode : "FILTER";
  const lpf = (f, q) => { c.filt.type = "lowpass"; c.filt.Q.value = q; ramp(c.filt.frequency, f); };
  const hpf = (f, q) => { c.filt.type = "highpass"; c.filt.Q.value = q; ramp(c.filt.frequency, f); };
  lpf(AC.sampleRate / 2, 0.0001); ramp(c.wet.gain, 0); ramp(c.dry.gain, 1); ramp(c.spaceSend.gain, 0); ramp(c.dubSend.gain, 0); ramp(c.noiseGain.gain, 0);
  if (a < 0.02) return;
  if (mode === "FILTER") { const q = 0.6 + P * P * 14; if (k < 0) lpf(20000 * Math.pow(150 / 20000, a), q); else hpf(20 * Math.pow(7000 / 20, a), q); }
  else if (mode === "CRUSH") { const steps = Math.max(2, Math.round(2 + (1 - P) * 10)); if (steps !== c.steps) { c.steps = steps; c.shaper.curve = crushCurve(steps); }
    ramp(c.wet.gain, a * 0.9); ramp(c.dry.gain, 1 - a * 0.75); if (k < 0) lpf(20000 * Math.pow(1500 / 20000, a), 0.7); else hpf(20 * Math.pow(1200 / 20, a), 0.7); }
  else if (mode === "SPACE") { c.spaceFilt.type = k < 0 ? "lowpass" : "highpass"; c.spaceFilt.frequency.value = k < 0 ? 1200 : 700; c.spaceFilt.Q.value = 0.7; ramp(c.spaceSend.gain, a * 1.3); }
  else if (mode === "DUBECHO") { c.dubFilt.type = k < 0 ? "lowpass" : "highpass"; c.dubFilt.frequency.value = k < 0 ? 1100 : 900; c.dubFilt.Q.value = 0.7; ramp(c.dubSend.gain, a); }
  else if (mode === "NOISE") { ramp(c.noiseGain.gain, a * 0.3);
    if (k < 0) { c.noiseFilt.type = "lowpass"; ramp(c.noiseFilt.frequency, 20000 * Math.pow(300 / 20000, a)); } else { c.noiseFilt.type = "highpass"; ramp(c.noiseFilt.frequency, 20 * Math.pow(9000 / 20, a)); }
    c.noiseFilt.Q.value = 0.8 + P * 6; }
}
function applyColorShared() { if (!G) return; const P = M.colorParam;
  ramp(G.spaceOut.gain, 0.5 + P * 1.0);
  ramp(G.dubFb.gain, 0.35 + P * 0.55); ramp(G.dubDelay.delayTime, (60 / (fxBpm() || 120)) * 0.75); }
function xfGain(assign, x) { if (assign === "A") return Math.min(1, 2 * (1 - x)); if (assign === "B") return Math.min(1, 2 * x); return 1; }
function applyXf() { if (!G) return; for (let i = 0; i < 4; i++) ramp(G.ch[i].xf.gain, xfGain(M[`ch.${i}.assign`], M.xf)); }
function fxTimeSec() { return FX_BEATS[M.fxBeat] * 60 / (fxBpm() || 120); }
function applyFx() {
  if (!G) return; const t = fxTimeSec(), type = BEAT_FX.includes(M.fxType) ? M.fxType : "ECHO";
  lastFxBpm = fxBpm() || 120;
  ramp(G.echoIn.gain, type === "ECHO" || type === "DELAY" ? 1 : 0); ramp(G.revIn.gain, type === "REVERB" ? 1 : 0); ramp(G.flIn.gain, type === "FLANGER" ? 1 : 0);
  ramp(G.delay.delayTime, Math.min(3.9, t)); ramp(G.fb.gain, type === "ECHO" ? 0.55 : 0.12);
  G.lfo.frequency.setTargetAtTime(1 / Math.max(0.25, t * 4), AC.currentTime, 0.05);
  ramp(G.fxOut.gain, type === "REVERB" ? M.fxDepth * 1.4 : type === "FLANGER" ? M.fxDepth * 1.1 : M.fxDepth);
  G.ch.forEach((c, i) => ramp(c.fxSend.gain, M.fxOn && M.fxTarget === String(i + 1) ? 1 : 0));
  ramp(G.masterSend.gain, M.fxOn && M.fxTarget === "M" ? 1 : 0);
  applyColorShared();
}
function applyMaster() { if (G) ramp(G.masterGain.gain, M.master * M.master * 1.25); }
function applyPhones() { if (G) ramp(G.listen.gain, phones * phones * 1.1); }
function applyKey(k) {
  if (k.startsWith("ch.")) { const i = +k.split(".")[1]; applyChannel(i); if (k.endsWith("assign")) applyXf(); }
  else if (k === "colorMode" || k === "colorParam") { for (let i = 0; i < 4; i++) applyChannel(i); applyColorShared(); }
  else if (k.startsWith("fx")) { applyFx(); fxUi(); }
  else if (k === "master") applyMaster();
  else if (k === "xf") applyXf();
}

/* ---------------- interface ---------------- */
function buildMixer() {
  const el = document.createElement("section"); el.className = "mixer mx";
  el.innerHTML = `
  <div class="mx-plate"><span class="mx-brand">B2B ANYWHERE</span><span class="mx-model">MX-4 · 4 CHANNEL CLUB MIXER</span></div>
  <div class="mx-body">
    <div class="mx-side mx-left">
      <div class="mx-sec"><div class="mx-h">SOUND COLOR FX</div><div class="mx-cfx"></div><div class="mx-param"></div></div>
      <div class="mx-sec mx-phones"><div class="mx-h">PHONES <em>(SÓ VOCÊ)</em></div><div class="mx-ph"></div></div>
    </div>
    <div class="mx-chs"></div>
    <div class="mx-side mx-right">
      <div class="mx-sec"><div class="mx-h">MASTER</div><div class="mx-master"><div class="mx-mk"></div><div class="mx-mvu"><div class="mx-scale"><span>+6</span><span>0</span><span>-6</span><span>-12</span><span>-24</span><span>-∞</span></div></div></div></div>
      <div class="mx-sec mx-bfx"><div class="mx-h">BEAT FX <span id="fxState">OFF</span></div>
        <div class="fxscr"><div class="fx-top"><span class="fx-auto">AUTO</span><b id="fxBpm">120.0</b><small>BPM</small></div><div class="nm" id="fxName">ECHO</div>
          <div class="fx-beats" id="fxBeats"></div><div class="meta"><span><b id="fxMs">375</b> ms</span><span>CH <b id="fxTg">MST</b></span></div><div class="bar"><i id="fxBar"></i></div></div>
        <div class="row fx-beatbtn"><button class="seg" data-bt="-1">◀ BEAT</button><button class="seg" data-bt="1">BEAT ▶</button></div>
        <div class="fx-list">${BEAT_FX.map((t) => `<button class="seg" data-t="${t}">${t}</button>`).join("")}</div>
        <div class="mx-lbl">FX CH SELECT</div>
        <div class="row fx-ch">${["1", "2", "3", "4", "M"].map((t) => `<button class="seg" data-c="${t}">${t === "M" ? "MST" : t}</button>`).join("")}</div>
        <div class="row fx-knobs"></div>
      </div>
    </div>
  </div>
  <div class="mx-xf"><div class="mx-lbl">CROSSFADER</div><div class="mx-xfrow"><b>A</b><div class="xslot"></div><b>B</b></div></div>`;
  // canais
  const chs = $(".mx-chs", el);
  for (let i = 0; i < 4; i++) {
    const s = document.createElement("div"); s.className = "strip mx-ch";
    s.innerHTML = `<div class="mx-num">${i + 1}</div><div class="mx-src">DECK ${i + 1}</div><div class="k-trim"></div><div class="mx-eqlbl">EQ</div><div class="k-hi"></div><div class="k-mid"></div><div class="k-low"></div>
      <div class="mx-colorlbl"><span>LOW</span>COLOR<span>HI</span></div><div class="k-color"></div><div class="mx-fz"></div>
      <div class="mx-lbl">CROSSFADER ASSIGN</div><div class="assign"></div>`;
    const K_ = (sel, key, opts) => { const k = makeKnob({ ...opts, value: M[key], onChange: (v) => setMix(key, v) }); ctl[key] = k; $(sel, s).appendChild(k.el); };
    K_(".k-trim", `ch.${i}.trim`, { label: "TRIM", min: -12, max: 12, def: 0, size: 38, color: "#9aa1ad" });
    K_(".k-hi", `ch.${i}.hi`, { label: "HI", def: 0, size: 42 }); K_(".k-mid", `ch.${i}.mid`, { label: "MID", def: 0, size: 42 }); K_(".k-low", `ch.${i}.low`, { label: "LOW", def: 0, size: 42 });
    K_(".k-color", `ch.${i}.color`, { def: 0, size: 50, color: "var(--acc2)" });
    const fz = $(".mx-fz", s), vu = vuEl(15); vu.classList.add("mx-vu"); fz.appendChild(vu);
    const fk = `ch.${i}.fader`, f = makeFader({ orient: "v", length: 218, value: M[fk], def: 0.8, thick: 46, ticks: 10, onChange: (v) => setMix(fk, v) }); ctl[fk] = f; fz.appendChild(f.el);
    const as = $(".assign", s), ak = `ch.${i}.assign`;
    as.innerHTML = ["A", "T", "B"].map((x) => `<button data-x="${x}" title="${x === "A" ? "Lado A do crossfader" : x === "B" ? "Lado B do crossfader" : "Thru: ignora o crossfader"}">${x === "T" ? "THRU" : x}</button>`).join("");
    segUi[ak] = (v) => $$("button", as).forEach((o) => o.classList.toggle("on", o.dataset.x === v)); segUi[ak](M[ak]);
    $$("button", as).forEach((b) => b.onclick = () => { if (!canCtl()) return; setMix(ak, b.dataset.x); segUi[ak](b.dataset.x); });
    s._vu = vu; chs.appendChild(s);
  }
  // sound color fx
  const cfx = $(".mx-cfx", el);
  cfx.innerHTML = COLOR_FX.map(([id, lbl]) => `<button class="cfx" data-m="${id}"><i></i>${lbl}</button>`).join("");
  segUi.colorMode = (v) => $$(".cfx", cfx).forEach((o) => o.classList.toggle("on", o.dataset.m === v)); segUi.colorMode(M.colorMode);
  $$(".cfx", cfx).forEach((b) => b.onclick = () => { if (!canCtl()) return; setMix("colorMode", b.dataset.m); segUi.colorMode(b.dataset.m); });
  const pk = makeKnob({ label: "PARAMETER", min: 0, max: 1, value: M.colorParam, def: 0.3, size: 48, color: "var(--acc2)", onChange: (v) => setMix("colorParam", v) }); ctl.colorParam = pk; $(".mx-param", el).appendChild(pk.el);
  // phones (local)
  const ph = makeKnob({ label: "LEVEL", min: 0, max: 1, value: phones, def: 0.9, size: 48, color: "#4ade80", onChange: (v) => { phones = v; applyPhones(); try { localStorage.setItem("cabine-phones", v); } catch (e) { } } });
  $(".mx-ph", el).appendChild(ph.el); ctl._phones = ph;
  // master
  const mk = makeKnob({ label: "MASTER LEVEL", min: 0, max: 1, value: M.master, def: 0.8, size: 56, onChange: (v) => setMix("master", v) }); ctl.master = mk; $(".mx-mk", el).appendChild(mk.el);
  const mL = vuEl(20), mR = vuEl(20); mL.classList.add("mx-vu"); mR.classList.add("mx-vu"); $(".mx-mvu", el).prepend(mL, mR); el._mL = mL; el._mR = mR;
  // beat fx
  const bfx = $(".mx-bfx", el);
  const seg = (sel, key, attr) => { segUi[key] = (v) => $$(sel, bfx).forEach((o) => o.classList.toggle("on", o.dataset[attr] === String(v))); segUi[key](M[key]);
    $$(sel, bfx).forEach((b) => b.onclick = () => { if (!canCtl()) return; setMix(key, b.dataset[attr]); segUi[key](b.dataset[attr]); }); };
  seg("[data-t]", "fxType", "t"); seg("[data-c]", "fxTarget", "c");
  $$("[data-bt]", bfx).forEach((b) => b.onclick = () => { if (!canCtl()) return; setMix("fxBeat", clamp(M.fxBeat + +b.dataset.bt, 0, FX_BEATS.length - 1)); fxUi(); });
  $("#fxBeats", bfx).innerHTML = FX_BEAT_LBL.map((l, i) => `<span data-i="${i}">${l}</span>`).join("");
  const fk = $(".fx-knobs", bfx);
  const dk = makeKnob({ label: "LEVEL/DEPTH", min: 0, max: 1, value: M.fxDepth, def: 0.5, size: 50, onChange: (v) => setMix("fxDepth", v) }); ctl.fxDepth = dk; fk.appendChild(dk.el);
  const on = document.createElement("button"); on.className = "onbtn"; on.innerHTML = "ON/OFF"; segUi.fxOn = (v) => on.classList.toggle("on", !!v); segUi.fxOn(M.fxOn);
  on.onclick = () => { if (!canCtl()) return; setMix("fxOn", !M.fxOn); segUi.fxOn(M.fxOn); }; fk.appendChild(on);
  // crossfader
  const xf = makeFader({ orient: "h", length: 320, value: M.xf, def: 0.5, center: true, ticks: 10, onChange: (v) => setMix("xf", v) }); ctl.xf = xf; $(".xslot", el).appendChild(xf.el); el._xf = xf;
  mixerEl = el; fxUi();
  return el;
}
function fxUi() {
  if (!mixerEl) return; const q = (s) => mixerEl.querySelector(s);
  q("#fxName").textContent = BEAT_FX.includes(M.fxType) ? M.fxType : "ECHO";
  q("#fxBpm").textContent = (fxBpm() || 120).toFixed(1);
  q("#fxMs").textContent = M.fxType === "REVERB" ? "—" : Math.round(fxTimeSec() * 1000);
  q("#fxTg").textContent = M.fxTarget === "M" ? "MST" : M.fxTarget; q("#fxBar").style.width = (M.fxDepth * 100) + "%";
  $$("#fxBeats span", mixerEl).forEach((s) => s.classList.toggle("on", +s.dataset.i === M.fxBeat));
  const st = q("#fxState"); st.textContent = M.fxOn ? "ON" : "OFF"; st.classList.toggle("on", !!M.fxOn);
}
const _vuBuf = new Float32Array(1024), _vuLv = [0, 0, 0, 0], _mLv = [0, 0];
function _rms(an) { an.getFloatTimeDomainData(_vuBuf); let s = 0; for (let i = 0; i < _vuBuf.length; i++) s += _vuBuf[i] * _vuBuf[i]; const r = Math.sqrt(s / _vuBuf.length); return clamp((20 * Math.log10(r + 1e-9) + 48) / 54, 0, 1); }
let _fxCheck = 0;
function mixerFrame() {
  if (!G || !mixerEl) return;
  const strips = $$(".mx-ch", mixerEl);
  G.ch.forEach((c, i) => { _vuLv[i] = Math.max(_rms(c.an), _vuLv[i] * 0.9); setVu(strips[i]._vu, _vuLv[i]); });
  _mLv[0] = Math.max(_rms(G.anL), _mLv[0] * 0.9); _mLv[1] = Math.max(_rms(G.anR), _mLv[1] * 0.9); setVu(mixerEl._mL, _mLv[0]); setVu(mixerEl._mR, _mLv[1]);
  if (++_fxCheck % 20 === 0) { const b = fxBpm() || 120; if (Math.abs(b - lastFxBpm) > 0.05) { applyFx(); fxUi(); } }
}
