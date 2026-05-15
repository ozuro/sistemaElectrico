import { nearestPoint } from '../gis/geometryUtils.js';

export function assignClientsToNearestChildSed(clients, childSubstations) {
  const assignments = {};
  if (!childSubstations.length) return assignments;
  clients.forEach((client) => {
    const nearest = nearestPoint(client, childSubstations);
    if (nearest.point) {
      assignments[client.id] = {
        childSedId: nearest.point.id,
        distanceMeters: Math.round(nearest.distance)
      };
    }
  });
  return assignments;
}
