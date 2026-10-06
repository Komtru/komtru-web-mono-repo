// The trust module (M6): the §11 user surface, the two provider-touching queues, and the sweep that
// stops an unanswered verification hanging forever.
//
// This is also the module's composition root — the one file allowed to reach into `jobs/`, where the
// KYC adapter is constructed (design §4.4, T-028). Nothing in `services/` or `http/` can follow that
// path, which is what keeps every provider call inside a job.
import { defineModule, type KomtruModule } from '../../platform/module.js';

export function createTrustModule(): KomtruModule {
  return defineModule({ name: 'trust' });
}

export const trustModule = createTrustModule();
