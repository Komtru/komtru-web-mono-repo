// The geo module's public surface: the location catalog every address, hub and trade form reads
// (T-046, design 7.8). Other modules reach the schema, the events and `getCitiesByIds` through here
// and nothing else; the komtru/module-boundaries rule makes this the only way in.
//
// A city is never deleted, so a city id stored on an address, a hub or a trade stays resolvable:
// `getCitiesByIds` returns deactivated cities too, flagged `active: false`.
import { createGeoModule } from './module.js';

export * from './infrastructure/postgres/schema/index.js';
export * from './domain/events.js';
export { citiesByIds as getCitiesByIds, type CityWithState } from './services/catalog.service.js';
export { seedLocations } from './services/seed.service.js';
export { createGeoModule };

export const geoModule = createGeoModule();
