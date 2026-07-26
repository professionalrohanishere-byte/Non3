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

  const SECRET_MODULES = [
    { key: "diary", label: "MY DIARY", placeholder: "Write something…" },
    { key: "stories", label: "MY STORIES", placeholder: "Write your story…" },
  ];
  let secretActive = "diary";
  let secretData = { diary: [], storyFolders: [] };
  let currentFolderId = null;

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
    try {
      const raw = localStorage.getItem(SP + "secret_diary");
      secretData.diary = raw ? JSON.parse(raw) : [];
    } catch (e) { secretData.diary = []; }
    try {
      const raw = localStorage.getItem(SP + "secret_storyfolders");
      if (raw) {
        secretData.storyFolders = JSON.parse(raw);
      } else {
        // migrate old flat "stories" list into a default folder, if it exists
        const oldRaw = localStorage.getItem(SP + "secret_stories");
        const oldItems = oldRaw ? JSON.parse(oldRaw) : [];
        secretData.storyFolders = oldItems.length ? [{ id: uid(), name: "General", items: oldItems }] : [];
      }
    } catch (e) { secretData.storyFolders = []; }
  }
  function saveSecretDiary() { try { localStorage.setItem(SP + "secret_diary", JSON.stringify(secretData.diary)); } catch (e) {} }
  function saveSecretFolders() { try { localStorage.setItem(SP + "secret_storyfolders", JSON.stringify(secretData.storyFolders)); } catch (e) {} }
  function uid() { return Date.now() + "-" + Math.random().toString(36).slice(2, 7); }
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
    el.classList.add("radial-keypad");
    const size = 250, cx = size / 2, cy = size / 2, radius = 96;
    const digits = ["1","2","3","4","5","6","7","8","9","0"];
    el.style.width = size + "px";
    el.style.height = size + "px";

    digits.forEach((k, i) => {
      const angle = (i / digits.length) * 2 * Math.PI - Math.PI / 2;
      const x = cx + radius * Math.cos(angle);
      const y = cy + radius * Math.sin(angle);
      const btn = document.createElement("div");
      btn.className = "key radial";
      btn.textContent = k;
      btn.style.left = x + "px";
      btn.style.top = y + "px";
      btn.onclick = () => onKey(k);
      el.appendChild(btn);
    });

    // center back/delete button
    const back = document.createElement("div");
    back.className = "key radial center";
    back.textContent = "⌫";
    back.style.left = cx + "px";
    back.style.top = cy + "px";
    back.onclick = () => onKey("back");
    el.appendChild(back);

    // decorative outer dial ring
    const ring = document.createElement("div");
    ring.className = "keypad-ring";
    el.appendChild(ring);
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
        <span class="orb">${m.icon}${countTxt !== "" ? `<span class="count">${countTxt}</span>` : ""}</span>
        <span class="label">${m.label}</span>`;
      btn.onclick = () => { soundTap(); setActive(m.key); };
      nav.appendChild(btn);
    });

    const mnav = document.getElementById("mobile-nav");
    mnav.innerHTML = "";
    MODULES.forEach((m) => {
      const btn = document.createElement("button");
      btn.className = "mobile-nav-btn" + (m.key === active ? " active" : "");
      btn.innerHTML = `<span class="orb">${m.icon}</span><span class="label">${m.label}</span>`;
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
      row.innerHTML = `${marker}<span class="entry-text" data-id="${it.id}">${escapeHtml(it.text)}</span><button class="entry-edit" data-id="${it.id}">✎</button><button class="entry-del" data-id="${it.id}">✕</button>`;
      list.appendChild(row);
    });
    list.querySelectorAll(".entry-toggle").forEach((b) => b.addEventListener("click", () => { soundTap(); toggleItem(active, b.dataset.id); }));
    list.querySelectorAll(".entry-del").forEach((b) => b.addEventListener("click", () => { soundTap(); deleteItem(active, b.dataset.id); }));
    list.querySelectorAll(".entry-edit").forEach((b) => b.addEventListener("click", () => { soundTap(); startEdit(b.dataset.id); }));
  }

  function startEdit(id) {
    const mod = MODULES.find((m) => m.key === active);
    const item = data[active].find((it) => it.id === id);
    if (!item) return;
    const span = document.querySelector(`.entry-text[data-id="${id}"]`);
    if (!span) return;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "entry-edit-input";
    input.value = item.text;
    span.replaceWith(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    function commit() {
      const text = input.value.trim();
      if (text) {
        item.text = text;
        save(active);
      }
      renderAll();
    }
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { soundLog(); commit(); }
      if (e.key === "Escape") renderAll();
    });
    input.addEventListener("blur", commit);
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  /* ================= DIAGRAM VIEW (pannable + zoomable) ================= */
  let diagramState = { x: 0, y: 0, scale: 1 };
  let diagramPointers = new Map();
  let diagramPanStart = null;
  let diagramPinchDist = null;
  let diagramInteractionsBound = false;

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function renderDiagram() {
    const wrap = document.getElementById("diagram-wrap");
    const w = 480, h = 420, cx = w / 2, cy = h / 2;
    const branches = LIST_MODULES;
    const radius = 150;
    const nodeColors = { tasks: "#4fd8ff", thoughts: "#ffb020", plans: "#4fd8ff", dreams: "#ffb020", projects: "#4fd8ff" };

    let inner = "";
    inner += `<circle cx="${cx}" cy="${cy}" r="34" fill="none" stroke="rgba(79,216,255,0.25)" stroke-width="1"><animate attributeName="r" values="30;40;30" dur="3s" repeatCount="indefinite"/></circle>`;
    inner += `<circle cx="${cx}" cy="${cy}" r="22" fill="rgba(79,216,255,0.08)" stroke="rgba(255,176,32,0.5)" stroke-width="1"/>`;
    inner += `<text x="${cx}" y="${cy+4}" text-anchor="middle" class="diagram-node-label" style="font-size:10px">YOU</text>`;

    branches.forEach((m, i) => {
      const angle = (i / branches.length) * 2 * Math.PI - Math.PI / 2;
      const nx = cx + radius * Math.cos(angle);
      const ny = cy + radius * Math.sin(angle);
      const count = data[m.key].length;
      const r = 26 + Math.min(count, 8) * 2;
      const color = nodeColors[m.key] || "#4fd8ff";
      inner += `<line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="rgba(79,216,255,0.2)" stroke-width="1" stroke-dasharray="3 3"/>`;
      inner += `<circle cx="${nx}" cy="${ny}" r="${r}" fill="rgba(8,25,35,0.6)" stroke="${color}" stroke-width="1.3"/>`;
      inner += `<text x="${nx}" y="${ny-2}" text-anchor="middle" class="diagram-node-label">${m.label}</text>`;
      inner += `<text x="${nx}" y="${ny+12}" text-anchor="middle" class="diagram-node-count">${count} entries</text>`;
    });

    wrap.innerHTML = `
      <div class="diagram-hint">DRAG TO PAN · PINCH OR SCROLL TO ZOOM</div>
      <button class="diagram-reset" id="diagram-reset">RESET VIEW</button>
      <svg id="diagram-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
        <g id="diagram-viewport" transform="translate(${diagramState.x},${diagramState.y}) scale(${diagramState.scale})">${inner}</g>
      </svg>`;

    document.getElementById("diagram-reset").onclick = () => {
      soundTap();
      diagramState = { x: 0, y: 0, scale: 1 };
      applyDiagramTransform();
    };

    bindDiagramInteractions();
  }

  function applyDiagramTransform() {
    const g = document.getElementById("diagram-viewport");
    if (g) g.setAttribute("transform", `translate(${diagramState.x},${diagramState.y}) scale(${diagramState.scale})`);
  }

  function bindDiagramInteractions() {
    const wrap = document.getElementById("diagram-wrap");
    if (!wrap) return;
    wrap.style.touchAction = "none";

    wrap.onpointerdown = (e) => {
      wrap.setPointerCapture(e.pointerId);
      diagramPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (diagramPointers.size === 1) {
        diagramPanStart = { x: e.clientX, y: e.clientY, ox: diagramState.x, oy: diagramState.y };
      } else if (diagramPointers.size === 2) {
        const pts = Array.from(diagramPointers.values());
        diagramPinchDist = dist(pts[0], pts[1]);
      }
    };
    wrap.onpointermove = (e) => {
      if (!diagramPointers.has(e.pointerId)) return;
      diagramPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (diagramPointers.size === 1 && diagramPanStart) {
        diagramState.x = diagramPanStart.ox + (e.clientX - diagramPanStart.x);
        diagramState.y = diagramPanStart.oy + (e.clientY - diagramPanStart.y);
        applyDiagramTransform();
      } else if (diagramPointers.size === 2) {
        const pts = Array.from(diagramPointers.values());
        const d = dist(pts[0], pts[1]);
        if (diagramPinchDist) {
          diagramState.scale = clamp(diagramState.scale * (d / diagramPinchDist), 0.4, 3.5);
        }
        diagramPinchDist = d;
        applyDiagramTransform();
      }
    };
    function endPointer(e) {
      diagramPointers.delete(e.pointerId);
      if (diagramPointers.size < 2) diagramPinchDist = null;
      if (diagramPointers.size === 0) diagramPanStart = null;
    }
    wrap.onpointerup = endPointer;
    wrap.onpointercancel = endPointer;
    wrap.onpointerleave = endPointer;

    wrap.onwheel = (e) => {
      e.preventDefault();
      diagramState.scale = clamp(diagramState.scale * (e.deltaY > 0 ? 0.9 : 1.1), 0.4, 3.5);
      applyDiagramTransform();
    };
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

  function spawnAmbientParticles() {
    const field = document.getElementById("ambient-field");
    if (!field) return;
    const count = 22;
    let html = "";
    for (let i = 0; i < count; i++) {
      const left = Math.random() * 100;
      const dur = 8 + Math.random() * 14;
      const delay = Math.random() * 12;
      html += `<span style="left:${left}%; bottom:-10px; animation-duration:${dur}s; animation-delay:${delay}s;"></span>`;
    }
    field.innerHTML = html;
  }

  /* ================= SECRET ARCHIVE (hidden diary/stories) ================= */
  function renderSecretPanel() {
    document.querySelectorAll(".secret-nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.secret === secretActive));
    const content = document.getElementById("secret-content");
    if (secretActive === "diary") { currentFolderId = null; renderDiarySection(content); }
    else if (currentFolderId) { renderFolderContents(content); }
    else { renderFolderList(content); }
  }

  function renderDiarySection(content) {
    const items = secretData.diary;
    content.innerHTML = `
      <div class="input-row"><input id="diary-input" type="text" placeholder="Write something…" autocomplete="off" /><button id="diary-log-btn"><span class="plus">+</span></button></div>
      <div class="entry-list" id="diary-list"></div>`;
    const list = document.getElementById("diary-list");
    if (!items.length) { list.innerHTML = `<div class="empty-state">NOTHING HERE YET</div>`; }
    else {
      items.forEach((it) => {
        const row = document.createElement("div");
        row.className = "entry";
        row.innerHTML = `<span class="entry-dot"></span><span class="entry-text" data-id="${it.id}">${escapeHtml(it.text)}</span><button class="entry-edit" data-id="${it.id}">✎</button><button class="entry-del" data-id="${it.id}">✕</button>`;
        list.appendChild(row);
      });
      list.querySelectorAll(".entry-del").forEach((b) => b.addEventListener("click", () => {
        soundTap(); secretData.diary = secretData.diary.filter((it) => it.id !== b.dataset.id); saveSecretDiary(); renderSecretPanel();
      }));
      list.querySelectorAll(".entry-edit").forEach((b) => b.addEventListener("click", () => {
        soundTap(); startInlineEdit(list.querySelector(`.entry-text[data-id="${b.dataset.id}"]`), secretData.diary, b.dataset.id, saveSecretDiary);
      }));
    }
    document.getElementById("diary-log-btn").onclick = () => {
      const input = document.getElementById("diary-input");
      const text = input.value.trim(); if (!text) return;
      secretData.diary.unshift({ id: uid(), text, createdAt: new Date().toISOString() });
      saveSecretDiary(); input.value = ""; soundLog(); renderSecretPanel();
    };
    document.getElementById("diary-input").addEventListener("keydown", (e) => { if (e.key === "Enter") document.getElementById("diary-log-btn").click(); });
  }

  function renderFolderList(content) {
    const folders = secretData.storyFolders;
    content.innerHTML = `
      <div class="input-row"><input id="folder-input" type="text" placeholder="New folder name…" autocomplete="off" /><button id="folder-add-btn"><span class="plus">+</span></button></div>
      <div class="entry-list" id="folder-list"></div>`;
    const list = document.getElementById("folder-list");
    if (!folders.length) { list.innerHTML = `<div class="empty-state">NO FOLDERS YET — CREATE ONE ABOVE</div>`; }
    else {
      folders.forEach((f) => {
        const row = document.createElement("div");
        row.className = "entry folder-row";
        row.innerHTML = `<span class="entry-dot"></span><span class="entry-text" data-folder="${f.id}">${escapeHtml(f.name)}</span><span class="entry-sub-count">${f.items.length}</span><button class="entry-del" data-delfolder="${f.id}">✕</button>`;
        list.appendChild(row);
      });
      list.querySelectorAll("[data-folder]").forEach((el) => el.addEventListener("click", () => { soundTap(); currentFolderId = el.dataset.folder; renderSecretPanel(); }));
      list.querySelectorAll("[data-delfolder]").forEach((b) => b.addEventListener("click", (e) => {
        e.stopPropagation(); soundTap();
        secretData.storyFolders = secretData.storyFolders.filter((f) => f.id !== b.dataset.delfolder);
        saveSecretFolders(); renderSecretPanel();
      }));
    }
    document.getElementById("folder-add-btn").onclick = () => {
      const input = document.getElementById("folder-input");
      const name = input.value.trim(); if (!name) return;
      secretData.storyFolders.unshift({ id: uid(), name, items: [] });
      saveSecretFolders(); input.value = ""; soundGoodSecret(); renderSecretPanel();
    };
    document.getElementById("folder-input").addEventListener("keydown", (e) => { if (e.key === "Enter") document.getElementById("folder-add-btn").click(); });
  }

  function renderFolderContents(content) {
    const folder = secretData.storyFolders.find((f) => f.id === currentFolderId);
    if (!folder) { currentFolderId = null; renderFolderList(content); return; }
    content.innerHTML = `
      <div class="folder-header"><button class="back-btn" id="folder-back-btn">←</button><span class="folder-header-name">${escapeHtml(folder.name)}</span></div>
      <div class="input-row"><input id="story-input" type="text" placeholder="Write inside this folder…" autocomplete="off" /><button id="story-add-btn"><span class="plus">+</span></button></div>
      <div class="entry-list" id="story-list"></div>`;
    const list = document.getElementById("story-list");
    if (!folder.items.length) { list.innerHTML = `<div class="empty-state">NOTHING HERE YET</div>`; }
    else {
      folder.items.forEach((it) => {
        const row = document.createElement("div");
        row.className = "entry";
        row.innerHTML = `<span class="entry-dot"></span><span class="entry-text" data-id="${it.id}">${escapeHtml(it.text)}</span><button class="entry-edit" data-id="${it.id}">✎</button><button class="entry-del" data-id="${it.id}">✕</button>`;
        list.appendChild(row);
      });
      list.querySelectorAll(".entry-del").forEach((b) => b.addEventListener("click", () => {
        soundTap(); folder.items = folder.items.filter((it) => it.id !== b.dataset.id); saveSecretFolders(); renderSecretPanel();
      }));
      list.querySelectorAll(".entry-edit").forEach((b) => b.addEventListener("click", () => {
        soundTap(); startInlineEdit(list.querySelector(`.entry-text[data-id="${b.dataset.id}"]`), folder.items, b.dataset.id, saveSecretFolders);
      }));
    }
    document.getElementById("folder-back-btn").onclick = () => { soundTap(); currentFolderId = null; renderSecretPanel(); };
    document.getElementById("story-add-btn").onclick = () => {
      const input = document.getElementById("story-input");
      const text = input.value.trim(); if (!text) return;
      folder.items.unshift({ id: uid(), text, createdAt: new Date().toISOString() });
      saveSecretFolders(); input.value = ""; soundLog(); renderSecretPanel();
    };
    document.getElementById("story-input").addEventListener("keydown", (e) => { if (e.key === "Enter") document.getElementById("story-add-btn").click(); });
  }

  function startInlineEdit(span, arr, id, saveFn) {
    if (!span) return;
    const item = arr.find((it) => it.id === id);
    if (!item) return;
    const input = document.createElement("input");
    input.type = "text"; input.className = "entry-edit-input"; input.value = item.text;
    span.replaceWith(input); input.focus(); input.setSelectionRange(input.value.length, input.value.length);
    function commit() {
      const text = input.value.trim();
      if (text) { item.text = text; saveFn(); }
      renderSecretPanel();
    }
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { soundLog(); commit(); } if (e.key === "Escape") renderSecretPanel(); });
    input.addEventListener("blur", commit);
  }

  function soundGoodSecret() { tick(900, 0.08, 0.04); setTimeout(() => tick(1300, 0.1, 0.04), 90); }

  function openSecret() {
    const overlay = document.getElementById("secret-overlay");
    overlay.classList.remove("hidden");
    overlay.classList.remove("serious");
    currentFolderId = null;
    renderSecretPanel();
    // slow dramatic theme shift, 7 seconds after unlocking
    setTimeout(() => { overlay.classList.add("serious"); }, 120);
  }
  function closeSecret() {
    const overlay = document.getElementById("secret-overlay");
    overlay.classList.add("hidden");
    overlay.classList.remove("serious");
  }

  function bindSecretGesture() {
    const title = document.getElementById("topbar-title-tap");
    if (!title) return;
    let tapCount = 0;
    let tapTimer = null;
    title.addEventListener("click", () => {
      tapCount++;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { tapCount = 0; }, 2000);
      if (tapCount >= 5) {
        tapCount = 0;
        clearTimeout(tapTimer);
        soundTap();
        openSecretGate();
      }
    });
    document.getElementById("secret-gate-cancel").addEventListener("click", () => {
      soundTap();
      document.getElementById("secret-gate-screen").classList.add("hidden");
    });
  }

  function getSecretConfig() {
    try { const r = localStorage.getItem(SP + "secretConfig"); return r ? JSON.parse(r) : null; } catch (e) { return null; }
  }
  function setSecretConfig(cfg) {
    try { localStorage.setItem(SP + "secretConfig", JSON.stringify(cfg)); } catch (e) {}
  }

  function openSecretGate() {
    const screen = document.getElementById("secret-gate-screen");
    const dotsId = "secret-gate-dots", keypadId = "secret-gate-keypad";
    const titleEl = document.getElementById("secret-gate-title");
    const subEl = document.getElementById("secret-gate-sub");
    screen.classList.remove("hidden");

    const cfg = getSecretConfig();
    let buf = "";
    let mode = cfg && cfg.pinHash ? "enter" : "create";
    let firstPin = "";

    if (mode === "create") { titleEl.textContent = "SET PRIVATE PIN"; subEl.textContent = "Create a 4-digit PIN for your diary & stories"; }
    else { titleEl.textContent = "PRIVATE ACCESS"; subEl.textContent = "Enter your secret PIN"; }
    renderPinDots(dotsId, 0);

    buildKeypad(keypadId, (val) => {
      if (val === "back") { buf = buf.slice(0, -1); renderPinDots(dotsId, buf.length); return; }
      if (buf.length >= 4) return;
      soundTap();
      buf += val;
      renderPinDots(dotsId, buf.length);
      if (buf.length === 4) {
        if (mode === "create") {
          if (!firstPin) {
            firstPin = buf; buf = "";
            setTimeout(() => { renderPinDots(dotsId, 0); subEl.textContent = "Confirm your PIN"; }, 150);
          } else if (buf === firstPin) {
            sha256(buf).then((hash) => {
              setSecretConfig({ pinHash: hash });
              soundConfirm();
              screen.classList.add("hidden");
              openSecret();
            });
          } else {
            soundError(); flashError(dotsId); subEl.textContent = "Didn't match — try again";
            setTimeout(() => { firstPin = ""; buf = ""; renderPinDots(dotsId, 0); subEl.textContent = "Create a 4-digit PIN for your diary & stories"; }, 700);
          }
        } else {
          sha256(buf).then((hash) => {
            if (hash === cfg.pinHash) {
              soundConfirm();
              screen.classList.add("hidden");
              openSecret();
            } else {
              soundError(); flashError(dotsId); subEl.textContent = "Incorrect PIN — try again";
              setTimeout(() => { buf = ""; renderPinDots(dotsId, 0); }, 500);
            }
          });
        }
      }
    });
  }

  /* ================= APP START ================= */
  function startApp(name) {
    loadAll();
    document.getElementById("app").classList.remove("hidden");
    document.getElementById("topbar-user").textContent = name.toUpperCase();
    tickClock();
    renderAll();
    spawnAmbientParticles();

    document.getElementById("log-btn").addEventListener("click", addItem);
    document.getElementById("entry-input").addEventListener("keydown", (e) => { if (e.key === "Enter") addItem(); });

    // secret archive
    bindSecretGesture();
    document.getElementById("secret-close-btn").addEventListener("click", () => { soundTap(); closeSecret(); });
    document.querySelectorAll(".secret-nav-btn").forEach((b) => b.addEventListener("click", () => {
      soundTap(); secretActive = b.dataset.secret; currentFolderId = null; renderSecretPanel();
    }));

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
