// Putting the shipped catalogue into the database at boot.
//
// Insert-only, never update. The database is what a send renders from, so an operator who edited a
// row — fixed a typo at 2am, turned a noisy mapping off — must not have it stamped back on by the
// next deploy. A copy change in the catalogue is therefore a NEW `version`, which is also what the
// admin endpoint will create (M11 D5), and dispatch always picks the highest active version.
import type { Db } from '../../../db/index.js';
import type { NotificationCatalogue } from '../domain/catalogue.js';
import { notificationEventMappings, notificationTemplates } from '../infrastructure/postgres/schema/index.js';

export interface SyncResult {
  templates: number;
  mappings: number;
}

export async function syncCatalogue(db: Db, catalogue: NotificationCatalogue): Promise<SyncResult> {
  if (!catalogue.templates.length && !catalogue.mappings.length) return { templates: 0, mappings: 0 };

  const templates = catalogue.templates.length
    ? await db
        .insert(notificationTemplates)
        .values(
          catalogue.templates.map((template) => ({
            templateKey: template.templateKey,
            channel: template.channel,
            category: template.category,
            locale: template.locale,
            version: template.version,
            ...(template.subject === undefined ? {} : { subject: template.subject }),
            body: template.body,
            variables: template.variables,
            isSecurityCritical: template.isSecurityCritical,
          })),
        )
        // Two processes booting at once hit this; so does every restart.
        .onConflictDoNothing()
        .returning({ id: notificationTemplates.id })
    : [];

  const mappings = catalogue.mappings.length
    ? await db
        .insert(notificationEventMappings)
        .values(
          catalogue.mappings.map((mapping) => ({
            eventName: mapping.eventName,
            templateKey: mapping.templateKey,
            enabled: mapping.enabled,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: notificationEventMappings.id })
    : [];

  return { templates: templates.length, mappings: mappings.length };
}
