export function distanceMeters(a, b) {
  if (!a || !b) return Infinity;
  if (Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(b.x) && Number.isFinite(b.y)) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  return haversineMeters(a.lat, a.lon, b.lat, b.lon);
}

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const r = 6371000;
  const p1 = Number(lat1) * Math.PI / 180;
  const p2 = Number(lat2) * Math.PI / 180;
  const dp = (Number(lat2) - Number(lat1)) * Math.PI / 180;
  const dl = (Number(lon2) - Number(lon1)) * Math.PI / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function nearestPoint(target, points) {
  let best = null;
  let bestDistance = Infinity;
  for (const point of points || []) {
    const d = distanceMeters(target, point);
    if (d < bestDistance) {
      best = point;
      bestDistance = d;
    }
  }
  return { point: best, distance: bestDistance };
}

export function lineLengthMeters(points) {
  let total = 0;
  for (let i = 1; i < (points || []).length; i += 1) {
    total += distanceMeters(points[i - 1], points[i]);
  }
  return total;
}

export function interpolateByMaxSpan(points, maxSpanMeters) {
  const output = [];
  for (let i = 0; i < (points || []).length; i += 1) {
    const current = points[i];
    if (!current) continue;
    if (!output.length) output.push(current);
    const next = points[i + 1];
    if (!next) continue;
    const length = distanceMeters(current, next);
    const parts = Math.max(1, Math.ceil(length / maxSpanMeters));
    for (let part = 1; part <= parts; part += 1) {
      const t = part / parts;
      output.push({
        lat: current.lat + (next.lat - current.lat) * t,
        lon: current.lon + (next.lon - current.lon) * t,
        x: current.x + (next.x - current.x) * t,
        y: current.y + (next.y - current.y) * t,
        zone: current.zone || next.zone
      });
    }
  }
  return output;
}

export function uniqueId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}
