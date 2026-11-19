/**
 * The site's own map: the seven links in the header, and the four columns in the footer.
 *
 * One list, used by the desktop nav, the mobile menu and the footer, because three copies of the
 * same seven links is three places for a renamed page to go stale.
 *
 * The reference routed with `#/buyers`; these are real paths. A hash route is one document that
 * swaps its contents, which costs the site every page's own URL, its own title and its own place
 * in a search index — all three of which are most of the point of having a marketing site.
 */

export interface SiteLink {
  readonly href: string;
  readonly label: string;
}

/** The header, in the reference's order. */
export const NAV_LINKS: readonly SiteLink[] = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/buyers', label: 'For buyers' },
  { href: '/sellers', label: 'For sellers' },
  { href: '/safety', label: 'Safety' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/hubs', label: 'Park hubs' },
  { href: '/help', label: 'Help' },
];

export interface FooterColumn {
  readonly title: string;
  readonly links: readonly SiteLink[];
}

export const FOOTER_COLUMNS: readonly FooterColumn[] = [
  {
    title: 'Product',
    links: [
      { href: '/how-it-works', label: 'How it works' },
      { href: '/buyers', label: 'For buyers' },
      { href: '/sellers', label: 'For sellers' },
      { href: '/passport', label: 'Trust Passport' },
      { href: '/trade-code', label: 'Check a Trade Code' },
      { href: '/pricing', label: 'Pricing' },
    ],
  },
  {
    title: 'Safety & Help',
    links: [
      { href: '/safety', label: 'Safety' },
      { href: '/hubs', label: 'Park hubs' },
      { href: '/help', label: 'Help' },
      { href: '/contact', label: 'Contact' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/terms', label: 'Terms & privacy' },
    ],
  },
];

/** The accounts the footer links out to, in the reference's order. */
export const SOCIAL_LINKS = [
  { href: 'https://facebook.com/usekomtru', label: 'Facebook' },
  { href: 'https://instagram.com/usekomtru', label: 'Instagram' },
  { href: 'https://x.com/usekomtru', label: 'X' },
  { href: 'https://linkedin.com/company/usekomtru', label: 'LinkedIn' },
  { href: 'https://youtube.com/@usekomtru', label: 'YouTube' },
  { href: 'https://wa.me/2349113433333', label: 'WhatsApp' },
] as const;

/** How to reach Komtru, stated once. The support number is also the one the Safety page warns about. */
export const CONTACT = {
  whatsapp: '+234 911 343 3333',
  whatsappHref: 'https://wa.me/2349113433333',
  supportEmail: 'support@komtru.com',
  operationsEmail: 'operations@komtru.com',
  address: '4 Beach Road FCMB Building Off Ahmadu Bello-way, Jos, Nigeria.',
} as const;

/** The four launch cities, in the order the rail scrolls them. */
export const LAUNCH_CITIES = [
  { slug: 'lagos', name: 'Lagos' },
  { slug: 'plateau', name: 'Plateau' },
  { slug: 'port-harcourt', name: 'Port Harcourt' },
  { slug: 'abuja', name: 'Abuja' },
] as const;
