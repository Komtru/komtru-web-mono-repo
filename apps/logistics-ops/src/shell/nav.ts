// The portal's sections. One for now: package requests join it with T-162, and a nav item for a
// screen that does not exist yet would be a stub.
export const SECTIONS = [{ id: 'team', label: 'Team', href: '/team' }] as const;
export type SectionId = (typeof SECTIONS)[number]['id'];
