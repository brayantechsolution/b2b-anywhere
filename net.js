/* =====================================================================
   Camada de rede da Cabine Online
   - supabaseNet: produção (cadastro, salas, músicas e tempo real no Supabase)
   - demoNet:     demonstração local (duas abas no mesmo computador)
   ===================================================================== */
(function () {
  "use strict";
  const MIME = { mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/aac", flac: "audio/flac", webm: "audio/webm", aif: "audio/aiff", aiff: "audio/aiff" };
  const mimeOf = (f) => (f.type && f.type.startsWith("audio/")) ? f.type : (MIME[(f.name.split(".").pop() || "").toLowerCase()] || "audio/mpeg");
  const epoch = () => performance.timeOrigin + performance.now();

  const PT = [
    [/invalid login credentials/i, "E-mail ou senha incorretos."],
    [/user already registered|already been registered/i, "Este e-mail já tem cadastro. Use ENTRAR."],
    [/email not confirmed/i, "Confirme o seu e-mail antes de entrar (veja a caixa de entrada e o spam)."],
    [/password should be at least (\d+)/i, (m) => `A senha precisa ter pelo menos ${m[1]} caracteres.`],
    [/unable to validate email|invalid email|email address .* is invalid/i, "E-mail inválido."],
    [/rate limit|too many requests|security purposes/i, "Muitas tentativas seguidas. Espere um minuto e tente de novo."],
    [/sala não encontrada/i, "Sala não encontrada. Confira o código."],
    [/payload too large|exceeded the maximum allowed size|object exceeded/i, "Arquivo grande demais (limite de 50 MB)."],
    [/mime type .* is not supported|invalid mime/i, "Formato de arquivo não aceito. Use mp3, wav, m4a, ogg ou flac."],
    [/failed to fetch|networkerror|load failed/i, "Sem conexão com o servidor. Verifique a internet."],
  ];
  function pt(msg) {
    msg = String(msg || "Erro desconhecido");
    for (const [re, out] of PT) { const m = msg.match(re); if (m) return typeof out === "function" ? out(m) : out; }
    return msg;
  }
  const check = (error) => { if (error) throw new Error(pt(error.message || error)); };
  const one = (data) => (Array.isArray(data) ? data[0] : data);

  /* ------------------------------------------------------------------ */
  async function supabaseNet(cfg) {
    const mod = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    const sb = mod.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 40 } },
    });
    let me = null;
    async function profileOf(user) {
      if (!user) { me = null; return null; }
      const { data } = await sb.from("profiles").select("username").eq("id", user.id).maybeSingle();
      me = { uid: user.id, name: (data && data.username) || (user.user_metadata && user.user_metadata.username) || (user.email || "dj").split("@")[0], email: user.email };
      return me;
    }
    sb.auth.onAuthStateChange((_ev, session) => {
      if (session) sb.realtime.setAuth(session.access_token);
    });
    return {
      mode: "online",
      async session() { const { data } = await sb.auth.getSession(); return profileOf(data.session ? data.session.user : null); },
      async signUp(email, password, username) {
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username }, emailRedirectTo: location.origin + location.pathname } });
        check(error);
        if (!data.session) return { needsConfirm: true };
        return { profile: await profileOf(data.user) };
      },
      async signIn(email, password) { const { data, error } = await sb.auth.signInWithPassword({ email, password }); check(error); return profileOf(data.user); },
      async signOut() { await sb.auth.signOut(); me = null; },
      async createRoom(name) { const { data, error } = await sb.rpc("create_room", { p_name: name }); check(error); const r = one(data); return { id: r.r_id, code: r.r_code }; },
      async joinRoom(code, role) { const { data, error } = await sb.rpc("join_room", { p_code: code, p_role: role }); check(error); const r = one(data); return { id: r.r_id, name: r.r_name, role: r.r_role }; },
      async myRooms() {
        const { data, error } = await sb.from("room_members").select("role, rooms(id, code, name, owner, updated_at)").eq("user_id", me.uid);
        check(error);
        return (data || []).filter((x) => x.rooms).map((x) => ({ id: x.rooms.id, code: x.rooms.code, name: x.rooms.name, role: x.role, isOwner: x.rooms.owner === me.uid, updated: x.rooms.updated_at }))
          .sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
      },
      async getRoom(id) { const { data, error } = await sb.from("rooms").select("id, code, name, owner, state").eq("id", id).single(); check(error); return data; },
      async deleteRoom(id) { const { error } = await sb.from("rooms").delete().eq("id", id); check(error); },
      async leaveRoom(id) { const { error } = await sb.from("room_members").delete().eq("room_id", id).eq("user_id", me.uid); check(error); },
      async saveState(id, state) { const { error } = await sb.rpc("save_state", { p_room: id, p_state: state }); check(error); },
      async timeSample() { const t0 = epoch(); const { data, error } = await sb.rpc("server_time"); const t1 = epoch(); check(error); return { rtt: t1 - t0, off: Number(data) - (t0 + t1) / 2 }; },
      async upload(path, file) { const { error } = await sb.storage.from("tracks").upload(path, file, { contentType: mimeOf(file), upsert: false, cacheControl: "31536000" }); check(error); },
      async download(path) { const { data, error } = await sb.storage.from("tracks").download(path); check(error); return data; },
      async channel(roomId, meta, h) {
        const { data } = await sb.auth.getSession();
        if (data.session) await sb.realtime.setAuth(data.session.access_token);
        const key = meta.uid + ":" + Math.random().toString(36).slice(2, 8);
        const ch = sb.channel("room:" + roomId, { config: { private: true, broadcast: { self: false, ack: false }, presence: { key } } });
        ch.on("broadcast", { event: "m" }, ({ payload }) => { if (payload) h.onMsg(payload.t, payload.d, payload.u); });
        ch.on("presence", { event: "sync" }, () => {
          const st = ch.presenceState(), list = [];
          for (const k in st) { const m = st[k] && st[k][0]; if (m) list.push(Object.assign({ key: k }, m)); }
          h.onPeers(list);
        });
        ch.subscribe(async (status, err) => {
          h.onStatus && h.onStatus(status, err ? pt(err.message) : "");
          if (status === "SUBSCRIBED") { try { await ch.track(meta); } catch (e) { /* presença opcional */ } }
        });
        return {
          send: (t, d) => ch.send({ type: "broadcast", event: "m", payload: { t, d, u: meta.uid } }),
          leave: () => sb.removeChannel(ch),
        };
      },
    };
  }

  /* ------------------------------------------------------------------
     Modo demonstração: guarda tudo no navegador. Cada aba é um usuário
     diferente; as abas conversam por BroadcastChannel.
     ------------------------------------------------------------------ */
  function demoNet() {
    const L = (k, def) => { try { const v = JSON.parse(localStorage.getItem("cabdemo_" + k)); return v == null ? def : v; } catch (e) { return def; } };
    const S = (k, v) => localStorage.setItem("cabdemo_" + k, JSON.stringify(v));
    const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "x" + Math.random().toString(36).slice(2) + Date.now().toString(36));
    let me = null;
    function db() {
      return new Promise((res, rej) => { const r = indexedDB.open("cabine-demo", 1); r.onupgradeneeded = () => r.result.createObjectStore("f"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    }
    async function idbPut(k, v) { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction("f", "readwrite"); tx.objectStore("f").put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); }
    async function idbGet(k) { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction("f", "readonly"); const q = tx.objectStore("f").get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
    const rooms = () => L("rooms", {});
    return {
      mode: "demo",
      async session() { const s = sessionStorage.getItem("cabdemo_me"); me = s ? JSON.parse(s) : null; return me; },
      async signUp(email, password, username) {
        const users = L("users", {});
        if (users[email]) throw new Error("Este e-mail já tem cadastro. Use ENTRAR.");
        if ((password || "").length < 6) throw new Error("A senha precisa ter pelo menos 6 caracteres.");
        users[email] = { uid: uuid(), name: username, email, password }; S("users", users);
        me = { uid: users[email].uid, name: username, email }; sessionStorage.setItem("cabdemo_me", JSON.stringify(me));
        return { profile: me };
      },
      async signIn(email, password) {
        const u = L("users", {})[email];
        if (!u || u.password !== password) throw new Error("E-mail ou senha incorretos.");
        me = { uid: u.uid, name: u.name, email }; sessionStorage.setItem("cabdemo_me", JSON.stringify(me)); return me;
      },
      async signOut() { sessionStorage.removeItem("cabdemo_me"); me = null; },
      async createRoom(name) {
        const r = rooms(), A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let code;
        do { code = Array.from({ length: 6 }, () => A[Math.floor(Math.random() * A.length)]).join(""); } while (Object.values(r).some((x) => x.code === code));
        const id = uuid(); r[id] = { id, code, name: name || "Minha sala", owner: me.uid, state: {}, members: { [me.uid]: "dj" }, updated: new Date().toISOString() }; S("rooms", r);
        return { id, code };
      },
      async joinRoom(code, role) {
        const r = rooms(), room = Object.values(r).find((x) => x.code === String(code).trim().toUpperCase());
        if (!room) throw new Error("Sala não encontrada. Confira o código.");
        const rl = role === "spectator" && room.owner !== me.uid ? "spectator" : "dj"; room.members[me.uid] = rl; S("rooms", r);
        return { id: room.id, name: room.name, role: rl };
      },
      async myRooms() {
        return Object.values(rooms()).filter((x) => x.members[me.uid]).map((x) => ({ id: x.id, code: x.code, name: x.name, role: x.members[me.uid], isOwner: x.owner === me.uid, updated: x.updated }))
          .sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
      },
      async getRoom(id) { const x = rooms()[id]; if (!x) throw new Error("Sala não encontrada."); return { id: x.id, code: x.code, name: x.name, owner: x.owner, state: x.state }; },
      async deleteRoom(id) { const r = rooms(); delete r[id]; S("rooms", r); },
      async leaveRoom(id) { const r = rooms(); if (r[id]) { delete r[id].members[me.uid]; S("rooms", r); } },
      async saveState(id, state) { const r = rooms(); if (r[id]) { r[id].state = state; r[id].updated = new Date().toISOString(); S("rooms", r); } },
      async timeSample() { return { rtt: 0, off: 0 }; },
      async upload(path, file) { await idbPut(path, file); },
      async download(path) { const b = await idbGet(path); if (!b) throw new Error("Música não encontrada no armazenamento."); return b; },
      async channel(roomId, meta, h) {
        const bc = new BroadcastChannel("cabdemo:" + roomId), tab = uuid(), peers = new Map();
        const emitPeers = () => h.onPeers([{ key: tab, ...meta }, ...[...peers.values()].map((p) => p.meta)]);
        const announce = () => bc.postMessage({ k: "p", tab, meta });
        bc.onmessage = (e) => {
          const m = e.data;
          if (m.k === "m") h.onMsg(m.t, m.d, m.u);
          else if (m.k === "p") { const isNew = !peers.has(m.tab); peers.set(m.tab, { meta: { key: m.tab, ...m.meta }, seen: Date.now() }); if (isNew) { emitPeers(); announce(); } }
          else if (m.k === "bye") { peers.delete(m.tab); emitPeers(); }
        };
        const hb = setInterval(() => { announce(); let ch = false; for (const [k, p] of peers) if (Date.now() - p.seen > 6000) { peers.delete(k); ch = true; } if (ch) emitPeers(); }, 2000);
        setTimeout(() => { h.onStatus && h.onStatus("SUBSCRIBED", ""); announce(); emitPeers(); }, 50);
        addEventListener("beforeunload", () => bc.postMessage({ k: "bye", tab }));
        return {
          send: (t, d) => bc.postMessage({ k: "m", t, d, u: meta.uid }),
          leave: () => { clearInterval(hb); bc.postMessage({ k: "bye", tab }); bc.close(); },
        };
      },
    };
  }

  window.createNet = async function () {
    const cfg = window.CABINE_CONFIG || {};
    const forceDemo = new URLSearchParams(location.search).has("demo");
    if (!forceDemo && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) return supabaseNet(cfg);
    return demoNet();
  };
})();
