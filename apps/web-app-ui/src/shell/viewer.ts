import { ANONYMOUS_VIEWER, type Viewer } from './nav';

/**
 * Who the shell is being drawn for.
 *
 * This is the seam, and it is deliberately the only one. Certification, having sold and the Park
 * Agent state all come from the signed-in person's capabilities, which arrive with the session
 * (T-111) and the capability reads (T-050, T-055, T-091). Until then there is nothing to read and
 * the answer is the anonymous viewer — the smallest shell, so nothing appears that the person turns
 * out not to have.
 *
 * Already a promise so the ticket that fills it in changes one function body and no callers.
 */
export const resolveViewer = (): Promise<Viewer> => Promise.resolve(ANONYMOUS_VIEWER);
