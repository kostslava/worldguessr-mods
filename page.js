function isLeafletMap(value) {
  return Boolean(value && typeof value.flyTo === "function" && typeof value.getCenter === "function");
}

function mapFromHook(value) {
  if (isLeafletMap(value)) return value;
  if (isLeafletMap(value?.map)) return value.map;
  if (isLeafletMap(value?.current)) return value.current;
  return null;
}

function pinLatLng(pin) {
  if (!pin) return null;
  const lat = Number(pin.lat ?? pin[0]);
  const lon = Number(pin.lng ?? pin.lon ?? pin[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function samePlace(a, b) {
  return Math.abs(a.lat - b.lat) < 0.02 && Math.abs(a.lon - b.lon) < 0.02;
}

function findGuessMap() {
  const container = document.querySelector("#miniMapArea .leaflet-container");
  const area = document.getElementById("miniMapArea");
  if (!container) return { answerShown: area?.classList.contains("answerShown") || false };

  const key = Object.keys(container).find((name) => name.startsWith("__reactFiber$"));
  if (!key) return {};

  let fiber = container[key];
  let map = null;
  let setPinPoint = null;
  let pinPoint = null;
  let answerShown = Boolean(area?.classList.contains("answerShown"));
  for (let depth = 0; fiber && depth < 25; depth += 1, fiber = fiber.return) {
    let hook = fiber.memoizedState;
    while (hook) {
      map = mapFromHook(hook.memoizedState) || map;
      hook = hook.next;
    }
    const props = fiber.memoizedProps;
    if (!setPinPoint && typeof props?.setPinPoint === "function") {
      setPinPoint = props.setPinPoint;
      pinPoint = props.pinPoint;
    }
    if (props?.answerShown) answerShown = true;
  }
  return { map, setPinPoint, pinPoint, answerShown };
}

function viewSettled(map, lat, lon) {
  const size = map.getSize?.();
  if (!size || size.x < 20 || size.y < 20) return false;
  const center = map.getCenter();
  const zoom = map.getZoom();
  if (!(zoom >= 4.5)) return false;
  return samePlace({ lat: center.lat, lon: center.lng }, { lat, lon });
}

const clicked = new Set();
let options = { placePin: true, zoomMap: true, minKm: 10, maxKm: 20 };
let activeToken = null;
let ownedToken = null;
let userOwnedToken = null;
let nextFlyAt = 0;

function rememberOptions(data) {
  if (!data) return;
  if ("placePin" in data) options.placePin = data.placePin !== false;
  if ("zoomMap" in data) options.zoomMap = data.zoomMap !== false;
  if ("minKm" in data) options.minKm = Number(data.minKm) || 0;
  if ("maxKm" in data) options.maxKm = Number(data.maxKm) || 0;
}

function offsetPoint(lat, lon, minKm, maxKm) {
  const min = Math.max(0, Number(minKm) || 0);
  const max = Math.max(min, Number(maxKm) || 0);
  if (max <= 0) return { lat, lon };
  const distance = min + Math.random() * (max - min);
  const bearing = Math.random() * Math.PI * 2;
  const northKm = Math.cos(bearing) * distance;
  const eastKm = Math.sin(bearing) * distance;
  const dLat = northKm / 110.574;
  const cos = Math.cos((lat * Math.PI) / 180) || 1e-6;
  let nextLon = lon + eastKm / (111.32 * cos);
  if (nextLon > 180) nextLon -= 360;
  if (nextLon < -180) nextLon += 360;
  return {
    lat: Math.max(-85, Math.min(85, lat + dLat)),
    lon: nextLon,
  };
}

function applyGuess(lat, lon, token) {
  if (userOwnedToken === token) return "stop";
  if (!options.placePin && !options.zoomMap) return "stop";

  const { map, setPinPoint, pinPoint, answerShown } = findGuessMap();
  if (answerShown || (!map && !setPinPoint)) return "wait";

  const pin = pinLatLng(pinPoint);
  const latlng = window.L?.latLng ? window.L.latLng(lat, lon) : { lat, lng: lon };
  if (options.placePin && setPinPoint) {
    const placed = ownedToken === token;
    if (!placed) {
      setPinPoint(latlng);
      ownedToken = token;
    } else if (!pin && userOwnedToken !== token) {
      setPinPoint(latlng);
    }
  }

  if (!map) return "wait";
  if (options.placePin && !clicked.has(token)) {
    clicked.add(token);
    ownedToken = token;
    try {
      map.fire("click", { latlng });
    } catch {
      // The pin state is already set. The click only notifies multiplayer.
    }
  }

  if (!options.zoomMap) return "hold";
  if (!viewSettled(map, lat, lon)) {
    if (Date.now() >= nextFlyAt) {
      try {
        map.flyTo([lat, lon], 5, { duration: 0.45 });
        nextFlyAt = Date.now() + 900;
      } catch {
        return "wait";
      }
    }
    return "wait";
  }
  return "hold";
}

function selectWhenReady(lat, lon, token) {
  activeToken = token;
  ownedToken = null;
  if (userOwnedToken !== token) userOwnedToken = null;
  nextFlyAt = 0;
  const spot = offsetPoint(lat, lon, options.minKm, options.maxKm);
  const started = Date.now();
  let hold = 0;
  const tick = () => {
    if (activeToken !== token || userOwnedToken === token) return;
    if (Date.now() - started > 90000) return;
    const status = applyGuess(spot.lat, spot.lon, token);
    if (status === "stop") return;
    if (status === "hold") {
      hold += 1;
      if (hold >= 6) return;
    } else {
      hold = 0;
    }
    setTimeout(tick, 400);
  };
  tick();
}

function mapWasTouched(event) {
  const area = document.getElementById("miniMapArea");
  if (!area || !area.contains(event.target)) return;
  if (activeToken) userOwnedToken = activeToken;
  try {
    findGuessMap().map?.stop?.();
  } catch {
    // The camera can keep its current frame.
  }
}

document.addEventListener("pointerdown", mapWasTouched, true);
document.addEventListener("wheel", mapWasTouched, true);

window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data) return;
  if (event.data.source === "wgh-settings") {
    rememberOptions(event.data);
    if (!event.data.enabled || (!options.placePin && !options.zoomMap)) activeToken = null;
    return;
  }
  if (event.data.source !== "wgh-hint") return;
  if (event.data.cancel) {
    activeToken = null;
    return;
  }
  rememberOptions(event.data);
  const lat = Number(event.data.lat);
  const lon = Number(event.data.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  selectWhenReady(lat, lon, String(event.data.token));
});
