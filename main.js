/**
 * OpenCode Quota — command, panel and the composer indicator's data backend.
 *
 * The panel talks to the bridge directly. The composer indicator lives in a
 * renderer module, which cannot call the host itself; it reaches this module
 * through `pi.dispatch("plugin.call", …)` and the `onRendererCall` hook below.
 * All the quota logic (provider check, key lookup, the single usage request)
 * lives here so both surfaces share one code path.
 */

const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
const WINDOWS = ["rolling", "weekly", "monthly"];

/** Is the provider PI-Desktop is currently on an OpenCode Go / Zen one? */
function activeProvider(models) {
  if (!Array.isArray(models) || models.length === 0) return null;
  const active = models.find((model) => model.isDefault) ?? models[0];
  const id = String(active?.providerId ?? "");
  const name = String(active?.providerName ?? "");
  const isGo = /opencode/i.test(id) || /opencode/i.test(name);
  return { isGo, id, name: name || id };
}

/** Fetch the three quota meters with the plugin's stored API key. */
async function readMeters(key) {
  const response = await pi.net.fetch({
    url: USAGE_URL,
    method: "GET",
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    redirect: "error",
    timeoutMs: 15_000,
  });

  const status = Number(response?.status ?? 0);
  if (status === 401 || status === 403) return { status: "unauthorized" };
  if (status === 404) return { status: "unsupported" };
  if (status < 200 || status >= 300) return { status: "http", message: `HTTP ${status}` };

  let body;
  try {
    body = JSON.parse(String(response?.bodyText ?? ""));
  } catch {
    return { status: "malformed", message: "invalid JSON" };
  }
  const usage = body?.usage;
  if (!usage || typeof usage !== "object") return { status: "malformed", message: "no usage meters" };

  const meters = {};
  for (const name of WINDOWS) {
    const raw = usage[name];
    if (!raw || typeof raw !== "object") continue;
    const used = Number(raw.percent);
    if (!Number.isFinite(used)) continue;
    meters[name] = {
      used: Math.max(0, Math.min(100, used)),
      resetsAt: typeof raw.resetsAt === "string" ? raw.resetsAt : null,
    };
  }
  if (Object.keys(meters).length === 0) return { status: "malformed", message: "no usable meters" };
  return { status: "ready", meters };
}

/**
 * Called from the renderer module (`renderer/quota.mjs`) via plugin.call.
 * Methods:
 *   - quota.get  → live meters (or the reason they must not be shown)
 *   - panel.open → opens the detailed quota panel
 */
async function onRendererCall(method, args) {
  switch (String(method ?? "")) {
    case "ping": {
      // Renderer-side beacon: touching models.list leaves an entry in the
      // host plugin log, proving the renderer module loaded and dispatch works.
      await pi.models.list().catch(() => []);
      return { ok: true };
    }

    case "selftest": {
      // Renderer-side report: an auditable log entry first, then a toast.
      await pi.models.list().catch(() => []);
      try {
        await pi.ui.showToast(`OpenCode Quota renderer: ${String(args?.message ?? "selftest")}`);
      } catch {}
      return { ok: true };
    }

    case "panel.open": {
      await pi.ui.openPanel();
      return { ok: true };
    }

    case "quota.get": {
      const settings = await pi.plugin.getSettings();
      const key = typeof settings?.apiKey === "string" ? settings.apiKey.trim() : "";
      const provider = activeProvider(await pi.models.list().catch(() => []));

      if (provider && !provider.isGo) {
        return { status: "not-applicable", at: Date.now() };
      }
      if (!key) {
        return { status: "no-key", at: Date.now() };
      }

      const result = await readMeters(key);
      if (result.status !== "ready") {
        return { status: result.status, message: result.message ?? "", at: Date.now() };
      }
      return { status: "ready", meters: result.meters, at: Date.now() };
    }

    default:
      throw new Error(`onRendererCall: unknown method ${String(method)}`);
  }
}

async function onLoad() {
  await pi.commands.register({
    id: "opencodeQuota.open",
    title: "OpenCode Quota: Open",
    keywords: ["opencode", "quota", "usage", "额度", "订阅"],
    category: "Productivity",
    run: async () => {
      await pi.ui.openPanel();
    },
  });
}

async function onUnload() {
  await pi.commands.unregister("opencodeQuota.open");
}

module.exports = { onLoad, onUnload, onRendererCall };
