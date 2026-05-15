const DEG = Math.PI / 180;

export function getUtmZoneFromLon(lon) {
  return Math.floor((Number(lon) + 180) / 6) + 1;
}

export function wgs84ToUtm(lat, lon, zoneOverride = 19) {
  const zone = zoneOverride || getUtmZoneFromLon(lon);
  const latRad = Number(lat) * DEG;
  const lonRad = Number(lon) * DEG;
  const lonOrigin = ((zone - 1) * 6 - 180 + 3) * DEG;
  const a = 6378137.0;
  const eccSquared = 0.00669437999014;
  const k0 = 0.9996;
  const eccPrimeSquared = eccSquared / (1 - eccSquared);
  const n = a / Math.sqrt(1 - eccSquared * Math.sin(latRad) ** 2);
  const t = Math.tan(latRad) ** 2;
  const c = eccPrimeSquared * Math.cos(latRad) ** 2;
  const aa = Math.cos(latRad) * (lonRad - lonOrigin);
  const m = a * (
    (1 - eccSquared / 4 - 3 * eccSquared ** 2 / 64 - 5 * eccSquared ** 3 / 256) * latRad -
    (3 * eccSquared / 8 + 3 * eccSquared ** 2 / 32 + 45 * eccSquared ** 3 / 1024) * Math.sin(2 * latRad) +
    (15 * eccSquared ** 2 / 256 + 45 * eccSquared ** 3 / 1024) * Math.sin(4 * latRad) -
    (35 * eccSquared ** 3 / 3072) * Math.sin(6 * latRad)
  );
  const easting = k0 * n * (aa + (1 - t + c) * aa ** 3 / 6 + (5 - 18 * t + t ** 2 + 72 * c - 58 * eccPrimeSquared) * aa ** 5 / 120) + 500000;
  let northing = k0 * (m + n * Math.tan(latRad) * (aa ** 2 / 2 + (5 - t + 9 * c + 4 * c ** 2) * aa ** 4 / 24 + (61 - 58 * t + t ** 2 + 600 * c - 330 * eccPrimeSquared) * aa ** 6 / 720));
  if (Number(lat) < 0) northing += 10000000;
  return { easting, northing, zone, hemisphere: Number(lat) < 0 ? 'S' : 'N' };
}

export function latLonToProjectPoint(lat, lon) {
  const utm = wgs84ToUtm(lat, lon, 19);
  return {
    lat: Number(lat),
    lon: Number(lon),
    x: round(utm.easting, 3),
    y: round(utm.northing, 3),
    zone: '19L'
  };
}

export function projectPointToLatLng(point) {
  if (Number.isFinite(point?.lat) && Number.isFinite(point?.lon)) return [point.lat, point.lon];
  return null;
}

export function round(value, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
}
