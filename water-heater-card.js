/*! Water Heater Card — animated water-heater card for Home Assistant · MIT · github.com/stathisktm/water-heater-card */

const WH_VERSION = "2.0.0";

const WH_DEFAULTS = {
  title: "Θερμοσίφωνο",
  icon: "mdi:bathtub-outline",
  entity_switch: "",
  entity_temp: "",
  entity_power: "",
  temp_high: 42,
  temp_mid: 35,
  temp_max: 60,
  color_low: "#87CEEB",
  color_mid: "#FFA500",
  color_high: "#FF4500",
  theme: "default",
  show_graph: true,
  graph_hours: 6,
  tap_toggle: true,
};

const whBad = (v) => v === undefined || v === null || v === "" || v === "unknown" || v === "unavailable";

/** Mixes a colour toward white by [amount] 0..1. */
function whLighten(hex, amount = 0.35) {
  let c = String(hex || "").trim().replace("#", "");
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  if (c.length !== 6) return hex;
  const ch = (i) => Math.round(parseInt(c.substring(i, i + 2), 16) + (255 - parseInt(c.substring(i, i + 2), 16)) * amount);
  return `#${[ch(0), ch(2), ch(4)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** A second, darker shade of one picked colour — the gradient needs no second colour field. */
function whDarken(hex, amount = 0.3) {
  if (!hex) return hex;
  let c = String(hex).trim().replace("#", "");
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  if (c.length !== 6) return hex;
  const ch = (i) => Math.max(0, Math.min(255, Math.round(parseInt(c.substring(i, i + 2), 16) * (1 - amount))));
  return `#${[ch(0), ch(2), ch(4)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function whMinutes(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}′`;
  return `${Math.floor(m / 60)}ω ${String(m % 60).padStart(2, "0")}′`;
}

class WaterHeaterCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._history = [];
    this._historyAt = 0;
    this._holdTimer = null;
  }

  static getConfigElement() {
    return document.createElement("water-heater-card-editor");
  }

  static getStubConfig(hass) {
    const ids = Object.keys(hass?.states || {});
    const sw = ids.find((id) => id.startsWith("switch.") && /heater|thermo|boiler|sonoff/.test(id)) || "";
    const base = sw.split(".")[1] || "";
    const temp = ids.find((id) => id.startsWith("sensor.") && base && id.includes(base) && id.includes("temp")) || "";
    return { title: WH_DEFAULTS.title, icon: WH_DEFAULTS.icon, entity_switch: sw, entity_temp: temp, temp_high: 42, temp_mid: 35 };
  }

  setConfig(config) {
    if (!config) throw new Error("Λάθος ρυθμίσεις κάρτας");
    this._config = { ...WH_DEFAULTS, ...config };
    this._historyAt = 0;
    this._renderBase();
    if (this._hass) this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
    this._maybeLoadHistory();
  }

  connectedCallback() {
    this._tick = setInterval(() => this._updateClock(), 30000);
  }

  disconnectedCallback() {
    clearInterval(this._tick);
  }

  getCardSize() {
    return this._config?.show_graph === false ? 2 : 3;
  }

  getGridOptions() {
    return { columns: 6, min_columns: 4, rows: "auto" };
  }

  /* ==========================================
     RENDER
     ========================================== */

  _renderBase() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card {
          display: block; position: relative; overflow: hidden;
          border-radius: 20px; padding: 12px 14px 10px; color: #fff; cursor: pointer; user-select: none;
          box-shadow: 0 6px 20px rgba(0,0,0,.3);
          transition: transform .25s ease, box-shadow .25s ease;
          -webkit-tap-highlight-color: transparent;
        }
        ha-card:hover { box-shadow: 0 8px 25px rgba(0,0,0,.4); }
        ha-card:active { transform: scale(.985); }
        .bg { position: absolute; inset: 0; z-index: 0; background: rgba(0,0,0,.4); transition: opacity .6s ease; }
        .bg.on { opacity: 0; }
        .bg-on { position: absolute; inset: 0; z-index: 0; opacity: 0; transition: opacity .6s ease, background .6s ease; }
        .bg-on.on { opacity: 1; }
        .content { position: relative; z-index: 1; }

        /* HEADER */
        .header { display: flex; align-items: center; gap: 8px; }
        .icon-wrap { position: relative; width: 34px; height: 34px; display: grid; place-items: center; flex: none; }
        .icon-wrap ha-icon { --mdc-icon-size: 26px; transition: color .3s ease; }
        .pulse-ring { position: absolute; inset: 0; border-radius: 50%; border: 2px solid rgba(255,255,255,.6); animation: wh-pulse 2s infinite; display: none; }
        .on .pulse-ring { display: block; }
        @keyframes wh-pulse { 0% { transform: scale(.75); opacity: 1; } 100% { transform: scale(1.45); opacity: 0; } }
        .titles { min-width: 0; flex: 1; }
        .title { font-size: 15px; font-weight: 700; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .badge {
          display: inline-block; margin-top: 3px; font-size: 9px; padding: 2px 8px; border-radius: 10px;
          background: rgba(255,255,255,.22); text-transform: uppercase; letter-spacing: .5px; font-weight: 600;
        }
        .badge.ready { background: rgba(255,255,255,.92); color: #b33600; }
        .power-btn {
          width: 34px; height: 34px; flex: none; border-radius: 50%; border: 1px solid rgba(255,255,255,.22);
          background: rgba(255,255,255,.12); color: #fff; display: grid; place-items: center; cursor: pointer; padding: 0;
          transition: background .2s ease, transform .1s ease;
        }
        .power-btn ha-icon { --mdc-icon-size: 18px; }
        .power-btn:active { transform: scale(.9); }
        .on .power-btn { background: rgba(255,255,255,.28); }

        /* MAIN: temperature + tank */
        .main { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px; }
        .temp { font-size: 40px; font-weight: 700; line-height: 1; letter-spacing: -1.5px; font-variant-numeric: tabular-nums; }
        .temp small { font-size: 15px; font-weight: 500; opacity: .8; margin-left: 2px; letter-spacing: 0; }
        .rate { margin-top: 4px; font-size: 11px; opacity: .9; min-height: 14px; }
        .chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
        .chip { display: inline-flex; align-items: center; gap: 3px; font-size: 10px; padding: 3px 7px; border-radius: 8px; background: rgba(0,0,0,.18); white-space: nowrap; }
        .chip ha-icon { --mdc-icon-size: 13px; }
        .chip.hidden { display: none; }

        .tank {
          position: relative; width: 46px; height: 76px; flex: none; border-radius: 14px 14px 12px 12px; overflow: hidden;
          background: rgba(255,255,255,.14); border: 2px solid rgba(255,255,255,.55);
          box-shadow: inset 0 0 0 1px rgba(0,0,0,.12), 0 4px 10px rgba(0,0,0,.18);
        }
        .water {
          position: absolute; left: 0; right: 0; bottom: 0; height: 0; transition: height 1.2s ease, background .6s ease;
          background: linear-gradient(180deg, var(--wh-water), var(--wh-water-dark));
        }
        .water::before {
          /* gently rocking surface: a soft lighter crest sliding side to side */
          content: ""; position: absolute; left: -30%; top: -3px; width: 160%; height: 7px; border-radius: 50%;
          background: radial-gradient(ellipse at center, rgba(255,255,255,.75), rgba(255,255,255,0) 70%);
          animation: wh-wave 3.2s ease-in-out infinite alternate;
        }
        @keyframes wh-wave { from { transform: translateX(-12%); } to { transform: translateX(12%); } }
        .mark { position: absolute; left: 0; right: 0; height: 0; border-top: 1px dashed rgba(255,255,255,.75); z-index: 2; }
        .mark span { position: absolute; right: 2px; top: -9px; font-size: 7px; opacity: .85; }
        .bubble { position: absolute; bottom: -8px; width: 5px; height: 5px; border-radius: 50%; background: rgba(255,255,255,.75); opacity: 0; z-index: 1; }
        .heating .bubble { animation: wh-bubble 2.2s ease-in infinite; }
        .bubble.b1 { left: 22%; animation-delay: 0s !important; }
        .bubble.b2 { left: 55%; width: 4px; height: 4px; animation-delay: .7s !important; }
        .bubble.b3 { left: 75%; width: 3px; height: 3px; animation-delay: 1.3s !important; }
        .bubble.b4 { left: 38%; width: 3px; height: 3px; animation-delay: 1.8s !important; }
        @keyframes wh-bubble { 0% { transform: translateY(0); opacity: 0; } 15% { opacity: .9; } 100% { transform: translateY(calc(-1 * var(--wh-level, 40px))); opacity: 0; } }
        .steam { position: absolute; top: -2px; left: 50%; width: 40px; height: 30px; transform: translateX(-50%); pointer-events: none; display: none; }
        .hot .steam { display: block; }
        .steam i { position: absolute; bottom: 0; width: 6px; height: 16px; border-radius: 50%; background: rgba(255,255,255,.55); filter: blur(3px); animation: wh-steam 2.6s ease-out infinite; }
        .steam i:nth-child(1) { left: 8px; }
        .steam i:nth-child(2) { left: 18px; animation-delay: .9s; }
        .steam i:nth-child(3) { left: 27px; animation-delay: 1.7s; }
        @keyframes wh-steam { 0% { transform: translateY(6px) scaleY(.6); opacity: 0; } 30% { opacity: .8; } 100% { transform: translateY(-14px) scaleY(1.2); opacity: 0; } }
        .tank-wrap { position: relative; padding-top: 14px; }

        /* GRAPH */
        .graph { margin-top: 8px; height: 38px; position: relative; }
        .graph svg { width: 100%; height: 100%; display: block; overflow: visible; }
        .graph.hidden { display: none; }
        .graph .empty { font-size: 9px; opacity: .6; position: absolute; inset: 0; display: grid; place-items: center; }

        .warning { font-size: 11px; opacity: .85; margin-top: 6px; }
        @media (prefers-reduced-motion: reduce) { .bubble, .water::before, .steam i, .pulse-ring { animation: none !important; } }
      </style>
      <ha-card id="card">
        <div class="bg" id="bgOff"></div>
        <div class="bg-on" id="bgOn"></div>
        <div class="content" id="content">
          <div class="header">
            <div class="icon-wrap"><div class="pulse-ring"></div><ha-icon id="icon"></ha-icon></div>
            <div class="titles">
              <div class="title" id="title"></div>
              <span class="badge" id="badge"></span>
            </div>
            <button class="power-btn" id="power" type="button" title="Άναμμα / σβήσιμο"><ha-icon icon="mdi:power"></ha-icon></button>
          </div>

          <div class="main">
            <div>
              <div class="temp" id="temp">--<small>°C</small></div>
              <div class="rate" id="rate"></div>
              <div class="chips">
                <span class="chip hidden" id="onFor"><ha-icon icon="mdi:timer-outline"></ha-icon><span></span></span>
                <span class="chip hidden" id="eta"><ha-icon icon="mdi:flag-checkered"></ha-icon><span></span></span>
                <span class="chip hidden" id="watts"><ha-icon icon="mdi:flash"></ha-icon><span></span></span>
              </div>
            </div>
            <div class="tank-wrap" id="tankWrap">
              <div class="steam"><i></i><i></i><i></i></div>
              <div class="tank" id="tank">
                <div class="water" id="water"></div>
                <div class="bubble b1"></div><div class="bubble b2"></div><div class="bubble b3"></div><div class="bubble b4"></div>
                <div class="mark" id="markHigh"><span></span></div>
                <div class="mark" id="markMid"><span></span></div>
              </div>
            </div>
          </div>

          <div class="graph" id="graph"></div>
          <div class="warning" id="warning" hidden></div>
        </div>
      </ha-card>
    `;
    const card = this.shadowRoot.getElementById("card");
    // Tap = toggle (as always); hold = details.
    card.addEventListener("pointerdown", () => {
      this._held = false;
      this._holdTimer = setTimeout(() => { this._held = true; this._moreInfo(); }, 550);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((e) => card.addEventListener(e, () => clearTimeout(this._holdTimer)));
    card.addEventListener("click", (ev) => {
      if (this._held) return;
      if (ev.composedPath().some((n) => n.id === "power")) return this._toggle();
      if (this._config.tap_toggle === false) return this._moreInfo();
      this._toggle();
    });
    card.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /* ==========================================
     ACTIONS
     ========================================== */

  _toggle() {
    const id = this._config.entity_switch;
    if (!id || !this._hass) return;
    const domain = id.split(".")[0];
    this._hass.callService(["switch", "input_boolean", "light"].includes(domain) ? domain : "homeassistant", "toggle", { entity_id: id });
    this.dispatchEvent(new CustomEvent("haptic", { detail: "medium", bubbles: true, composed: true }));
  }

  _moreInfo() {
    const entityId = this._config.entity_temp || this._config.entity_switch;
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }

  /* ==========================================
     STATE
     ========================================== */

  _tempColor(t) {
    const c = this._config;
    if (t > Number(c.temp_high)) return c.color_high || WH_DEFAULTS.color_high;
    if (t > Number(c.temp_mid)) return c.color_mid || WH_DEFAULTS.color_mid;
    return c.color_low || WH_DEFAULTS.color_low;
  }

  _applyTheme(card) {
    const name = this._config.theme;
    const vars = name && name !== "default" ? this._hass?.themes?.themes?.[name] : null;
    if (!vars || this._appliedTheme === name) return;
    this._appliedTheme = name;
    Object.entries(vars).forEach(([k, v]) => { if (typeof v === "string") card.style.setProperty(`--${k}`, v); });
  }

  _update() {
    if (!this._hass || !this._config || !this.shadowRoot.getElementById("card")) return;
    const $ = (id) => this.shadowRoot.getElementById(id);
    const cfg = this._config;
    const sw = this._hass.states[cfg.entity_switch];
    const tempEnt = this._hass.states[cfg.entity_temp];
    const isOn = sw?.state === "on";
    const t = tempEnt && !whBad(tempEnt.state) ? parseFloat(tempEnt.state) : NaN;
    const has = !Number.isNaN(t);
    const high = Number(cfg.temp_high) || 42, mid = Number(cfg.temp_mid) || 35;
    const max = Math.max(Number(cfg.temp_max) || 60, high + 5);
    const color = this._tempColor(has ? t : 0);
    const ready = has && t >= high;

    const card = $("card");
    this._applyTheme(card);
    const content = $("content");
    content.classList.toggle("on", isOn);
    content.classList.toggle("heating", isOn && !ready);
    content.classList.toggle("hot", has && t >= high);

    $("bgOff").classList.toggle("on", isOn);
    const bgOn = $("bgOn");
    bgOn.style.background = `linear-gradient(135deg, ${color}, ${whDarken(color)})`;
    bgOn.classList.toggle("on", isOn);

    $("icon").setAttribute("icon", cfg.icon || WH_DEFAULTS.icon);
    $("icon").style.color = isOn ? "#fff" : color;
    $("title").textContent = cfg.title || WH_DEFAULTS.title;
    const badge = $("badge");
    badge.textContent = ready ? "ΕΤΟΙΜΟ ΓΙΑ ΜΠΑΝΙΟ" : isOn ? "ΖΕΣΤΑΙΝΕΙ" : "ΑΝΑΜΟΝΗ";
    badge.classList.toggle("ready", ready);

    $("temp").innerHTML = `${has ? t.toFixed(1) : "--"}<small>°C</small>`;

    // Tank: level ∝ temperature, marks at the two limits.
    const level = has ? Math.max(4, Math.min(100, (t / max) * 100)) : 0;
    const water = $("water");
    water.style.height = `${level}%`;
    $("tank").style.setProperty("--wh-water", whLighten(color, isOn ? 0.45 : 0.15));
    $("tank").style.setProperty("--wh-water-dark", isOn ? whLighten(color, 0.15) : whDarken(color, 0.2));
    $("tank").style.setProperty("--wh-level", `${(level / 100) * 72}px`);
    const mark = (el, value) => { el.style.bottom = `${(value / max) * 100}%`; el.firstElementChild.textContent = `${value}°`; };
    mark($("markHigh"), high);
    mark($("markMid"), mid);

    const warning = $("warning");
    const missing = [cfg.entity_switch, cfg.entity_temp].filter((id) => id && !this._hass.states[id]);
    warning.hidden = !missing.length && !!cfg.entity_switch;
    warning.textContent = !cfg.entity_switch ? "Διάλεξε διακόπτη στις ρυθμίσεις της κάρτας." : missing.length ? `Δεν βρέθηκε: ${missing.join(", ")}` : "";

    const power = this._hass.states[cfg.entity_power];
    const watts = $("watts");
    watts.classList.toggle("hidden", !power || whBad(power.state));
    if (power && !whBad(power.state)) {
      const n = Number(power.state);
      watts.lastElementChild.textContent = Number.isFinite(n) ? `${Math.round(n)} ${power.attributes?.unit_of_measurement || "W"}` : power.state;
    }

    this._sw = sw;
    this._t = has ? t : null;
    this._updateClock();
    this._drawGraph();
  }

  /** "On for", heating rate and time to the high limit — from the switch and the temperature history. */
  _updateClock() {
    const $ = (id) => this.shadowRoot.getElementById(id);
    if (!$("onFor") || !this._config) return;
    const sw = this._sw;
    const isOn = sw?.state === "on";
    const onFor = $("onFor");
    onFor.classList.toggle("hidden", !isOn);
    if (isOn) onFor.lastElementChild.textContent = `Ανοιχτό ${whMinutes(Date.now() - new Date(sw.last_changed).getTime())}`;

    const rate = this._rate();
    const high = Number(this._config.temp_high) || 42;
    $("rate").textContent = rate !== null && Math.abs(rate) >= 0.05
      ? `${rate > 0 ? "▲ +" : "▼ "}${rate.toFixed(1)}°/λεπτό`
      : "";
    const eta = $("eta");
    const t = this._t;
    const showEta = isOn && rate !== null && rate > 0.05 && t !== null && t < high;
    eta.classList.toggle("hidden", !showEta);
    if (showEta) eta.lastElementChild.textContent = `~${whMinutes(((high - t) / rate) * 60000)} για ${high}°`;
  }

  /** °C per minute over the last 15 minutes of history (least squares), or null. */
  _rate() {
    const now = Date.now();
    const pts = this._history.filter((p) => now - p.x <= 15 * 60000);
    if (this._t !== null) pts.push({ x: now, y: this._t });
    if (pts.length < 3 || pts[pts.length - 1].x - pts[0].x < 4 * 60000) return null;
    const n = pts.length;
    const mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n;
    let num = 0, den = 0;
    pts.forEach((p) => { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; });
    return den ? (num / den) * 60000 : null;
  }

  async _maybeLoadHistory() {
    const cfg = this._config;
    if (!this._hass?.callWS || !cfg?.entity_temp) return;
    const tempEnt = this._hass.states[cfg.entity_temp];
    const changed = tempEnt?.last_updated !== this._lastTempUpdate;
    this._lastTempUpdate = tempEnt?.last_updated;
    // At most once a minute, and only when the temperature actually moved (or every 5 minutes).
    const age = Date.now() - this._historyAt;
    if (this._loading || age < 60000 || (!changed && age < 300000)) return;
    this._loading = true;
    this._historyAt = Date.now();
    try {
      const hours = Number(cfg.graph_hours) || 6;
      const res = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: new Date(Date.now() - hours * 3600000).toISOString(),
        entity_ids: [cfg.entity_temp],
        minimal_response: true,
        no_attributes: true,
      });
      const rows = res?.[cfg.entity_temp] || [];
      this._history = rows
        .map((r) => ({ x: (r.lu ?? r.lc ?? 0) * 1000 || new Date(r.last_updated || r.last_changed).getTime(), y: parseFloat(r.s ?? r.state) }))
        .filter((p) => Number.isFinite(p.y) && Number.isFinite(p.x));
    } catch (e) {
      console.warn("water-heater-card history:", e);
    } finally {
      this._loading = false;
      this._updateClock();
      this._drawGraph();
    }
  }

  _drawGraph() {
    const graph = this.shadowRoot.getElementById("graph");
    if (!graph) return;
    const cfg = this._config;
    graph.classList.toggle("hidden", cfg.show_graph === false);
    if (cfg.show_graph === false) return;
    const pts = [...this._history];
    if (this._t !== null) pts.push({ x: Date.now(), y: this._t });
    if (pts.length < 2) {
      graph.innerHTML = `<div class="empty">ιστορικό…</div>`;
      return;
    }
    const W = 300, H = 38;
    const hours = Number(cfg.graph_hours) || 6;
    const x0 = Date.now() - hours * 3600000, x1 = Date.now();
    const high = Number(cfg.temp_high) || 42, mid = Number(cfg.temp_mid) || 35;
    const ys = pts.map((p) => p.y).concat([high, mid]);
    const lo = Math.floor(Math.min(...ys) - 1), hi = Math.ceil(Math.max(...ys) + 1);
    const X = (x) => ((Math.max(x, x0) - x0) / (x1 - x0)) * W;
    const Y = (y) => H - ((y - lo) / (hi - lo || 1)) * H;
    // Step line: a sensor's value holds until the next report.
    let d = `M${X(pts[0].x).toFixed(1)},${Y(pts[0].y).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += ` H${X(pts[i].x).toFixed(1)} V${Y(pts[i].y).toFixed(1)}`;
    const area = `${d} V${H} H${X(pts[0].x).toFixed(1)} Z`;
    const line = (y, label) =>
      `<line x1="0" x2="${W}" y1="${Y(y).toFixed(1)}" y2="${Y(y).toFixed(1)}" stroke="rgba(255,255,255,.35)" stroke-dasharray="3 3" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
      `<text x="${W - 2}" y="${(Y(y) - 2).toFixed(1)}" text-anchor="end" font-size="7" fill="rgba(255,255,255,.7)">${label}°</text>`;
    graph.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Θερμοκρασία ${hours} ωρών">
        <defs><linearGradient id="whg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
        ${line(high, high)}${line(mid, mid)}
        <path d="${area}" fill="url(#whg)" stroke="none"/>
        <path d="${d}" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      </svg>`;
  }
}

/* ==========================================
   VISUAL EDITOR
   ========================================== */

const WH_LABELS = {
  title: "Τίτλος", icon: "Εικονίδιο", entity_switch: "Διακόπτης", entity_temp: "Αισθητήρας θερμοκρασίας",
  entity_power: "Κατανάλωση (προαιρετικό)", temp_mid: "Μεσαίο όριο (°C)", temp_high: "Υψηλό όριο / έτοιμο (°C)",
  temp_max: "Πάνω όριο δοχείου (°C)", theme: "Θέμα", show_graph: "Γράφημα θερμοκρασίας", graph_hours: "Ώρες γραφήματος",
  tap_toggle: "Πάτημα = άναμμα/σβήσιμο",
};

class WaterHeaterCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (this._form) this._form.hass = hass;
    if (first) this._render();
  }

  _schema() {
    const themes = Object.keys(this._hass?.themes?.themes || {});
    return [
      { type: "grid", name: "", schema: [{ name: "title", selector: { text: {} } }, { name: "icon", selector: { icon: {} } }] },
      { name: "entity_switch", selector: { entity: { filter: { domain: ["switch", "input_boolean", "light"] } } } },
      { name: "entity_temp", selector: { entity: { filter: { domain: ["sensor"], device_class: "temperature" } } } },
      { name: "entity_power", selector: { entity: { filter: { domain: ["sensor"], device_class: "power" } } } },
      { type: "grid", name: "", schema: [
        { name: "temp_mid", selector: { number: { min: 0, max: 100, step: 0.5, mode: "box", unit_of_measurement: "°C" } } },
        { name: "temp_high", selector: { number: { min: 0, max: 100, step: 0.5, mode: "box", unit_of_measurement: "°C" } } },
        { name: "temp_max", selector: { number: { min: 20, max: 100, step: 1, mode: "box", unit_of_measurement: "°C" } } },
      ] },
      { type: "grid", name: "", schema: [
        { name: "show_graph", selector: { boolean: {} } },
        { name: "graph_hours", selector: { number: { min: 1, max: 48, mode: "box", unit_of_measurement: "h" } } },
        { name: "tap_toggle", selector: { boolean: {} } },
      ] },
      { name: "theme", selector: { select: { mode: "dropdown", options: [{ value: "default", label: "Default" }, ...themes.map((t) => ({ value: t, label: t }))] } } },
    ];
  }

  async _render() {
    if (!this._config) return;
    if (!this._form) {
      // ha-form and its pickers are lazy-loaded by HA; any built-in card editor pulls them in.
      if (!customElements.get("ha-form") && window.loadCardHelpers) {
        const helpers = await window.loadCardHelpers();
        const c = await helpers.createCardElement({ type: "entities", entities: [] });
        await c.constructor.getConfigElement?.();
      }
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => WH_LABELS[s.name] ?? s.name;
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        this._fire({ ...this._config, ...ev.detail.value });
      });
      this.appendChild(this._form);

      // Native colour pickers for the three temperature colours (one shade each; the card makes the gradient).
      this._colors = document.createElement("div");
      this._colors.style.cssText = "display:flex;flex-direction:column;gap:8px;padding:12px 4px 4px";
      this._colors.innerHTML = `
        <div style="font-size:12px;font-weight:600;opacity:.8">Χρώμα κάρτας ανά θερμοκρασία</div>
        ${[["color_low", "Χαμηλή (κάτω από το μεσαίο όριο)"], ["color_mid", "Μεσαία (ανάμεσα στα δύο όρια)"], ["color_high", "Υψηλή (πάνω από το υψηλό όριο)"]]
          .map(([k, label]) => `<label style="display:flex;align-items:center;gap:10px;font-size:13px">
            <input type="color" data-prop="${k}" style="width:42px;height:32px;border:none;border-radius:6px;cursor:pointer;background:none;padding:0">
            <span style="flex:1">${label}</span></label>`).join("")}`;
      this._colors.querySelectorAll("input").forEach((input) =>
        input.addEventListener("input", () => this._fire({ ...this._config, [input.dataset.prop]: input.value })));
      this.appendChild(this._colors);
    }
    this._form.hass = this._hass;
    this._form.schema = this._schema();
    this._form.data = { ...WH_DEFAULTS, ...this._config };
    this._colors.querySelectorAll("input").forEach((input) => {
      input.value = this._config[input.dataset.prop] || WH_DEFAULTS[input.dataset.prop];
    });
  }

  _fire(config) {
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }
}

if (!customElements.get("water-heater-card")) customElements.define("water-heater-card", WaterHeaterCard);
if (!customElements.get("water-heater-card-editor")) customElements.define("water-heater-card-editor", WaterHeaterCardEditor);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "water-heater-card")) {
  window.customCards.push({
    type: "water-heater-card",
    name: "Water Heater Card",
    description: "Θερμοσίφωνο με κινούμενο δοχείο νερού, ρυθμό ζεστάματος, χρόνο μέχρι το όριο και γράφημα.",
    preview: true,
    documentationURL: "https://github.com/stathisktm/water-heater-card",
  });
}

console.info(`%c WATER-HEATER-CARD %c ${WH_VERSION} `, "background:#FF4500;color:#fff;border-radius:3px 0 0 3px;padding:1px 4px", "background:#222;color:#fff;border-radius:0 3px 3px 0;padding:1px 4px");
