import { interpolateByMaxSpan, nearestPoint, uniqueId } from '../gis/geometryUtils.js';

export function buildPreliminaryNetwork({ childSubstations, clients, assignments, rules }) {
  const poles = [];
  const lines = [];
  const serviceDrops = [];

  childSubstations.forEach((sed) => {
    const assignedClients = clients.filter((client) => assignments[client.id]?.childSedId === sed.id);
    assignedClients.forEach((client) => {
      const route = interpolateByMaxSpan([sed, client], rules.btMaxSpanMeters);
      const routePoles = route.slice(1, -1).map((point, index) => ({
        id: uniqueId('PBT'),
        name: `Poste BT ${poles.length + index + 1}`,
        source: 'preliminar',
        childSedId: sed.id,
        ...point
      }));
      poles.push(...routePoles);

      const networkPoints = [sed, ...routePoles];
      if (networkPoints.length > 1) {
        lines.push({
          id: uniqueId('TBT'),
          type: 'bt',
          childSedId: sed.id,
          points: networkPoints,
          source: 'preliminar_por_referencia_directa'
        });
      }

      const nearestPole = nearestPoint(client, routePoles.length ? routePoles : [sed]).point || sed;
      serviceDrops.push({
        id: uniqueId('ACO'),
        type: 'service_drop',
        childSedId: sed.id,
        clientId: client.id,
        points: [nearestPole, client],
        source: 'preliminar'
      });
    });
  });

  return { poles, lines, serviceDrops };
}
