const NA = { country: "na", area: "na", city: "na" };

let enabled = false;
let placePin = true;
let zoomMap = true;
let minKm = 10;
let maxKm = 20;
let autoGuess = false;
let autoDelaySec = 3;
let overlay = null;
let seenSrc = null;
let generation = 0;
let applying = false;
let guessTimer = null;
let guessToken = null;
let continueTimer = null;
let continueTarget = null;
let continueArmed = null;

const storedDefaults = {
  enabled: false,
  placePin: true,
  zoomMap: true,
  minKm: 10,
  maxKm: 20,
  autoGuess: false,
  autoDelay: 3,
};

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

  cancelGuess();
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
  const wasAuto = autoGuess;
  enabled = Boolean(data.enabled);
  placePin = data.placePin !== false;
  zoomMap = data.zoomMap !== false;
  minKm = clampKm(data.minKm, 10);
  maxKm = Math.max(minKm, clampKm(data.maxKm, 20));
  autoGuess = Boolean(data.autoGuess);
  autoDelaySec = clampDelay(data.autoDelay);
  broadcastMapSettings();
  if (!enabled || !autoGuess) {
    cancelGuess();
    clearContinue();
  } else if (!wasAuto && visibleGuessButton() && !answerOpen() && !welcomeOpen()) {
    scheduleGuess("ready");
  }
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

function clampDelay(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 3;
  return Math.min(30, Math.max(0, Math.round(number)));
}

function welcomeOpen() {
  return Boolean(document.querySelector(".welcome-modal.visible"));
}

function answerOpen() {
  const area = document.getElementById("miniMapArea");
  if (area?.classList.contains("answerShown")) return true;
  const banner = document.getElementById("endBanner");
  if (banner && getComputedStyle(banner).display !== "none") return true;
  return Boolean(document.querySelector(".round-over-screen:not(.hidden)"));
}

function visibleGuessButton() {
  const buttons = document.querySelectorAll("button.guessBtn");
  for (const button of buttons) {
    if (button.disabled || button.classList.contains("unavailable")) continue;
    if (!button.getClientRects().length) continue;
    const style = getComputedStyle(button);
    if (style.display === "none" || style.visibility === "hidden") continue;
    return button;
  }
  return null;
}

function continueButton() {
  const banner = document.getElementById("endBanner");
  if (banner && getComputedStyle(banner).display !== "none" && !banner.classList.contains("endBannerFadeOut")) {
    const next = banner.querySelector("button.playAgain");
    if (next && !next.disabled) return next;
  }
  const summary = document.querySelector(".round-over-screen:not(.hidden)");
  const again = summary?.querySelector("button.action-btn.primary:not(.placement-replay)");
  if (again && !again.disabled && again.getClientRects().length) return again;
  return null;
}

function cancelGuess() {
  clearTimeout(guessTimer);
  guessTimer = null;
  guessToken = null;
}

function scheduleGuess(token) {
  if (!enabled || !autoGuess) return;
  clearTimeout(guessTimer);
  guessToken = token;
  let due = null;
  let sawRound = false;
  const attempt = () => {
    if (!enabled || !autoGuess || guessToken !== token) return;
    if (welcomeOpen() || answerOpen()) {
      if (sawRound) {
        guessToken = null;
        return;
      }
      due = null;
      guessTimer = setTimeout(attempt, 200);
      return;
    }
    sawRound = true;
    if (due == null) due = Date.now() + clampDelay(autoDelaySec) * 1000;
    if (Date.now() < due) {
      guessTimer = setTimeout(attempt, Math.min(200, due - Date.now()));
      return;
    }
    const button = visibleGuessButton();
    if (!button) {
      if (Date.now() - due > 8000) {
        guessToken = null;
        return;
      }
      guessTimer = setTimeout(attempt, 200);
      return;
    }
    guessToken = null;
    button.click();
  };
  attempt();
}

function clearContinue() {
  clearTimeout(continueTimer);
  continueTimer = null;
  continueTarget = null;
  continueArmed = null;
}

function watchContinue() {
  if (!enabled || !autoGuess || welcomeOpen()) {
    clearContinue();
    return;
  }
  const button = continueButton();
  if (!button) {
    clearContinue();
    return;
  }
  if (button === continueArmed || button === continueTarget) return;
  continueTarget = button;
  clearTimeout(continueTimer);
  continueTimer = setTimeout(() => {
    continueTimer = null;
    if (!enabled || !autoGuess || continueButton() !== continueTarget) return;
    continueArmed = continueTarget;
    continueTarget = null;
    continueArmed.click();
  }, clampDelay(autoDelaySec) * 1000);
}

chrome.storage.local.get(storedDefaults, applyStored);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (
    !changes.enabled &&
    !changes.placePin &&
    !changes.zoomMap &&
    !changes.minKm &&
    !changes.maxKm &&
    !changes.autoGuess &&
    !changes.autoDelay
  ) return;
  chrome.storage.local.get(storedDefaults, (data) => {
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
  if (!applying) sync();
  watchContinue();
});
observer.observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ["src"],
});

setInterval(() => {
  if (enabled && !applying) sync();
  watchContinue();
}, 500);

window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data) return;
  if (event.data.source === "wgh-placed") scheduleGuess(String(event.data.token));
  if (event.data.source === "wgh-cancel") cancelGuess();
});
