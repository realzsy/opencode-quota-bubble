/**
 * OpenCode Quota — composer indicator.
 *
 * Registers one `composerControl` slot on the right side of the chat input,
 * next to the built-in context-usage readout. While an OpenCode Go provider
 * is active it shows a colored dot plus the remaining share of the rolling
 * 5-hour window. Clicking opens a detail card (a host-provided layer) with
 * all three windows and their reset times — mirroring the context-usage
 * readout's click-to-inspect interaction.
 *
 * React comes from the host (`__PI_RENDERER_HOST__.react`, importmap as the
 * fallback). Data flows through `pi.dispatch("plugin.call", …)` →
 * `onRendererCall` (main.js); the methods used here are whitelisted in the
 * manifest's `rendererCallMethods`, `plugin.call` itself in
 * `rendererActions`.
 */

const REFRESH_MS = 60_000;
const WINDOWS = ["rolling", "weekly", "monthly"];

const STRINGS = {
  en: {
    title: "OpenCode Go quota",
    rolling: "Rolling 5h",
    weekly: "Weekly",
    monthly: "Monthly",
    resetsInMinutes: "resets in {{count}}m",
    resetsInHours: "resets in {{count}}h {{minutes}}m",
    resetsInDays: "resets in {{count}}d {{hours}}h",
    resetting: "resetting",
    left: "{{percent}} left",
    close: "Close",
    ariaLabel: "OpenCode Go quota, {{percent}} left in the rolling 5-hour window. Click for details.",
  },
  "zh-CN": {
    title: "OpenCode Go 额度",
    rolling: "滚动 5 小时",
    weekly: "每周",
    monthly: "每月",
    resetsInMinutes: "{{count}} 分钟后重置",
    resetsInHours: "{{count}} 小时 {{minutes}} 分后重置",
    resetsInDays: "{{count}} 天 {{hours}} 小时后重置",
    resetting: "即将重置",
    left: "剩余 {{percent}}",
    close: "关闭",
    ariaLabel: "OpenCode Go 额度，滚动 5 小时窗口剩余 {{percent}}。点击查看详情。",
  },
};

function localeStrings() {
  const raw = String(
    (typeof document !== "undefined" && document.documentElement?.lang) ||
      navigator?.language ||
      "en",
  )
    .replaceAll("_", "-")
    .toLowerCase();
  return raw.startsWith("zh") ? STRINGS["zh-CN"] : STRINGS.en;
}

/** t("key", vars) — fill once, with the raw template preserved. */
function makeT() {
  const S = localeStrings();
  return (key, vars) => {
    const template = S[key] ?? STRINGS.en[key] ?? key;
    return vars
      ? template.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars?.[name] ?? ""))
      : template;
  };
}

function pct(value) {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

function until(iso, t) {
  if (!iso) return "";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const delta = at - Date.now();
  if (delta <= 0) return t("resetting");
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return t("resetsInMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("resetsInHours", { count: hours, minutes: minutes % 60 });
  return t("resetsInDays", { count: Math.floor(hours / 24), hours: hours % 24 });
}

const STYLE = `
.opencode-quota-chip{
  align-items:center;
  background:transparent;
  border:none;
  border-radius:6px;
  color:var(--ds-text-secondary,#9da5b4);
  cursor:pointer;
  display:inline-flex;
  font:inherit;
  font-size:12px;
  gap:5px;
  line-height:1;
  margin:0;
  padding:4px 6px;
}
.opencode-quota-chip:hover{background:color-mix(in oklab,currentColor 10%,transparent);color:var(--ds-text-primary,currentColor)}
.opencode-quota-chip:focus-visible{outline:1px solid var(--ds-focus,#526fff);outline-offset:1px}
.opencode-quota-chip-dot{
  border-radius:999px;
  display:inline-block;
  height:7px;
  width:7px;
}
.opencode-quota-chip[data-tone="ok"] .opencode-quota-chip-dot{background:#7fd88f}
.opencode-quota-chip[data-tone="warning"] .opencode-quota-chip-dot{background:#f5a742}
.opencode-quota-chip[data-tone="critical"] .opencode-quota-chip-dot{background:#f87171}
.opencode-quota-chip-label{white-space:nowrap}
.opencode-quota-card{
  background:var(--ds-bg-elevated-opaque,#262a33);
  border:1px solid color-mix(in oklab,var(--ds-text-primary,#fff) 12%,transparent);
  border-radius:12px;
  box-shadow:0 12px 32px rgba(0,0,0,.35);
  color:var(--ds-text-primary,#fff);
  font-size:12px;
  min-width:360px;
  padding:12px 14px;
  position:fixed;
  z-index:600;
}
.opencode-quota-card-head{
  align-items:center;
  display:flex;
  font-size:12px;
  font-weight:600;
  justify-content:space-between;
  margin-bottom:10px;
}
.opencode-quota-card-close{
  background:transparent;
  border:none;
  border-radius:6px;
  color:var(--ds-text-secondary,#9da5b4);
  cursor:pointer;
  font:inherit;
  font-size:12px;
  line-height:1;
  padding:2px 6px;
}
.opencode-quota-card-close:hover{color:var(--ds-text-primary,currentColor)}
.opencode-quota-card-row{
  align-items:center;
  display:flex;
  gap:8px;
  margin:7px 0;
}
.opencode-quota-card-label{flex:0 0 76px}
.opencode-quota-card-track{
  background:color-mix(in oklab,var(--ds-text-primary,#fff) 12%,transparent);
  border-radius:999px;
  flex:1;
  height:6px;
  overflow:hidden;
}
.opencode-quota-card-fill{height:100%}
.opencode-quota-card-row[data-tone="ok"] .opencode-quota-card-fill{background:#7fd88f}
.opencode-quota-card-row[data-tone="warning"] .opencode-quota-card-fill{background:#f5a742}
.opencode-quota-card-row[data-tone="critical"] .opencode-quota-card-fill{background:#f87171}
.opencode-quota-card-meta{
  color:var(--ds-text-secondary,#9da5b4);
  display:flex;
  flex:0 0 auto;
  font-size:11px;
  justify-content:flex-end;
  text-align:right;
  white-space:nowrap;
}
`;

/** Build the detail card DOM inside a host-provided layer. */
function buildCard(layer, meters, t, onClose, anchor) {
  const card = document.createElement("div");
  card.className = "opencode-quota-card";
  card.setAttribute("role", "dialog");

  // Anchor above the chip: left edge near the chip, bottom edge 8px above it.
  const rect = anchor?.getBoundingClientRect?.();
  if (rect) {
    const cardWidth = 360;
    const left = Math.min(
      Math.max(8, rect.left + rect.width / 2 - cardWidth / 2),
      Math.max(8, window.innerWidth - cardWidth - 8),
    );
    card.style.left = `${left}px`;
    card.style.bottom = `${window.innerHeight - rect.top + 8}px`;
  } else {
    card.style.right = "20px";
    card.style.bottom = "96px";
  }
  const head = document.createElement("div");
  head.className = "opencode-quota-card-head";
  const title = document.createElement("span");
  title.textContent = t("title");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "opencode-quota-card-close";
  close.textContent = t("close");
  close.addEventListener("click", onClose);
  head.append(title, close);
  card.append(head);

  for (const name of WINDOWS) {
    const meter = meters?.[name];
    if (!meter) continue;

    const remaining = Math.max(0, 100 - meter.used);
    const tone = remaining <= 10 ? "critical" : remaining <= 25 ? "warning" : "ok";

    const row = document.createElement("div");
    row.className = "opencode-quota-card-row";
    row.dataset.tone = tone;

    const label = document.createElement("span");
    label.className = "opencode-quota-card-label";
    label.textContent = t(name);

    const track = document.createElement("div");
    track.className = "opencode-quota-card-track";
    const fill = document.createElement("div");
    fill.className = "opencode-quota-card-fill";
    fill.style.width = `${meter.used}%`;
    track.append(fill);

    const meta = document.createElement("span");
    meta.className = "opencode-quota-card-meta";
    meta.textContent = `${t("left", { percent: pct(remaining) })} · ${until(meter.resetsAt, t)}`;

    row.append(label, track, meta);
    card.append(row);
  }

  layer.element.append(card);
  return card;
}

export async function onLoad(pi) {
  let react;
  try {
    react = globalThis.__PI_RENDERER_HOST__?.react ?? (await import("react"));
  } catch {
    return () => {};
  }

  const { createElement, useEffect, useState } = react;
  let activeLayer = null;

  const closeLayer = () => {
    if (activeLayer) {
      activeLayer.close();
      activeLayer = null;
    }
  };

  function QuotaChip({ pi: piProp }) {
    const [state, setState] = useState({ status: "loading", data: null });

    useEffect(() => {
      let alive = true;
      let busy = false;

      const refresh = async () => {
        if (busy || !piProp?.dispatch) return;
        busy = true;
        try {
          const data = await piProp.dispatch("plugin.call", {
            method: "quota.get",
            args: {},
          });
          if (alive) setState({ status: data?.status ?? "error", data });
        } catch {
          // Keep the last good reading; the chip hides itself on hard states.
        } finally {
          busy = false;
        }
      };

      void refresh();
      const timer = setInterval(() => void refresh(), REFRESH_MS);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }, [piProp]);

    // Close the detail card whenever the chip goes away.
    useEffect(() => closeLayer, []);

    const { status, data } = state;
    if (status !== "ready" || !data?.meters?.rolling) {
      // Not an OpenCode Go provider, no key, or an error: stay out of the way.
      return null;
    }

    const t = makeT();
    const rolling = data.meters.rolling;
    const remaining = Math.max(0, 100 - rolling.used);
    const tone = remaining <= 10 ? "critical" : remaining <= 25 ? "warning" : "ok";

    const openDetails = (event) => {
      const anchor = event?.currentTarget ?? event?.target ?? null;
      closeLayer();
      const layer = piProp?.ui?.openLayer?.();
      if (!layer) return;
      activeLayer = layer;
      const onDocClick = (docEvent) => {
        if (docEvent.composedPath?.().includes?.(layer.element)) return;
        cleanup();
      };
      const onKey = (docEvent) => {
        if (docEvent.key === "Escape") cleanup();
      };
      const cleanup = () => {
        document.removeEventListener("pointerdown", onDocClick);
        document.removeEventListener("keydown", onKey);
        closeLayer();
      };
      document.addEventListener("pointerdown", onDocClick, true);
      document.addEventListener("keydown", onKey, true);
      buildCard(layer, data.meters, t, cleanup, anchor);
    };

    return createElement(
      "button",
      {
        type: "button",
        className: "opencode-quota-chip",
        "data-tone": tone,
        "aria-label": t("ariaLabel", { percent: pct(remaining) }),
        onClick: openDetails,
      },
      createElement("span", { className: "opencode-quota-chip-dot", "aria-hidden": "true" }),
      createElement("span", { className: "opencode-quota-chip-label" }, `Go ${pct(remaining)}`),
    );
  }

  try {
    pi.ui.injectStyle(STYLE);
    return pi.slots.register({
      slot: "composerControl",
      positions: ["right"],
      component: (props) => createElement(QuotaChip, { ...props, pi }),
    });
  } catch {
    return () => {};
  }
}
