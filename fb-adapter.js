/* =====================================================================
   Magacin ambalaže – Firebase sloj
   Prijava firmenim e-mailom, uloge korisnika, baza (Firestore),
   upravljanje korisnicima i uvoz podataka iz prototipa.
   ===================================================================== */
(function () {
  "use strict";
  const CFG = window.FIREBASE_CONFIG || {};
  // Uloge se dodeljuju po glavnim menijima; svaki meni može biti "pun" (unos i izmene) ili "pregled" (samo gledanje)
  const FB_VERZIJA = "26.10.b";
  const MENIJI = [
    ["pregled", "Pregled", ["pregled"]],
    ["magacin", "Magacin ambalaže", ["unos", "stanje", "prijem", "promet", "popis", "uskl"]],
    ["ucinak", "Učinak magacionera", ["ucinak"]],
    ["sirovine", "Magacin sirovina", ["sunos", "szbirno", "sstanje", "sprijem", "spromet", "spopis", "usklsir", "srokovi"]],
    ["proizvodnja", "Proizvodnja", ["proizvodnja", "plan", "zalihe"]],
    ["nabavka", "Nabavka", ["zahtevi", "porudzbenice", "dobavljaci", "analitika", "ngrupe"]],
    ["kontrola", "Kontrola", ["kamb", "kgal"]],
    ["kuvaona", "Kuvaona", ["izdavanje"]],
    ["artikli", "Artikli", ["artikli"]]
  ];
  const POGLED_MENI = {};
  for (const [k, , vs] of MENIJI) for (const v of vs) POGLED_MENI[v] = k;
  // stara imena uloga -> novi oblik (puna prava na odgovarajući meni)
  const STARE = { magacin: ["magacin:pun", "artikli:pun"], proizvodnja: ["proizvodnja:pun", "kuvaona:pun"], nabavka: ["nabavka:pun"], sirovine: ["sirovine:pun", "kuvaona:pun"], kontrola: ["kontrola:pun"], pregled: MENIJI.map(m => m[0] + ":pregled") };
  function pravaKorisnika(k) {
    const out = {};
    for (const u of (k && k.uloge) || []) {
      if (u === "admin") { for (const [m] of MENIJI) out[m] = "pun"; continue; }
      const lista = u.indexOf(":") > 0 ? [u] : (STARE[u] || []);
      for (const x of lista) { const [m, p] = x.split(":"); if (!POGLED_MENI || !m) continue; if (out[m] !== "pun") out[m] = p === "pregled" ? "pregled" : "pun"; }
    }
    return out;
  }

  if (!CFG.apiKey || /UPISI/.test(CFG.apiKey)) {
    document.addEventListener("DOMContentLoaded", () => {
      document.body.innerHTML = '<div style="font:16px Arial;max-width:560px;margin:60px auto;padding:24px;border:2px solid #EE7D00;border-radius:12px"><h2>Aplikacija još nije povezana sa bazom</h2><p>Otvori fajl <b>firebase-config.js</b> i upiši podatke svog Firebase projekta (korak 3 u uputstvu).</p></div>';
    });
    return;
  }

  firebase.initializeApp(CFG);
  const auth = firebase.auth();
  const fs = firebase.firestore();
  try { fs.settings({ ignoreUndefinedProperties: true, merge: true }); } catch (e) {}
  fs.enablePersistence({ synchronizeTabs: true }).catch(() => {});

  let otvoriKapiju; const kapija = new Promise(r => (otvoriKapiju = r));
  let ja = null; // { uid, email, ime, uloge, odobren }

  /* ---------- baza: isti oblik kao u prototipu ---------- */
  function greska(e) {
    const x = new Error(e && e.message || String(e));
    const c = e && e.code;
    x.code = c === "permission-denied" ? "invalid_argument" : c === "resource-exhausted" ? "quota_exceeded" : c;
    return x;
  }
  // Firestore ne dozvoljava niz direktno u nizu – takvi nizovi se pakuju u {_arr: [...]}
  function enc(v, uNizu) {
    if (Array.isArray(v)) { const a = v.map(x => enc(x, true)); return uNizu ? { _arr: a } : a; }
    if (v && typeof v === "object" && !(v instanceof Date)) { const o = {}; for (const k in v) o[k] = enc(v[k], false); return o; }
    return v;
  }
  function dec(v) {
    if (Array.isArray(v)) return v.map(dec);
    if (v && typeof v === "object") { if (Array.isArray(v._arr) && Object.keys(v).length === 1) return v._arr.map(dec); const o = {}; for (const k in v) o[k] = dec(v[k]); return o; }
    return v;
  }
  const snap = s => ({ id: s.id, exists: s.exists, data: () => dec(s.data()), metadata: s.metadata });
  const omot = ref => ({
    path: ref.path,
    set: d => ref.set(enc(d)).catch(e => { throw greska(e); }),
    update: d => ref.set(enc(d), { merge: true }).catch(e => { throw greska(e); }),
    delete: () => ref.delete().catch(e => { throw greska(e); }),
    get: () => ref.get().then(snap),
    onSnapshot: (cb, err) => ref.onSnapshot(s => cb(snap(s)), e => err && err(greska(e)))
  });
  const upit = (q, putanja) => ({
    limit: n => upit(q.limit(n), putanja),
    doc: id => omot(fs.collection(putanja).doc(id)),
    onSnapshot: (cb, err) => q.onSnapshot(s => cb({ docs: s.docs.map(snap), size: s.size, empty: s.empty }), e => err && err(greska(e)))
  });
  const dbApi = { doc: p => omot(fs.doc(p)), collection: c => upit(fs.collection(c), c) };

  const userApi = {
    id: async () => ja.uid,
    me: async () => ({ id: ja.uid, name: ja.ime || ja.email, avatarUrl: null }),
    canEdit: async () => ja.uloge.includes("admin"),
    list: async () => {
      try {
        const sn = await fs.collection("korisnici").get();
        return sn.docs.filter(d => d.data().odobren).map(d => ({ id: d.id, ime: d.data().ime || d.data().email || d.id, admin: (d.data().uloge || []).includes("admin") }));
      } catch (e) { return []; }
    },
    profiles: async ids => {
      const out = {};
      await Promise.all(ids.map(async id => { try { const s = await fs.collection("korisnici").doc(id).get(); if (s.exists) out[id] = { id, name: s.data().ime || s.data().email }; } catch (e) {} }));
      return out;
    }
  };
  const dlApi = {
    save: async ({ filename, data }) => {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      return { ok: true };
    }
  };
  window.claude = { use: async n => { await kapija; return n === "db" ? dbApi : n === "user" ? userApi : n === "downloads" ? dlApi : null; } };

  /* ntfy – slanje obaveštenja na telefone (radi i kad je aplikacija zatvorena) */
  window.NTFY = null;
  window.ntfyPosalji = async (kanal, naslov, poruka, prioritet, tagovi) => {
    const n = window.NTFY; if (!n || !n.tema || !n.server) return;
    try {
      await fetch(n.server.replace(/\/+$/, ""), { method: "POST", body: JSON.stringify({ topic: n.tema + "-" + kanal, title: naslov, message: poruka, priority: prioritet || 3, tags: tagovi || [], click: location.href.split("#")[0] }) });
    } catch (e) {}
  };
  window.ntfyMojaTema = () => { const n = window.NTFY; return n && n.tema && ja ? n.tema + "-lk-" + String(ja.uid).replace(/[^A-Za-z0-9]/g, "").slice(-12).toLowerCase() : ""; };
  kapija.then(() => fs.doc("sistem/ntfy").onSnapshot(d => { const x = d.exists ? d.data() : null; window.NTFY = x && x.tema ? x : null; }, () => {}));

  window.PRAVO = v => {
    if (!ja) return null;
    const m = POGLED_MENI[v]; if (!m) return null;
    return pravaKorisnika(ja)[m] || null;
  };
  window.DOZVOLE = v => !!window.PRAVO(v);

  /* ---------- ekran za prijavu ---------- */
  const css = `
  #fbL{position:fixed;inset:0;z-index:100;background:var(--bg,#EEF1F4);display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto}
  #fbL .box{background:var(--surface,#fff);color:var(--ink,#16202A);border:1px solid var(--line,#D5DCE3);border-top:5px solid #EE7D00;border-radius:14px;padding:26px 24px;width:min(420px,100%);font:15px/1.45 "IBM Plex Sans",Arial,sans-serif}
  #fbL img{height:34px;display:block;margin-bottom:12px}
  #fbL h1{font:600 22px "Barlow Semi Condensed",Arial;margin:0 0 4px}
  #fbL p{margin:6px 0 14px;color:var(--muted,#5B6875);font-size:14px}
  #fbL label{display:block;font-size:12px;color:var(--muted,#5B6875);margin:10px 0 4px}
  #fbL input{width:100%;box-sizing:border-box;border:1px solid var(--line,#D5DCE3);border-radius:8px;padding:11px 12px;font:inherit;background:var(--surface,#fff);color:inherit}
  #fbL button{width:100%;margin-top:14px;border:0;border-radius:9px;padding:12px;font:600 16px Arial;background:#EE7D00;color:#fff;cursor:pointer}
  #fbL button.sek{background:transparent;color:var(--ink,#16202A);border:1px solid var(--line,#D5DCE3);font-weight:500;font-size:14px}
  #fbL .lnk{background:none;border:0;color:#1F5FA8;padding:4px 0;margin-top:8px;font:14px Arial;width:auto;text-decoration:underline}
  #fbL .msg{margin-top:12px;font-size:14px;color:#B8322A;min-height:1em}
  #fbL .ok{color:#1E7A4C}
  #fbA{position:fixed;inset:0;z-index:90;background:rgba(10,15,20,.45);display:flex;align-items:flex-start;justify-content:center;padding:30px 12px;overflow:auto}
  #fbA .box{background:var(--surface,#fff);color:var(--ink);border-radius:14px;width:min(900px,100%);padding:20px 22px;font:14px "IBM Plex Sans",Arial}
  #fbA table{width:100%;border-collapse:collapse} #fbA td,#fbA th{padding:8px 6px;border-bottom:1px solid var(--line-2,#E6EBF0);text-align:left;vertical-align:top}
  #fbA .ul{display:flex;flex-wrap:wrap;gap:6px 12px} #fbA .ul label{display:inline-flex;gap:4px;align-items:center;white-space:nowrap}
  #fbA .mprava{border-collapse:collapse;margin-top:6px} #fbA .mprava td{padding:2px 8px 2px 0;border:0;white-space:nowrap;font-size:13px} #fbA .mprava select{padding:2px 4px;font:inherit}
  .fbUser{display:flex;gap:8px;align-items:center}
  .fbUser button{border:1px solid var(--line);background:var(--surface);border-radius:6px;padding:4px 10px;font:13px Arial;cursor:pointer;color:var(--ink)}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  let mod = "prijava";
  function logoSrc() { const i = document.querySelector(".brand img"); return i ? i.src : ""; }
  function ekran(html) {
    let el = document.getElementById("fbL");
    if (!el) { el = document.createElement("div"); el.id = "fbL"; document.body.appendChild(el); }
    el.innerHTML = '<div class="box"><img src="' + logoSrc() + '" alt="Nevena">' + html + "</div>";
    return el;
  }
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const poruka = (t, ok) => { const m = document.querySelector("#fbL .msg"); if (m) { m.textContent = t; m.className = "msg" + (ok ? " ok" : ""); } };
  // korisničko ime -> interna adresa za Firebase (korisnik je nikad ne vidi)
  const DOMEN_INTERNI = "magacin-nevena.app";
  function slug(ime) {
    return String(ime || "").toLowerCase().replace(/đ/g, "dj").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "").slice(0, 60);
  }
  const adresa = ime => slug(ime) + "@" + DOMEN_INTERNI;
  function prevod(e) {
    const c = e && e.code || "";
    return ({
      "auth/user-not-found": "Ne postoji korisnik sa tim imenom – proveri kako si upisao ime ili se registruj.",
      "auth/wrong-password": "Pogrešna lozinka.",
      "auth/invalid-credential": "Pogrešno ime i prezime ili lozinka.",
      "auth/invalid-login-credentials": "Pogrešno ime i prezime ili lozinka.",
      "auth/email-already-in-use": "Korisnik sa tim imenom i prezimenom već postoji. Prijavi se, ili (ako je u pitanju druga osoba) dodaj srednje slovo, npr. „Marko P. Petrović“.",
      "auth/weak-password": "Lozinka mora imati bar 6 znakova.",
      "auth/too-many-requests": "Previše pokušaja. Sačekaj nekoliko minuta.",
      "auth/network-request-failed": "Nema internet veze.",
      "permission-denied": "Ključ za registraciju nije ispravan."
    })[c] || ("Greška: " + (e && e.message || c));
  }

  let registracijaUToku = false;
  function formaPrijave() {
    const reg = mod === "registracija";
    ekran("<h1>" + (reg ? "Registracija" : "Magacin ambalaže") + "</h1><p>" + (reg ? "Upiši ime i prezime, ključ za registraciju koji si dobio od administratora i izaberi svoju lozinku. Posle registracije administrator ti dodeljuje pristup." : "Prijavi se imenom i prezimenom i svojom lozinkom.") + "</p>" +
      '<label>Ime i prezime</label><input id="fbIme" autocomplete="username" autocapitalize="words" placeholder="npr. Marko Petrović">' +
      (reg ? '<label>Ključ za registraciju</label><input id="fbKlj" type="password" autocomplete="off">' : "") +
      '<label>' + (reg ? "Izaberi lozinku (bar 6 znakova)" : "Lozinka") + '</label><input id="fbPw" type="password" autocomplete="' + (reg ? "new-password" : "current-password") + '">' +
      (reg ? '<label>Ponovi lozinku</label><input id="fbPw2" type="password" autocomplete="new-password">' : "") +
      '<button id="fbGo">' + (reg ? "Registruj se" : "Prijavi se") + '</button><div class="msg"></div>' +
      '<button class="lnk" id="fbMod">' + (reg ? "Već imaš nalog? Prijavi se" : "Nemaš nalog? Registruj se") + "</button>" +
      (reg ? "" : '<p style="font-size:12px;margin-top:10px">Zaboravljena lozinka: javi se administratoru – on briše stari nalog, a ti se ponovo registruješ.</p>'));
    const go = async () => {
      const ime = document.getElementById("fbIme").value.replace(/\s+/g, " ").trim(), pw = document.getElementById("fbPw").value;
      if (ime.split(" ").length < 2 || slug(ime).length < 3) { poruka("Upiši ime i prezime."); return; }
      if (!reg) { try { await auth.signInWithEmailAndPassword(adresa(ime), pw); } catch (e) { poruka(prevod(e)); } return; }
      const klj = document.getElementById("fbKlj").value;
      if (!klj) { poruka("Upiši ključ za registraciju."); return; }
      if (pw.length < 6) { poruka("Lozinka mora imati bar 6 znakova."); return; }
      if (pw !== document.getElementById("fbPw2").value) { poruka("Lozinke se ne poklapaju."); return; }
      registracijaUToku = true; poruka("Registracija…", true);
      let c = null;
      try {
        c = await auth.createUserWithEmailAndPassword(adresa(ime), pw);
        await c.user.updateProfile({ displayName: ime });
        const uid = c.user.uid, t = new Date().toISOString();
        const osnova = { ime, korisnik: slug(ime), uloge: [], odobren: false, t };
        const sis = await fs.doc("sistem/podesavanja").get().catch(() => null);
        const b = fs.batch();
        b.set(fs.doc("kljucevi/" + uid), { k: klj, t });
        if (sis && !sis.exists) {
          // prvi korisnik u sistemu: postaje administrator i postavlja ključ za registraciju
          b.set(fs.doc("tajne/kljuc"), { k: klj, t });
          b.set(fs.doc("korisnici/" + uid), Object.assign({}, osnova, { uloge: ["admin"], odobren: true }));
          b.set(fs.doc("sistem/podesavanja"), { prviAdmin: uid, t });
        } else b.set(fs.doc("korisnici/" + uid), osnova);
        await b.commit();
        registracijaUToku = false;
        nakonPrijave(c.user);
      } catch (e) {
        registracijaUToku = false;
        if (c && c.user) { try { await c.user.delete(); } catch (x) {} }
        mod = "registracija"; formaPrijave();
        document.getElementById("fbIme").value = ime;
        poruka(prevod(e));
      }
    };
    document.getElementById("fbGo").onclick = go;
    for (const id of ["fbPw", "fbPw2"]) { const el = document.getElementById(id); if (el) el.onkeydown = e => { if (e.key === "Enter") go(); }; }
    document.getElementById("fbMod").onclick = () => { mod = reg ? "prijava" : "registracija"; formaPrijave(); };
  }
  function cekaOdobrenje(k) {
    ekran("<h1>Čeka se odobrenje</h1><p>Nalog <b>" + esc(k.ime || "") + "</b> je napravljen. Administrator ti treba dodeliti pristup – javi mu se. Ova stranica će se sama otvoriti kad dobiješ pristup.</p>" +
      '<button class="sek" id="fbOut">Odjavi se</button>');
    document.getElementById("fbOut").onclick = () => auth.signOut();
  }

  let odjavaSlusanja = null;
  async function nakonPrijave(u) {
    if (registracijaUToku) return; // završava se u formi za registraciju
    const ref = fs.collection("korisnici").doc(u.uid);
    const s = await ref.get().catch(() => null);
    if (!s || !s.exists) {
      await auth.signOut(); mod = "registracija"; formaPrijave();
      poruka("Registracija nije završena – pokušaj ponovo sa ispravnim ključem."); return;
    }
    if (odjavaSlusanja) odjavaSlusanja();
    let prvi = true;
    odjavaSlusanja = ref.onSnapshot(d => {
      const k = d.exists ? d.data() : null;
      if (!k || !k.odobren || !(k.uloge || []).length) { if (ja) location.reload(); else cekaOdobrenje(k || { ime: u.displayName }); return; }
      const novo = Object.assign({ uid: u.uid, email: k.ime }, k);
      if (ja && JSON.stringify(ja.uloge) !== JSON.stringify(novo.uloge)) { location.reload(); return; }
      ja = novo;
      if (prvi) { prvi = false; pokreni(); }
    }, () => cekaOdobrenje({ ime: u.displayName }));
  }
  function pokreni() {
    const el = document.getElementById("fbL"); if (el) el.remove();
    otvoriKapiju();
    const who = document.querySelector(".who");
    if (who && !document.querySelector(".fbUser")) {
      const d = document.createElement("div"); d.className = "fbUser";
      d.innerHTML = (ja.uloge.includes("admin") ? '<button id="fbKor">Korisnici</button>' : "") + '<button id="fbOdj" title="' + esc(ja.ime) + '">Odjava</button>';
      who.appendChild(d);
      document.getElementById("fbOdj").onclick = async () => { await auth.signOut(); location.reload(); };
      const kb = document.getElementById("fbKor"); if (kb) kb.onclick = adminPanel;
    }
    setTimeout(() => { if (window.APP_SHOW) { const v = document.querySelector(".view.on"); window.APP_SHOW(v ? v.id.slice(2) : "unos"); } }, 0);
  }

  const kadSpremno = fn => document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn, { once: true }) : fn();
  auth.onAuthStateChanged(u => kadSpremno(() => {
    if (!u) { ja = null; formaPrijave(); return; }
    nakonPrijave(u);
  }));

  /* ---------- administracija korisnika i uvoz podataka ---------- */
  let odjavaAdmin = null;
  function adminPanel() {
    const w = document.createElement("div"); w.id = "fbA";
    w.innerHTML = '<div class="box"><div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><h2 style="margin:0;font:600 22px \'Barlow Semi Condensed\',Arial">Korisnici i pristup <span class="muted" style="font:400 12px Arial">v' + FB_VERZIJA + '</span></h2><button id="fbAX" style="margin-left:auto" class="btn">Zatvori</button></div>' +
      '<p style="color:var(--muted);margin:0 0 12px">Novi korisnici se pojave ovde posle registracije. Za svaki glavni meni izaberi <b>nema pristup</b>, <b>samo pregled</b> ili <b>unos i izmene</b>, pa uključi „Odobren“. Ono što korisnik nema, uopšte mu se ne prikazuje. Promena važi odmah.</p>' +
      '<div id="fbAL">Učitavanje…</div>' +
      '<p style="color:var(--muted);font-size:12px;margin:8px 0 0">Brisanjem korisnik gubi pristup. Da bi se ponovo registrovao pod istim imenom (npr. zaboravljena lozinka), obriši ga i u Firebase konzoli: Authentication → Users.</p>' +
      '<h3 style="margin:22px 0 6px">Ključ za registraciju</h3><p style="color:var(--muted);margin:0 0 8px">Novi korisnici se registruju imenom i prezimenom uz ovaj ključ. Promena ne utiče na postojeće korisnike.</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><input class="inp" id="fbNK" type="password" placeholder="novi ključ" style="flex:1;min-width:200px"><button class="btn" id="fbNKs">Promeni ključ</button></div>' +
      '<h3 style="margin:22px 0 6px">Obaveštenja na telefon (ntfy)</h3><p style="color:var(--muted);margin:0 0 8px">Obaveštenja o prijemu i padu ispod minimuma stižu na telefon i kad je aplikacija zatvorena, preko besplatne aplikacije <b>ntfy</b>. Naziv teme je kao lozinka – ko ga zna, dobija obaveštenja.</p>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end"><label style="font-size:12px;color:var(--muted)">Server<input class="inp" id="fbNS" value="' + esc((window.NTFY && window.NTFY.server) || "https://ntfy.sh") + '"></label>' +
      '<label style="font-size:12px;color:var(--muted)">Tema<input class="inp" id="fbNT" value="' + esc((window.NTFY && window.NTFY.tema) || "") + '" placeholder="klikni Generiši"></label><button class="btn" id="fbNG">Generiši</button></div>' +
      '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn primary" id="fbNSave">Sačuvaj</button><button class="btn" id="fbNTest">Pošalji probno obaveštenje</button><button class="btn danger" id="fbNOff">Isključi</button></div><div id="fbNInfo" style="margin-top:8px;font-size:13px"></div>' +
      '<h3 style="margin:22px 0 6px">Rezervna kopija cele baze</h3><p style="color:var(--muted);margin:0 0 8px">Besplatan Firebase plan <b>ne radi automatske kopije</b>. Preuzmi kopiju s vremena na vreme (npr. svakog petka) i sa\u010Duvaj fajl na ra\u010Dunar ili u cloud. Vra\u0107anje upisuje podatke iz kopije preko trenutnih; dokumenti kojih u kopiji nema ostaju nedirnuti (ni\u0161ta se ne bri\u0161e).</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="btn primary" id="fbBkD">Preuzmi kopiju cele baze</button><label class="btn" for="fbBkF" style="cursor:pointer">Vrati iz kopije\u2026</label><input type="file" id="fbBkF" accept=".json,application/json" style="display:none"></div>' +
      '<div id="fbBkInfo" style="margin-top:8px;font-size:12px;color:var(--muted)"></div><div id="fbBkM" style="margin-top:6px;font-size:13px"></div>' +
      '<h3 style="margin:22px 0 6px">Uvoz podataka iz prototipa</h3><p style="color:var(--muted);margin:0 0 8px">Jednokratno: izaberi fajl <b>podaci-za-prenos.json</b>. Postojeći podaci sa istim nazivima biće zamenjeni.</p>' +
      '<input type="file" id="fbImp" accept=".json,application/json"> <span id="fbImpM"></span></div>';
    document.body.appendChild(w);
    const zatvori = () => { if (odjavaAdmin) odjavaAdmin(); w.remove(); };
    w.querySelector("#fbAX").onclick = zatvori;
    w.addEventListener("click", e => { if (e.target === w) zatvori(); });
    odjavaAdmin = fs.collection("korisnici").onSnapshot(s => {
      const l = s.docs.map(d => Object.assign({ uid: d.id }, d.data())).sort((a, b) => (a.odobren - b.odobren) || String(a.ime).localeCompare(b.ime));
      w.querySelector("#fbAL").innerHTML = '<div style="overflow-x:auto"><table><thead><tr><th>Korisnik</th><th>Odobren</th><th>Uloge</th><th></th></tr></thead><tbody>' +
        l.map(k => '<tr><td><b>' + esc(k.ime) + '</b><br><span style="color:var(--muted);font-size:12px">prijava: ' + esc(k.ime) + (k.t ? " · od " + esc(new Date(k.t).toLocaleDateString("sr-Latn-RS")) : "") + "</span>" + (k.odobren ? "" : '<br><span style="color:#B8322A;font-size:12px">čeka odobrenje</span>') + "</td>" +
          '<td><input type="checkbox" data-od="' + k.uid + '"' + (k.odobren ? " checked" : "") + (k.uid === ja.uid ? " disabled" : "") + "></td>" +
          '<td><div class="ul"><label title="Sve, uključujući korisnike"><input type="checkbox" data-adm="' + k.uid + '"' + ((k.uloge || []).includes("admin") ? " checked" : "") + (k.uid === ja.uid ? " disabled" : "") + "> <b>Administrator</b></label></div>" +
          '<table class="mprava">' + MENIJI.map(([m, n]) => { const p = (pravaKorisnika(k) || {})[m] || "", adm = (k.uloge || []).includes("admin");
            return "<tr><td>" + esc(n) + '</td><td><select data-men="' + k.uid + '" data-m="' + m + '"' + (adm || k.uid === ja.uid ? " disabled" : "") + '><option value=""' + (p ? "" : " selected") + '>nema pristup</option><option value="pregled"' + (p === "pregled" ? " selected" : "") + '>samo pregled</option><option value="pun"' + (p === "pun" ? " selected" : "") + ">unos i izmene</option></select></td></tr>"; }).join("") + "</table></td>" +
          "<td>" + (k.uid === ja.uid ? "" : '<button class="btn danger" data-del="' + k.uid + '" style="padding:4px 10px">Obriši</button>') + "</td></tr>").join("") + "</tbody></table></div>";
    });
    w.addEventListener("change", async e => {
      const t = e.target;
      try {
        if (t.dataset.od) await fs.collection("korisnici").doc(t.dataset.od).update({ odobren: t.checked });
        if (t.dataset.adm || t.dataset.men) {
          const uid = t.dataset.adm || t.dataset.men;
          const adm = w.querySelector('[data-adm="' + uid + '"]').checked;
          const ul = adm ? ["admin"] : [...w.querySelectorAll('[data-men="' + uid + '"]')].filter(x => x.value).map(x => x.dataset.m + ":" + x.value);
          await fs.collection("korisnici").doc(uid).update({ uloge: ul });
        }
        if (t.id === "fbImp" && t.files[0]) uvoz(t.files[0], w.querySelector("#fbImpM"));
        if (t.id === "fbBkF" && t.files[0]) { const f = t.files[0]; t.value = ""; vratiKopiju(f, w.querySelector("#fbBkM"), w); }
      } catch (err) { alert("Promena nije sačuvana: " + err.message); }
    });
    const info = () => { const n = window.NTFY; const el = w.querySelector("#fbNInfo"); if (!el) return;
      el.innerHTML = n && n.tema ? "Za lične poruke svako se pretplaćuje na svoju temu (piše u prozoru Poruke). Na telefonu: instaliraj aplikaciju <b>ntfy</b> (Google Play / App Store), pa se pretplati na teme:<br><b>" + esc(n.tema) + "-prijem</b> (prijem materijala) i <b>" + esc(n.tema) + "-minimum</b> (pad ispod minimuma), server " + esc(n.server) + "." : "ntfy nije podešen."; };
    info();
    bkInfo(w);
    w.addEventListener("click", async e => {
      const t = e.target;
      try {
        if (t.id === "fbNK") return;
        if (t.id === "fbNKs") { const v = w.querySelector("#fbNK").value; if (v.length < 8) { alert("Ključ neka ima bar 8 znakova."); return; } await fs.doc("tajne/kljuc").set({ k: v, t: new Date().toISOString() }); w.querySelector("#fbNK").value = ""; alert("Ključ je promenjen."); return; }
        if (t.id === "fbNG") { const a = new Uint8Array(9); crypto.getRandomValues(a); w.querySelector("#fbNT").value = "nevena-magacin-" + [...a].map(x => "abcdefghijkmnpqrstuvwxyz23456789"[x % 32]).join(""); return; }
        if (t.id === "fbNSave") { const server = w.querySelector("#fbNS").value.trim().replace(/\/+$/, "") || "https://ntfy.sh", tema = w.querySelector("#fbNT").value.trim(); if (!/^[A-Za-z0-9_-]{8,64}$/.test(tema)) { alert("Tema: 8–64 znaka, samo slova, brojevi, - i _. Klikni Generiši."); return; } await fs.doc("sistem/ntfy").set({ server, tema }); window.NTFY = { server, tema }; info(); return; }
        if (t.id === "fbNOff") { await fs.doc("sistem/ntfy").set({ server: "", tema: "" }); window.NTFY = null; info(); return; }
        if (t.id === "fbBkD") { await kopijaBaze(w.querySelector("#fbBkM"), w); return; }
        if (t.id === "fbNTest") { if (!window.NTFY || !window.NTFY.tema) { alert("Prvo sačuvaj temu."); return; } await window.ntfyPosalji("prijem", "Probno obaveštenje", "Magacin ambalaže – obaveštenja rade.", 3, ["white_check_mark"]); await window.ntfyPosalji("minimum", "Probno obaveštenje", "Upozorenja o minimumu rade.", 4, ["warning"]); alert("Poslato na obe teme."); return; }
      } catch (err) { alert("Nije sačuvano: " + err.message); return; }
      const d = t.closest("[data-del]"); if (!d) return;
      if (!confirm("Obrisati korisnika? On više neće moći da pristupi aplikaciji.")) return;
      await fs.collection("korisnici").doc(d.dataset.del).delete().catch(err => alert(err.message));
    });
  }
  /* ---------- rezervna kopija cele baze ---------- */
  // Sve kolekcije koje aplikacija koristi. "tajne" i "kljucevi" se namerno ne citaju
  // (pravila to i ne dozvoljavaju) - kljuc za registraciju se podesava u ovom panelu.
  const KOLEKCIJE = ["sistem", "korisnici", "sifarnik", "stanje", "unosi", "popis", "popisi",
    "sirovine", "sirunosi", "normativi", "planovi", "potrosnja", "nabavka", "porudzbenice",
    "kontrola", "poruke", "skeniranja"];
  const dvaBroja = x => String(x).padStart(2, "0");
  const velicina = n => n < 1048576 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1048576).toFixed(2) + " MB";

  async function bkInfo(w) {
    const el = w.querySelector("#fbBkInfo"); if (!el) return;
    try {
      const sn = await fs.doc("sistem/kopija").get();
      if (!sn.exists || !sn.data().t) { el.innerHTML = '<b style="color:#B8322A">Kopija baze još nije preuzeta.</b>'; return; }
      const d = sn.data(), kada = new Date(d.t), dana = Math.floor((Date.now() - kada.getTime()) / 86400000);
      el.innerHTML = "Poslednja kopija: <b>" + esc(kada.toLocaleString("sr-Latn-RS")) + "</b>" +
        (d.ko ? " · preuzeo " + esc(d.ko) : "") + (d.n ? " · " + d.n + " dokumenata" : "") +
        (dana >= 14 ? ' <b style="color:#B8322A">(pre ' + dana + " dana – vreme je za novu)</b>" : dana >= 7 ? " (pre " + dana + " dana)" : "");
    } catch (e) { el.textContent = ""; }
  }

  async function kopijaBaze(msg, w) {
    const dugme = w.querySelector("#fbBkD"); if (dugme) dugme.disabled = true;
    msg.textContent = "Čitam bazu…";
    const docs = {}; let n = 0; const preskoceno = [];
    try {
      for (const c of KOLEKCIJE) {
        msg.textContent = "Čitam „" + c + "“… (do sada " + n + " dokumenata)";
        try {
          const sn = await fs.collection(c).get();
          sn.docs.forEach(d => { docs[c + "/" + d.id] = dec(d.data()); n++; });
        } catch (e) { preskoceno.push(c); }
      }
      if (!n) { msg.innerHTML = '<b style="color:#B8322A">Baza je prazna ili nije dostupna.</b> Pokušaj ponovo ili proveri internet vezu.'; return; }
      const dt = new Date();
      const ime = "magacin-kopija-" + dt.getFullYear() + dvaBroja(dt.getMonth() + 1) + dvaBroja(dt.getDate()) +
        "-" + dvaBroja(dt.getHours()) + dvaBroja(dt.getMinutes()) + ".json";
      const tekst = JSON.stringify({ aplikacija: "magacin-nevena", verzija: FB_VERZIJA, datum: dt.toISOString(), brojDokumenata: n, docs: docs });
      await dlApi.save({ filename: ime, data: new Blob([tekst], { type: "application/json" }) });
      msg.innerHTML = "Kopija je preuzeta: <b>" + esc(ime) + "</b> — " + n + " dokumenata, " +
        velicina(tekst.length) + ". <b>Sačuvaj fajl</b> na računar ili u cloud (Google Drive, OneDrive…)." +
        (preskoceno.length ? '<br><span style="color:#B8322A">Nije pročitano: ' + esc(preskoceno.join(", ")) + ".</span>" : "");
      try { await fs.doc("sistem/kopija").set({ t: dt.toISOString(), ko: ja && (ja.ime || ja.email) || "", n: n, ime: ime }); } catch (e) {}
      bkInfo(w);
    } catch (e) {
      msg.innerHTML = '<b style="color:#B8322A">Kopija nije napravljena.</b> ' + esc((e && e.message) || String(e));
    } finally { if (dugme) dugme.disabled = false; }
  }

  async function vratiKopiju(file, msg, w) {
    let p; try { p = JSON.parse(await file.text()); } catch (e) { msg.innerHTML = '<b style="color:#B8322A">Fajl nije ispravan JSON.</b>'; return; }
    const docs = p && p.docs;
    if (!docs || typeof docs !== "object" || Array.isArray(docs)) { msg.innerHTML = '<b style="color:#B8322A">Ovo nije fajl rezervne kopije.</b> Izaberi fajl <b>magacin-kopija-….json</b>.'; return; }
    const putanje = Object.keys(docs).filter(x => x.split("/").length === 2 && x.split("/").every(Boolean));
    if (!putanje.length) { msg.innerHTML = '<b style="color:#B8322A">U fajlu nema dokumenata.</b>'; return; }
    const kada = p.datum ? new Date(p.datum).toLocaleString("sr-Latn-RS") : "nepoznat datum";
    if (!confirm("VRAĆANJE IZ REZERVNE KOPIJE\n\nKopija je od: " + kada + "\nDokumenata u kopiji: " + putanje.length +
      "\n\nPodaci iz kopije se upisuju preko trenutnih. Sve što je u bazi promenjeno POSLE ove kopije biće izgubljeno.\n\nNastaviti?")) return;
    if (!confirm("Još jednom, za sigurnost:\n\nzameniti podatke u bazi podacima iz kopije od " + kada + "?")) return;
    let n = 0, gresaka = 0; const pali = []; let kod = "";
    for (let i = 0; i < putanje.length; i += 400) {
      const deo = putanje.slice(i, i + 400);
      msg.textContent = "Upisujem… " + n + " / " + putanje.length;
      try {
        const b = fs.batch();
        for (const pt of deo) b.set(fs.doc(pt), enc(docs[pt]));
        await b.commit(); n += deo.length;
      } catch (e) {
        // paket je pao – idemo dokument po dokument da jedan problematičan ne zaustavi ostatak
        for (const pt of deo) {
          try { await fs.doc(pt).set(enc(docs[pt])); n++; }
          catch (e2) { gresaka++; if (!kod) kod = (e2 && e2.code) || ""; if (pali.length < 6) pali.push(pt); }
        }
      }
    }
    if (gresaka) {
      msg.innerHTML = '<b style="color:#B8322A">Vraćeno ' + n + " od " + putanje.length + " dokumenata; " + gresaka + " nije upisano" + (kod ? " (" + esc(kod) + ")" : "") + ".</b> " +
        (pali.length ? "Na primer: " + esc(pali.join(", ")) + ". " : "") +
        (kod === "permission-denied"
          ? "Baza je odbila upis. U Firebase konzoli otvori <b>Firestore Database → Rules</b>, nalepi sadržaj fajla <b>firestore.rules</b> iz poslednjeg paketa i klikni <b>Publish</b>, pa pokušaj ponovo."
          : "Obrisani korisnici se ne mogu vratiti ovim putem – oni se ponovo registruju. Ostalo probaj ponovo.");
      bkInfo(w);
      return;
    }
    msg.textContent = "Vraćeno " + n + " dokumenata. Stranica se osvežava…";
    setTimeout(() => location.reload(), 1500);
  }

  async function uvoz(file, msg) {
    let p; try { p = JSON.parse(await file.text()); } catch (e) { msg.textContent = "Fajl nije ispravan JSON."; return; }
    const docs = p && p.docs ? p.docs : null; if (!docs) { msg.textContent = "Ovo nije fajl za prenos."; return; }
    const putanje = Object.keys(docs);
    if (!confirm("Uvesti " + putanje.length + " dokumenata u bazu?")) return;
    let n = 0, spojeno = 0;
    // evidencija kontrole se SPAJA (redovi upisani u aplikaciji ostaju), ostalo se zamenjuje
    for (const pt of putanje) {
      if (!/^kontrola\//.test(pt)) continue;
      try {
        const cur = await fs.doc(pt).get();
        if (!cur.exists) continue;
        const stare = dec(cur.data()).stavke || [], nove = (docs[pt].stavke || []).slice();
        const ids = new Set(nove.map(x => x.id));
        for (const r of stare) if (!ids.has(r.id)) { nove.push(r); spojeno++; }
        docs[pt] = { stavke: nove };
      } catch (e) {}
    }
    try {
      for (let i = 0; i < putanje.length; i += 400) {
        const b = fs.batch();
        for (const pt of putanje.slice(i, i + 400)) { b.set(fs.doc(pt), enc(docs[pt])); n++; }
        msg.textContent = "Upisujem… " + n + " / " + putanje.length;
        await b.commit();
      }
    } catch (e) {
      const c = (e && e.code) || "";
      msg.innerHTML = '<b style="color:#B8322A">Uvoz nije uspeo' + (c ? " (" + esc(c) + ")" : "") + ".</b> " +
        (c === "permission-denied"
          ? "Baza je odbila upis. U Firebase konzoli otvori <b>Firestore Database → Rules</b>, nalepi sadržaj fajla <b>firestore.rules</b> iz poslednjeg paketa i klikni <b>Publish</b>, pa pokušaj ponovo."
          : "Greška: " + esc((e && e.message) || String(e)) + ". Proveri internet vezu i pokušaj ponovo.");
      return;
    }
    msg.textContent = "Uvezeno " + n + " dokumenata" + (spojeno ? " (zadržano " + spojeno + " postojećih redova evidencije)" : "") + ". Stranica se osvežava…";
    setTimeout(() => location.reload(), 1500);
  }
})();
