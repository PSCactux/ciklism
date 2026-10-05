import { RoutePath, routeRecordId, type Route } from '../domain/route';
import { routeLevel } from '../domain/progress';
import { ROUTE_PREVIEWS } from '../render/preview';
const files = import.meta.glob<Route>('./*.json', { eager: true, import: 'default' });
const descriptions: Record<string, string> = {
  ovalo: 'Un circuito suave para encontrar tu ritmo.',
  ruta_inicial: 'Una vuelta entre pinos y agua turquesa.',
  valle: 'Doce kilómetros junto al río, entre prados y laderas.',
  puerto: 'Veinte kilómetros de montaña, roca y ascenso.',
  embalse: 'Kilómetros tranquilos alrededor del agua.',
  ermita: 'La subida larga. Las mejores vistas.',
};
export const routes = Object.entries(files).map(([file, route]) => {
  const id = file.replace('./', '').replace('.json', '');
  return { id, recordId: routeRecordId(id, route), route, path: new RoutePath(route), level: routeLevel[id] ?? 1, description: descriptions[id] ?? '', preview: ROUTE_PREVIEWS[id] };
}).sort((a, b) => a.level - b.level || a.path.totalLength - b.path.totalLength);
export type RouteOption = typeof routes[number];
