const NA = { country: "na", area: "na", city: "na" };

let enabled = false;
let placePin = true;
let zoomMap = true;
let minKm = 10;
let maxKm = 20;
let overlay = null;
let seenSrc = null;
let generation = 0;
let applying = false;

function broadcastMapSettings() {
  window.postMessage({ source: "wgh-settings", enabled, placePin, zoomMap, minKm, maxKm }, "*");
}

function selectOnGuessMap(lat, lon, token) {
  if (!enabled || (!placePin && !zoomMap)) return;
  window.postMessage({
    source: "wgh-hint",
    lat,
    lon,
    token,
    placePin,
    zoomMap,
    minKm,
    maxKm,
  }, "*");
}

function parseLocation(src) {
  if (!src) return null;
  const match = src.match(/[?&]location=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function ensureOverlay() {
  if (overlay?.isConnected) return overlay;
  overlay = document.createElement("aside");
  overlay.id = "wgh-hint";
  overlay.setAttribute("aria-live", "polite");
  document.documentElement.appendChild(overlay);
  return overlay;
}

function removeOverlay() {
  if (!overlay) return;
  applying = true;
  overlay.remove();
  overlay = null;
  applying = false;
}

function render(hint, pending) {
  if (!enabled) {
    removeOverlay();
    return;
  }
  applying = true;
  try {
    const root = ensureOverlay();
    root.replaceChildren();

    for (const label of ["country", "area", "city"]) {
      const row = document.createElement("div");
      row.className = "wgh-row";
      const name = document.createElement("span");
      name.className = "wgh-label";
      name.textContent = label;
      const value = document.createElement("span");
      value.className = "wgh-value";
      value.textContent = pending ? "…" : hint[label] || "na";
      row.append(name, value);
      root.append(row);
    }

    const credit = document.createElement("div");
    credit.className = "wgh-credit";
    credit.textContent = "© OpenStreetMap";
    root.append(credit);
  } finally {
    applying = false;
  }
}

async function sync() {
  if (!enabled) {
    generation += 1;
    seenSrc = null;
    removeOverlay();
    return;
  }

  const iframe = document.getElementById("streetview");
  if (!iframe) {
    if (seenSrc !== null || overlay) {
      generation += 1;
      seenSrc = null;
      removeOverlay();
    }
    return;
  }

  const src = iframe.getAttribute("src") || "";
  const location = parseLocation(src);
  if (!location) {
    if (src !== seenSrc || !overlay) {
      generation += 1;
      seenSrc = src;
      render(NA, false);
    }
    return;
  }

  if (src === seenSrc) return;

  seenSrc = src;
  const token = ++generation;
  render(NA, true);
  selectOnGuessMap(location.lat, location.lon, token);

  try {
    const hint = await chrome.runtime.sendMessage({
      type: "lookup",
      lat: location.lat,
      lon: location.lon,
    });
    if (!enabled || token !== generation) return;
    render(
      {
        country: hint?.country || "na",
        area: hint?.area || "na",
        city: hint?.city || "na",
      },
      false
    );
  } catch {
    if (!enabled || token !== generation) return;
    render(NA, false);
  }
}

function applyStored(data) {
  const wasEnabled = enabled;
  enabled = Boolean(data.enabled);
  placePin = data.placePin !== false;
  zoomMap = data.zoomMap !== false;
  minKm = clampKm(data.minKm, 10);
  maxKm = Math.max(minKm, clampKm(data.maxKm, 20));
  broadcastMapSettings();
  if (!enabled) {
    generation += 1;
    seenSrc = null;
    removeOverlay();
    window.postMessage({ source: "wgh-hint", cancel: true }, "*");
    return;
  }
  if (!wasEnabled) {
    seenSrc = null;
    sync();
  }
}

function clampKm(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(200, Math.max(0, Math.round(number)));
}

chrome.storage.local.get(
  { enabled: false, placePin: true, zoomMap: true, minKm: 10, maxKm: 20 },
  applyStored
);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!changes.enabled && !changes.placePin && !changes.zoomMap && !changes.minKm && !changes.maxKm) return;
  chrome.storage.local.get(
    { enabled: false, placePin: true, zoomMap: true, minKm: 10, maxKm: 20 },
    (data) => {
    const turnedPinOn = Boolean(changes.placePin) && data.placePin !== false && !placePin;
    const turnedZoomOn = Boolean(changes.zoomMap) && data.zoomMap !== false && !zoomMap;
    applyStored(data);
    if (enabled && (turnedPinOn || turnedZoomOn)) {
      seenSrc = null;
      sync();
    }
  });
});

const observer = new MutationObserver(() => {
  if (applying) return;
  sync();
});
observer.observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ["src"],
});

setInterval(() => {
  if (!enabled || applying) return;
  sync();
}, 500);
