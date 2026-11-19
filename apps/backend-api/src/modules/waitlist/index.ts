// The waitlist module's public surface. Nothing else in the platform reads this table: the list is
// for operations to message before launch, and a signup becomes nothing until the person signs up
// properly. The schema is exported so drizzle-kit and the test harness can see it.
import { createWaitlistModule } from './module.js';

export * from './schema.js';
export { WAITLIST_CHANNELS, WAITLIST_INTENTS, readContact } from './domain/contact.js';
export { WAITLIST_SOURCES, readSource, type WaitlistSource } from './domain/source.js';
export { createWaitlistModule };

export const waitlistModule = createWaitlistModule();
