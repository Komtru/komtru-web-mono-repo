/*
 * The reference's icons. Each keeps the reference's own stroke widths and fills; the social marks
 * are the footer's, drawn white on the midnight band.
 *
 * The App Store and Google Play marks went with the QR card: there is no app to download, so a
 * store badge is a link to nothing wearing a brand that is not ours to imply.
 *
 * None of them carries a label: every one sits inside a link or a badge that is already named, so
 * announcing the glyph as well would say everything twice.
 */

export function WhatsAppIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-8.600 15.100L2 22l5-1.300A10 10 0 1 0 12 2zm0 18.200c-1.500 0-3-.4-4.200-1.200l-.3-.2-3 .8.8-2.900-.2-.3A8.200 8.200 0 1 1 12 20.200zm4.500-6.100c-.2-.1-1.500-.7-1.700-.8s-.4-.1-.6.100l-.8 1c-.1.200-.3.200-.5.100-1.400-.7-2.400-1.300-3.300-2.900-.3-.5.200-.5.700-1.500.1-.2 0-.3 0-.5l-.8-1.800c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.100-.7.300-.3.300-1 1-1 2.400s1 2.800 1.200 3c.1.200 2 3.100 4.900 4.300 1.800.8 2.500.8 3.400.7.500-.1 1.600-.7 1.900-1.300.2-.6.2-1.200.2-1.300-.1-.1-.3-.2-.5-.3z" />
    </svg>
  );
}

export function FacebookIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="#fff" aria-hidden="true">
      <path d="M14 8h3V4h-3a4 4 0 0 0-4 4v2H7v4h3v7h4v-7h3l1-4h-4V8z" />
    </svg>
  );
}

export function InstagramIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="#fff"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="16" height="16" rx="5" />
      <circle cx="12" cy="12" r="3.6" />
      <circle cx="17" cy="7" r=".8" fill="#fff" />
    </svg>
  );
}

export function XIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="#fff"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 5l14 14M19 5L5 19" />
    </svg>
  );
}

export function LinkedInIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="#fff" aria-hidden="true">
      <path d="M5 9h3v10H5zM6.5 4.5a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.600zM10 9h3v1.400C13.600 9.400 14.700 8.800 16 8.800c3 0 3.500 2 3.500 4.500V19h-3v-5c0-1.200 0-2.700-1.700-2.700S13 12.600 13 14v5h-3z" />
    </svg>
  );
}

export function YouTubeIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="#fff" aria-hidden="true">
      <path d="M21 8.200c-.2-1-1-1.700-2-1.900C17.500 6 12 6 12 6s-5.500 0-7 .3c-1 .2-1.800.9-2 1.900C3 9.700 3 12 3 12s0 2.300.3 3.800c.2 1 1 1.700 2 1.900C6.500 18 12 18 12 18s5.500 0 7-.3c1-.2 1.800-.9 2-1.900.3-1.500.3-3.800.3-3.800s0-2.300-.3-3.800zM10 15V9l5 3z" />
    </svg>
  );
}

export function WhatsAppRoundIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="#fff" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.500 0-3-.4-4.200-1.200l-.3-.2-3 .8.8-2.900-.2-.3A8.200 8.200 0 1 1 12 20.200zm4.500-6.100c-.2-.1-1.500-.7-1.700-.8s-.4-.1-.6.1l-.8 1c-.1.200-.3.200-.5.100-1.400-.7-2.400-1.300-3.300-2.900-.3-.5.200-.5.700-1.500.1-.2 0-.3 0-.5l-.8-1.800c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.100-.7.300-.3.300-1 1-1 2.400s1 2.800 1.200 3c.1.200 2 3.100 4.900 4.300 1.800.8 2.500.8 3.400.7.5-.1 1.600-.7 1.900-1.300.2-.6.2-1.200.2-1.300-.1-.1-.3-.2-.5-.3z" />
    </svg>
  );
}

/** The three faces above "Still have questions?". Decorative; the heading does the talking. */
export const FAQ_AVATARS = [
  <svg key="68" className="avt" viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="24" r="24" fill="#E5F5EE" />
    <path d="M6 46c0-12 8-17 18-17s18 5 18 17z" fill="#0D1420" opacity=".85" />
    <ellipse cx="24" cy="19" rx="8" ry="9" fill="#8A5A3C" />
    <path d="M15 18c-1-8 5-12 10-11 6 1 9 6 8 11-2-4-5-6-9-6s-7 2-9 6z" fill="#14100e" />
  </svg>,
  <svg key="69" className="avt" viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="24" r="24" fill="#FBF0DD" />
    <path d="M6 46c0-12 8-17 18-17s18 5 18 17z" fill="#0D1420" opacity=".85" />
    <ellipse cx="24" cy="19" rx="8" ry="9" fill="#A56F4D" />
    <path d="M15 18c-1-8 5-12 10-11 6 1 9 6 8 11-2-4-5-6-9-6s-7 2-9 6z" fill="#2a1a12" />
  </svg>,
  <svg key="70" className="avt" viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="24" r="24" fill="#EDEFFC" />
    <path d="M6 46c0-12 8-17 18-17s18 5 18 17z" fill="#0D1420" opacity=".85" />
    <ellipse cx="24" cy="19" rx="8" ry="9" fill="#6E4430" />
    <path d="M15 18c-1-8 5-12 10-11 6 1 9 6 8 11-2-4-5-6-9-6s-7 2-9 6z" fill="#0e0b0a" />
  </svg>,
];
