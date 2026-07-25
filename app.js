(function () {
  "use strict";

  const MODULES = [
    { key: "tasks",    label: "TASKS",    desig: "OP-01", icon: "✓", placeholder: "Log a new directive…", hasStatus: true, kind: "list" },
    { key: "thoughts", label: "THOUGHTS", desig: "OP-02", icon: "✴", placeholder: "Capture a passing thought…", hasStatus: false, kind: "list" },
    { key: "plans",    label: "PLANS",    desig: "OP-03", icon: "⌖", placeholder: "Chart a plan…", hasStatus: true, kind: "list" },
    { key: "dreams",   label: "DREAMS",   desig: "OP-04", icon: "✦", placeholder: "Record a dream, big or small…", hasStatus: false, kind: "list" },
    { key: "projects", label: "PROJECTS", desig: "OP-05", icon: "▲", placeholder: "Initiate a new project…", hasStatus: true, kind: "list" },
    { key: "diagram",  label: "DIAGRAM",  desig: "OP-06", icon: "◈", placeholder: "", hasStatus: false, kind: "diagram" },
  ];
  const LIST_MODULES = MODULES.filter((m) => m.kind === "list");

  const SP = "personalos:"; // storage prefix
  let active = "tasks";
  let data = {};
  let audioCtx = null;
  let pinBuffer = "";
  let pinMode = "enter"; // 'enter' | 'create' | 'confirm'
  let firstPin = "";
  let usageInterval = null;

  /* ================= SOUND ================= */
  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }
    return audioCtx;
  }
  function tick(freq = 880, dur = 0.07, vol = 0.05) {
    const ctx = ensureAudio();
    if (!ctx) return;
    try {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.value = vol;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.stop(ctx.currentTime + dur);
    } catch (e) {}
  }
  function soundTap() { tick(760, 0.06, 0.04); }
  function soundConfirm() { tick(920, 0.09, 0.05); setTimeout(() => tick(1300, 0.12, 0.05), 90); }
  function soundError() { tick(220, 0.18, 0.06); }
  function soundLog() { tick(1100, 0.05, 0.04); setTimeout(() => tick(1500, 0.07, 0.04), 60); }
  // arm audio context on first user gesture (required by browsers)
  document.addEventListener("pointerdown", ensureAudio, { once: true });

  /* ================= STORAGE ================= */
  function loadAll() {
    LIST_MODULES.forEach((m) => {
      try {
        const raw = localStorage.getItem(SP + m.key);
        data[m.key] = raw ? JSON.parse(raw) : [];
      } catch (e) { data[m.key] = []; }
    });
  }
  function save(key) {
    try { localStorage.setItem(SP + key, JSON.stringify(data[key])); } catch (e) {}
  }
  function getConfig() {
    try {
      const raw = localStorage.getItem(SP + "config");
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function setConfig(cfg) {
    try { localStorage.setItem(SP + "config", JSON.stringify(cfg)); } catch (e) {}
  }

  /* ================= HASH (PIN) ================= */
  async function sha256(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /* ================= BOOT SEQUENCE ================= */
  function boot() {
    const bootScreen = document.getElementById("boot-screen");
    const pctEl = document.getElementById("boot-pct");
    const barEl = document.getElementById("boot-bar-fill");
    let pct = 0;
    const t = setInterval(() => {
      pct += Math.random() * 20;
      if (pct >= 100) {
        pct = 100;
        clearInterval(t);
        setTimeout(() => {
          bootScreen.classList.add("hidden");
          afterBoot();
        }, 250);
      }
      pctEl.textContent = Math.floor(pct) + "%";
      barEl.style.width = pct + "%";
    }, 85);
  }

  function afterBoot() {
    const cfg = getConfig();
    if (!cfg || !cfg.pinHash) {
      runSetup();
    } else {
      runLock(cfg);
    }
  }

  /* ================= SETUP FLOW ================= */
  function runSetup() {
    const screen = document.getElementById("setup-screen");
    screen.classList.remove("hidden");
    const stepName = document.getElementById("setup-step-name");
    const stepPin = document.getElementById("setup-step-pin");
    const stepBio = document.getElementById("setup-step-bio");
    const nameInput = document.getElementById("setup-name-input");

    let chosenName = "";

    document.getElementById("setup-name-next").onclick = () => {
      chosenName = (nameInput.value || "Veeru").trim() || "Veeru";
      soundConfirm();
      stepName.classList.add("hidden");
      stepPin.classList.remove("hidden");
      startPinCreate();
    };
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") document.getElementById("setup-name-next").click();
    });

    function startPinCreate() {
      pinMode = "create";
      pinBuffer = "";
      firstPin = "";
      renderPinDots("setup-pin-dots", 0);
      document.getElementById("setup-pin-hint").textContent = "Enter 4 digits";
      buildKeypad("setup-keypad", onSetupKey);
    }

    function onSetupKey(val) {
      if (val === "back") {
        pinBuffer = pinBuffer.slice(0, -1);
        renderPinDots("setup-pin-dots", pinBuffer.length);
        return;
      }
      if (pinBuffer.length >= 4) return;
      soundTap();
      pinBuffer += val;
      renderPinDots("setup-pin-dots", pinBuffer.length);
      if (pinBuffer.length === 4) {
        if (pinMode === "create") {
          firstPin = pinBuffer;
          pinBuffer = "";
          pinMode = "confirm";
          setTimeout(() => {
            renderPinDots("setup-pin-dots", 0);
            document.getElementById("setup-pin-hint").textContent = "Confirm your PIN";
          }, 150);
        } else if (pinMode === "confirm") {
          if (pinBuffer === firstPin) {
            soundConfirm();
            sha256(pinBuffer).then((hash) => {
              setConfig({ name: chosenName, pinHash: hash, bioEnabled: false });
              stepPin.classList.add("hidden");
              stepBio.classList.remove("hidden");
            });
          } else {
            soundError();
            document.getElementById("setup-pin-hint").textContent = "Didn't match — try again";
            flashError("setup-pin-dots");
            setTimeout(() => {
              pinMode = "create";
              pinBuffer = "";
              firstPin = "";
              renderPinDots("setup-pin-dots", 0);
              document.getElementById("setup-pin-hint").textContent = "Enter 4 digits";
            }, 700);
          }
        }
      }
    }

    document.getElementById("setup-bio-enable").onclick = async () => {
      const ok = await registerBiometric(chosenName);
      const cfg = getConfig();
      cfg.bioEnabled = ok;
      setConfig(cfg);
      soundConfirm();
      finishSetup(chosenName);
    };
    document.getElementById("setup-bio-skip").onclick = () => {
      soundTap();
      finishSetup(chosenName);
    };
  }

  function finishSetup(name) {
    document.getElementById("setup-screen").classList.add("hidden");
    showWelcome(name);
  }

  /* ================= LOCK FLOW ================= */
  function runLock(cfg) {
    const screen = document.getElementById("lock-screen");
    screen.classList.remove("hidden");
    const sub = document.getElementById("lock-sub");
    const pinDots = document.getElementById("lock-pin-dots");
    const keypad = document.getElementById("lock-keypad");
    const usePinBtn = document.getElementById("lock-use-pin");
    const useBioBtn = document.getElementById("lock-use-bio");

    pinDots.classList.add("hidden");
    keypad.classList.add("hidden");
    usePinBtn.classList.add("hidden");
    useBioBtn.classList.add("hidden");

    if (cfg.bioEnabled) {
      sub.textContent = "Touch the fingerprint sensor…";
      attemptBiometric().then((ok) => {
        if (ok) {
          soundConfirm();
          unlockApp(cfg);
        } else {
          sub.textContent = "Fingerprint not recognized";
          soundError();
          useBioBtn.classList.remove("hidden");
          showPinEntry(cfg);
        }
      });
      useBioBtn.onclick = () => {
        soundTap();
        sub.textContent = "Touch the fingerprint sensor…";
        attemptBiometric().then((ok) => {
          if (ok) { soundConfirm(); unlockApp(cfg); }
          else { soundError(); sub.textContent = "Fingerprint not recognized"; }
        });
      };
      usePinBtn.classList.remove("hidden");
      usePinBtn.onclick = () => { soundTap(); showPinEntry(cfg); };
    } else {
      showPinEntry(cfg);
    }

    function showPinEntry(cfg) {
      sub.textContent = "Enter your PIN";
      pinDots.classList.remove("hidden");
      keypad.classList.remove("hidden");
      pinMode = "enter";
      pinBuffer = "";
      renderPinDots("lock-pin-dots", 0);
      buildKeypad("lock-keypad", (val) => onLockKey(val, cfg));
    }

    function onLockKey(val, cfg) {
      if (val === "back") {
        pinBuffer = pinBuffer.slice(0, -1);
        renderPinDots("lock-pin-dots", pinBuffer.length);
        return;
      }
      if (pinBuffer.length >= 4) return;
      soundTap();
      pinBuffer += val;
      renderPinDots("lock-pin-dots", pinBuffer.length);
      if (pinBuffer.length === 4) {
        sha256(pinBuffer).then((hash) => {
          if (hash === cfg.pinHash) {
            soundConfirm();
            unlockApp(cfg);
          } else {
            soundError();
            flashError("lock-pin-dots");
            sub.textContent = "Incorrect PIN — try again";
            setTimeout(() => { pinBuffer = ""; renderPinDots("lock-pin-dots", 0); }, 500);
          }
        });
      }
    }
  }

  function unlockApp(cfg) {
    document.getElementById("lock-screen").classList.add("hidden");
    showWelcome(cfg.name);
  }

  /* ================= WELCOME ================= */
  function showWelcome(name) {
    const screen = document.getElementById("welcome-screen");
    document.getElementById("welcome-name").textContent = name;
    const now = new Date();
    document.getElementById("welcome-time").textContent = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) + " · " + now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    screen.classList.remove("hidden");
    setTimeout(() => {
      screen.classList.add("hidden");
      startApp(name);
    }, 1700);
  }

  /* ================= WEBAUTHN (biometric) ================= */
  function supportsWebAuthn() {
    return !!(window.PublicKeyCredential && navigator.credentials);
  }
  function randBytes(len) {
    const a = new Uint8Array(len);
    crypto.getRandomValues(a);
    return a;
  }
  async function registerBiometric(name) {
    if (!supportsWebAuthn()) return false;
    try {
      const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (!available) return false;
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge: randBytes(32),
          rp: { name: "Personal OS" },
          user: { id: randBytes(16), name: name || "user", displayName: name || "user" },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
          timeout: 60000,
        },
      });
      if (!cred) return false;
      const id = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
      const cfg = getConfig() || {};
      cfg.credId = id;
      setConfig(cfg);
      return true;
    } catch (e) {
      return false;
    }
  }
  async function attemptBiometric() {
    const cfg = getConfig();
    if (!supportsWebAuthn() || !cfg || !cfg.credId) return false;
    try {
      const idBytes = Uint8Array.from(atob(cfg.credId), (c) => c.charCodeAt(0));
      const result = await navigator.credentials.get({
        publicKey: {
          challenge: randBytes(32),
          allowCredentials: [{ id: idBytes, type: "public-key" }],
          userVerification: "required",
          timeout: 60000,
        },
      });
      return !!result;
    } catch (e) {
      return false;
    }
  }

  /* ================= PIN UI HELPERS ================= */
  function renderPinDots(containerId, filled) {
    const el = document.getElementById(containerId);
    el.innerHTML = "";
    for (let i = 0; i < 4; i++) {
      const d = document.createElement("div");
      d.className = "pin-dot" + (i < filled ? " filled" : "");
      el.appendChild(d);
    }
  }
  function flashError(containerId) {
    const el = document.getElementById(containerId);
    el.querySelectorAll(".pin-dot").forEach((d) => d.classList.add("error", "filled"));
  }
  function buildKeypad(containerId, onKey) {
    const el = document.getElementById(containerId);
    el.innerHTML = "";
    const keys = ["1","2","3","4","5","6","7","8","9","","0","back"];
    keys.forEach((k) => {
      const btn = document.createElement("div");
      if (k === "") { btn.className = "key"; btn.style.visibility = "hidden"; }
      else if (k === "back") { btn.className = "key wide"; btn.textContent = "⌫"; btn.onclick = () => onKey("back"); }
      else { btn.className = "key"; btn.textContent = k; btn.onclick = () => onKey(k); }
      el.appendChild(btn);
    });
  }

  /* ================= USAGE TRACKING ================= */
  function getUsageSeconds() {
    try { return parseInt(localStorage.getItem(SP + "usageSeconds") || "0", 10); } catch (e) { return 0; }
  }
  function addUsageSeconds(n) {
    try { localStorage.setItem(SP + "usageSeconds", String(getUsageSeconds() + n)); } catch (e) {}
  }
  function formatUsage(totalSec) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  /* ================= NAV / PANEL RENDERING ================= */
  function renderNav() {
    const nav = document.getElementById("nav-buttons");
    nav.innerHTML = "";
    MODULES.forEach((m) => {
      const btn = document.createElement("button");
      btn.className = "nav-btn" + (m.key === active ? " active" : "");
      const countTxt = m.kind === "list" ? data[m.key].length : "";
      btn.innerHTML = `
        <span class="icon">${m.icon}</span>
        <span class="txt">
          <div class="label">${m.label}</div>
          <div class="desig">${m.desig}</div>
        </span>
        <span class="count">${countTxt}</span>`;
      btn.onclick = () => { soundTap(); setActive(m.key); };
      nav.appendChild(btn);
    });

    const mnav = document.getElementById("mobile-nav");
    mnav.innerHTML = "";
    MODULES.forEach((m) => {
      const btn = document.createElement("button");
      btn.className = "mobile-nav-btn" + (m.key === active ? " active" : "");
      btn.innerHTML = `${m.icon} ${m.label}`;
      btn.onclick = () => { soundTap(); setActive(m.key); };
      mnav.appendChild(btn);
    });
  }

  function setActive(key) {
    active = key;
    renderNav();
    renderPanel();
  }

  function renderPanel() {
    const mod = MODULES.find((m) => m.key === active);
    document.getElementById("panel-icon").textContent = mod.icon;
    document.getElementById("panel-title").textContent = mod.label;

    const inputRow = document.getElementById("input-row");
    const entryList = document.getElementById("entry-list");
    const diagramWrap = document.getElementById("diagram-wrap");

    if (mod.kind === "diagram") {
      document.getElementById("panel-meta").textContent = mod.desig + " · MIND MAP";
      inputRow.classList.add("hidden");
      entryList.classList.add("hidden");
      diagramWrap.classList.remove("hidden");
      renderDiagram();
    } else {
      document.getElementById("panel-meta").textContent = `${mod.desig} · ${data[mod.key].length} LOGGED`;
      document.getElementById("entry-input").placeholder = mod.placeholder;
      inputRow.classList.remove("hidden");
      entryList.classList.remove("hidden");
      diagramWrap.classList.add("hidden");
      renderList();
    }
  }

  function renderList() {
    const mod = MODULES.find((m) => m.key === active);
    const list = document.getElementById("entry-list");
    const items = data[mod.key];
    list.innerHTML = "";
    if (!items.length) {
      list.innerHTML = `<div class="empty-state">NO ENTRIES — CHANNEL IS OPEN</div>`;
      return;
    }
    items.forEach((it) => {
      const row = document.createElement("div");
      row.className = "entry" + (it.done ? " done" : "");
      const marker = mod.hasStatus
        ? `<button class="entry-toggle" data-id="${it.id}">${it.done ? "✔" : "○"}</button>`
        : `<span class="entry-dot"></span>`;
      row.innerHTML = `${marker}<span class="entry-text">${escapeHtml(it.text)}</span><button class="entry-del" data-id="${it.id}">✕</button>`;
      list.appendChild(row);
    });
    list.querySelectorAll(".entry-toggle").forEach((b) => b.addEventListener("click", () => { soundTap(); toggleItem(active, b.dataset.id); }));
    list.querySelectorAll(".entry-del").forEach((b) => b.addEventListener("click", () => { soundTap(); deleteItem(active, b.dataset.id); }));
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  /* ================= DIAGRAM VIEW ================= */
  function renderDiagram() {
    const wrap = document.getElementById("diagram-wrap");
    const w = 480, h = 420, cx = w / 2, cy = h / 2;
    const branches = LIST_MODULES; // tasks, thoughts, plans, dreams, projects
    const radius = 150;
    const nodeColors = { tasks: "#4fd8ff", thoughts: "#ffb020", plans: "#4fd8ff", dreams: "#ffb020", projects: "#4fd8ff" };

    let svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
    // pulsing central hub rings
    svg += `<circle cx="${cx}" cy="${cy}" r="34" fill="none" stroke="rgba(79,216,255,0.25)" stroke-width="1"><animate attributeName="r" values="30;40;30" dur="3s" repeatCount="indefinite"/></circle>`;
    svg += `<circle cx="${cx}" cy="${cy}" r="22" fill="rgba(79,216,255,0.08)" stroke="rgba(255,176,32,0.5)" stroke-width="1"/>`;
    svg += `<text x="${cx}" y="${cy+4}" text-anchor="middle" class="diagram-node-label" style="font-size:10px">YOU</text>`;

    branches.forEach((m, i) => {
      const angle = (i / branches.length) * 2 * Math.PI - Math.PI / 2;
      const nx = cx + radius * Math.cos(angle);
      const ny = cy + radius * Math.sin(angle);
      const count = data[m.key].length;
      const r = 26 + Math.min(count, 8) * 2;
      const color = nodeColors[m.key] || "#4fd8ff";
      svg += `<line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="rgba(79,216,255,0.2)" stroke-width="1" stroke-dasharray="3 3"/>`;
      svg += `<circle cx="${nx}" cy="${ny}" r="${r}" fill="rgba(8,25,35,0.6)" stroke="${color}" stroke-width="1.3"/>`;
      svg += `<text x="${nx}" y="${ny-2}" text-anchor="middle" class="diagram-node-label">${m.label}</text>`;
      svg += `<text x="${nx}" y="${ny+12}" text-anchor="middle" class="diagram-node-count">${count} entries</text>`;
    });
    svg += `</svg>`;
    wrap.innerHTML = svg;
  }

  /* ================= OVERVIEW RAIL ================= */
  function renderOverview() {
    const el = document.getElementById("overview-bars");
    el.innerHTML = "";
    LIST_MODULES.forEach((m) => {
      const list = data[m.key];
      const done = list.filter((i) => i.done).length;
      const pct = m.hasStatus ? (list.length ? Math.round((done / list.length) * 100) : 0) : (list.length ? 100 : 0);
      const item = document.createElement("div");
      item.className = "overview-item";
      item.innerHTML = `<div class="overview-top"><span>${m.label}</span><span>${m.hasStatus ? done + "/" + list.length : list.length}</span></div><div class="overview-track"><div class="overview-fill" style="width:${pct}%"></div></div>`;
      el.appendChild(item);
    });
  }

  function renderRing() {
    const total = LIST_MODULES.reduce((s, m) => s + data[m.key].length, 0);
    const done = LIST_MODULES.reduce((s, m) => s + data[m.key].filter((i) => i.done).length, 0);
    const pct = total ? Math.round((done / total) * 100) : 0;
    const size = 96, r = size / 2 - 8, c = 2 * Math.PI * r;
    const offset = c - (pct / 100) * c;
    document.getElementById("ring-slot").innerHTML = `
      <div style="position:relative;width:${size}px;height:${size}px;">
        <svg width="${size}" height="${size}" style="transform:rotate(-90deg)">
          <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="rgba(79,216,255,0.12)" stroke-width="2"/>
          <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="url(#g)" stroke-width="2.5" stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round" style="transition:stroke-dashoffset 0.7s ease"/>
          <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#4fd8ff"/><stop offset="100%" stop-color="#ffb020"/></linearGradient></defs>
        </svg>
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
          <span style="font-family:Orbitron,sans-serif;font-size:19px;font-weight:700;color:#67e0ff;">${pct}%</span>
          <span style="font-size:8px;letter-spacing:0.2em;color:rgba(79,216,255,0.5);">SYNCED</span>
        </div>
      </div>`;
  }

  /* ================= STAT WIDGET (bottom-left gauges) ================= */
  function renderStatWidget() {
    const el = document.getElementById("stat-widget");
    const now = new Date();
    const hourPct = Math.round(((now.getHours() % 12 || 12) / 12) * 100);
    const usageSec = getUsageSeconds();
    const usagePct = Math.min(100, Math.round((usageSec / 3600) * 100)); // fills over 1hr of use
    el.innerHTML = gauge("TIME", now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }), hourPct, "#4fd8ff") +
                    gauge("USAGE", formatUsage(usageSec), usagePct, "#ffb020");
  }
  function gauge(label, value, pct, color) {
    const size = 46, r = size / 2 - 4, c = 2 * Math.PI * r;
    const offset = c - (pct / 100) * c;
    return `<div class="stat-gauge">
      <svg width="${size}" height="${size}" style="transform:rotate(-90deg)">
        <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="rgba(79,216,255,0.12)" stroke-width="2"/>
        <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round" style="transition:stroke-dashoffset 0.6s ease"/>
      </svg>
      <div class="stat-gauge-label">${label}</div>
      <div class="stat-gauge-value">${value}</div>
    </div>`;
  }

  /* ================= MUTATIONS ================= */
  function addItem() {
    const input = document.getElementById("entry-input");
    const text = input.value.trim();
    if (!text) return;
    const item = { id: Date.now() + "-" + Math.random().toString(36).slice(2, 7), text, done: false, createdAt: new Date().toISOString() };
    data[active].unshift(item);
    save(active);
    input.value = "";
    soundLog();
    renderAll();
  }
  function toggleItem(key, id) {
    data[key] = data[key].map((it) => (it.id === id ? { ...it, done: !it.done } : it));
    save(key);
    renderAll();
  }
  function deleteItem(key, id) {
    data[key] = data[key].filter((it) => it.id !== id);
    save(key);
    renderAll();
  }

  function renderAll() {
    renderNav();
    renderPanel();
    renderOverview();
    renderRing();
  }

  /* ================= CLOCK ================= */
  function tickClock() {
    const el = document.getElementById("clock");
    function update() {
      const now = new Date();
      const date = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "2-digit" }).toUpperCase();
      const time = now.toLocaleTimeString(undefined, { hour12: false });
      el.textContent = date + " · " + time;
      renderStatWidget();
    }
    update();
    setInterval(update, 1000);
  }

  function applyStoredLayout() {
    try {
      const pref = localStorage.getItem(SP + "layout");
      if (pref === "horizontal") document.body.classList.add("horizontal-mode");
    } catch (e) {}
  }

  /* ================= APP START ================= */
  function startApp(name) {
    loadAll();
    document.getElementById("app").classList.remove("hidden");
    document.getElementById("topbar-user").textContent = name.toUpperCase();
    tickClock();
    renderAll();

    document.getElementById("log-btn").addEventListener("click", addItem);
    document.getElementById("entry-input").addEventListener("keydown", (e) => { if (e.key === "Enter") addItem(); });

    // layout toggle (horizontal / vertical)
    applyStoredLayout();
    document.getElementById("rotate-btn").addEventListener("click", () => {
      soundTap();
      const isHoriz = document.body.classList.toggle("horizontal-mode");
      try { localStorage.setItem(SP + "layout", isHoriz ? "horizontal" : "vertical"); } catch (e) {}
    });

    document.getElementById("lock-now-btn").addEventListener("click", () => {
      soundTap();
      clearInterval(usageInterval);
      document.getElementById("app").classList.add("hidden");
      const cfg = getConfig();
      runLock(cfg);
    });

    // usage tracking: tick every 5s while tab visible
    usageInterval = setInterval(() => {
      if (document.visibilityState === "visible") addUsageSeconds(5);
    }, 5000);
    window.addEventListener("beforeunload", () => addUsageSeconds(1));
  }

  boot();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch((e) => console.warn("SW failed", e));
    });
  }
})();
