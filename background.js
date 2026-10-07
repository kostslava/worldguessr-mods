import {
  CITY_DIRECTION_MIN_KM,
  chooseBox,
  cityFromAddress,
  hintFromPlace,
  locationKey,
  parseBox,
  placeSpanKm,
  withCenter,
} from "./geo.js";

const NOMINATIM = "https://nominatim.openstreetmap.org";
const MIN_GAP_MS = 1100;
const NA = { country: "na", area: "na", city: "na" };

let tail = Promise.resolve();
let lastHttpAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enqueue(task) {
  const run = tail.then(task, task);
  tail = run.then(() => {}, () => {});
  return run;
}

async function nominatim(path) {
  const wait = MIN_GAP_MS - (Date.now() - lastHttpAt);
  if (wait > 0) await sleep(wait);
  lastHttpAt = Date.now();

  const response = await fetch(`${NOMINATIM}${path}`, {
    headers: { Accept: "application/json", "Accept-Language": "en" },
  });
  if (!response.ok) throw new Error(`Nominatim responded ${response.status}`);
  return response.json();
}

async function readCaches() {
  return chrome.storage.local.get({ reverseCache: {}, boxCache: {} });
}

async function reversePlace(lat, lon) {
  const key = locationKey(lat, lon);
  const { reverseCache } = await readCaches();
  if (reverseCache[key]) return reverseCache[key];

  const data = await nominatim(
    `/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&format=jsonv2&zoom=10&accept-language=en`
  );
  const address = data?.address || {};
  const place = {
    country: String(address.country || "").trim() || null,
    city: cityFromAddress(address),
    countryCode: String(address.country_code || "").trim() || null,
  };
  reverseCache[key] = place;
  await chrome.storage.local.set({ reverseCache });
  return place;
}

async function cachedBox(cacheId, load) {
  const { boxCache } = await readCaches();
  if (boxCache[cacheId]) return boxCache[cacheId];

  const box = await load();
  if (!box) return null;
  boxCache[cacheId] = box;
  await chrome.storage.local.set({ boxCache });
  return box;
}

async function cityBox(place, lat, lon) {
  const cacheId = `city2:${place.city}|${place.country}`.toLowerCase();
  return cachedBox(cacheId, async () => {
    const params = new URLSearchParams({
      city: place.city,
      country: place.country,
      format: "jsonv2",
      limit: "5",
      "accept-language": "en",
    });
    if (place.countryCode) params.set("countrycodes", place.countryCode);
    const results = await nominatim(`/search?${params}`);
    return chooseBox(results, lat, lon, place.city);
  });
}

async function countryBox(place, lat, lon) {
  const cacheId = `country2:${place.country}`.toLowerCase();
  return cachedBox(cacheId, async () => {
    const params = new URLSearchParams({
      country: place.country,
      featuretype: "country",
      format: "jsonv2",
      limit: "1",
      "accept-language": "en",
    });
    const results = await nominatim(`/search?${params}`);
    return chooseBox(results, lat, lon, place.country) || withCenter(parseBox(results?.[0]?.boundingbox), results?.[0]);
  });
}

async function lookupBody(lat, lon) {
  const place = await reversePlace(lat, lon);
  if (!place.country && !place.city) return NA;

  let box = null;
  try {
    if (place.city && place.country) {
      const city = await cityBox(place, lat, lon);
      if (city && placeSpanKm(city) >= CITY_DIRECTION_MIN_KM) box = city;
    }
  } catch {
    box = null;
  }
  if (!box && place.country) {
    try {
      box = await countryBox(place, lat, lon);
    } catch {
      box = null;
    }
  }

  return hintFromPlace(lat, lon, place, box);
}

function lookup(lat, lon) {
  return enqueue(() => lookupBody(lat, lon));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "lookup") return;

  const lat = Number(message.lat);
  const lon = Number(message.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    sendResponse(NA);
    return;
  }

  lookup(lat, lon)
    .then((hint) => sendResponse(hint || NA))
    .catch(() => sendResponse(NA));
  return true;
});
