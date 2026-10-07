const NA = "na";

export function locationKey(lat, lon) {
  return `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`;
}

export function cityFromAddress(address) {
  if (!address) return null;
  const name = address.city || address.town || address.municipality || "";
  const trimmed = String(name).trim();
  return trimmed || null;
}

export function withCenter(box, result) {
  if (!box) return null;
  const lat = Number(result?.lat);
  const lon = Number(result?.lon);
  return {
    ...box,
    lat: Number.isFinite(lat) ? lat : (box.south + box.north) / 2,
    lon: Number.isFinite(lon) ? lon : (box.west + box.east) / 2,
  };
}

export function parseBox(boundingbox) {
  if (!Array.isArray(boundingbox) || boundingbox.length < 4) return null;
  const south = Number(boundingbox[0]);
  const north = Number(boundingbox[1]);
  const west = Number(boundingbox[2]);
  const east = Number(boundingbox[3]);
  if (![south, north, west, east].every(Number.isFinite)) return null;
  if (!(north > south) || !(east > west)) return null;
  return { south, north, west, east };
}

const DIRECTIONS = [
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
];

export const CITY_DIRECTION_MIN_KM = 40;

export function placeSpanKm(box) {
  if (!box) return 0;
  const midLat = (box.south + box.north) / 2;
  const heightKm = (box.north - box.south) * 110.574;
  const widthKm = (box.east - box.west) * 111.32 * Math.cos((midLat * Math.PI) / 180);
  return Math.hypot(heightKm, widthKm);
}

export function compassSector(lat, lon, box) {
  if (!box) return NA;
  const centerLat = Number.isFinite(box.lat) ? box.lat : (box.south + box.north) / 2;
  const centerLon = Number.isFinite(box.lon) ? box.lon : (box.west + box.east) / 2;
  const cos = Math.cos((centerLat * Math.PI) / 180);
  const northKm = (lat - centerLat) * 110.574;
  const eastKm = (lon - centerLon) * 111.32 * cos;
  const distanceKm = Math.hypot(northKm, eastKm);
  const radiusKm = placeSpanKm(box) / 2;
  if (radiusKm > 0 && distanceKm < radiusKm * 0.22) return "central";

  const angle = (Math.atan2(eastKm, northKm) * 180) / Math.PI;
  const index = Math.round((((angle % 360) + 360) % 360) / 45) % 8;
  return DIRECTIONS[index];
}

function boxArea(box) {
  return (box.north - box.south) * (box.east - box.west);
}

function contains(box, lat, lon) {
  return lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east;
}

export function chooseBox(results, lat, lon, expectedName) {
  const wanted = String(expectedName || "").trim().toLowerCase();
  const parsed = (Array.isArray(results) ? results : [])
    .map((result) => ({
      result,
      box: parseBox(result.boundingbox),
      name: String(result.name || "").trim().toLowerCase(),
    }))
    .filter((entry) => entry.box);

  let pool = parsed.filter((entry) => !wanted || entry.name === wanted);
  if (pool.length === 0) pool = parsed;

  const inside = pool.filter((entry) => contains(entry.box, lat, lon));
  const ranked = (inside.length > 0 ? inside : pool).sort((a, b) => {
    const aCity = a.result.addresstype === "city" || a.result.addresstype === "country" ? 0 : 1;
    const bCity = b.result.addresstype === "city" || b.result.addresstype === "country" ? 0 : 1;
    if (aCity !== bCity) return aCity - bCity;
    return boxArea(b.box) - boxArea(a.box);
  });

  const winner = ranked[0];
  if (!winner) return null;
  return withCenter(winner.box, winner.result);
}

export function hintFromPlace(lat, lon, place, box) {
  const country = place?.country || NA;
  const city = place?.city || NA;
  return {
    country,
    city,
    area: box ? compassSector(lat, lon, box) : NA,
  };
}
