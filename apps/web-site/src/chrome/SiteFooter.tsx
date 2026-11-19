import Image from 'next/image';
import Link from 'next/link';
import {
  FacebookIcon,
  InstagramIcon,
  LinkedInIcon,
  WhatsAppRoundIcon,
  XIcon,
  YouTubeIcon,
} from '../art/Icons';
import { CONTACT, FOOTER_COLUMNS, SOCIAL_LINKS } from '../site/nav';

/** Keyed by the label in `SOCIAL_LINKS`, so a new account cannot be added without its mark. */
const SOCIAL_ICONS: Record<string, () => React.JSX.Element> = {
  Facebook: FacebookIcon,
  Instagram: InstagramIcon,
  X: XIcon,
  LinkedIn: LinkedInIcon,
  YouTube: YouTubeIcon,
  WhatsApp: WhatsAppRoundIcon,
};

/**
 * The footer. A Server Component: it holds no state and reads no environment.
 *
 * The last line — "Komtru never asks you to pay from a link" — is on every page on purpose. It is
 * the one instruction that protects someone who has read nothing else on the site, and the reference
 * repeats it in the footer for exactly that reason.
 */
export function SiteFooter(): React.JSX.Element {
  return (
    <footer className="site-footer">
      <div className="w">
        <div className="fg">
          <div>
            {/* White on midnight: the mark is dark, so it is inverted rather than shipped twice. */}
            <Image
              src="/komtru-logo.png"
              alt="Komtru"
              width={98}
              height={26}
              style={{ filter: 'brightness(0) invert(1)', height: 26, width: 'auto', marginBottom: 14 }}
            />
            <p className="ftl">
              Come through with confidence. Trust infrastructure for people who buy and sell on social media.
            </p>
            <p className="ftc">Lagos · Abuja · Port Harcourt · Jos</p>
            <div className="soc" aria-label="Komtru on social media">
              {SOCIAL_LINKS.map(({ href, label }) => {
                const Icon = SOCIAL_ICONS[label];
                return (
                  <a key={label} href={href} target="_blank" rel="noopener" aria-label={label}>
                    {Icon === undefined ? null : <Icon />}
                  </a>
                );
              })}
            </div>
          </div>

          {FOOTER_COLUMNS.map(({ title, links }) => (
            <div key={title}>
              <b>{title}</b>
              {links.map(({ href, label }) => (
                <Link key={href} href={href}>
                  {label}
                </Link>
              ))}
            </div>
          ))}

          <div>
            <b>Reach us</b>
            <p className="fad">{CONTACT.address}</p>
            <p className="fad">
              <a href={`mailto:${CONTACT.operationsEmail}`}>{CONTACT.operationsEmail}</a>
            </p>
          </div>
        </div>
        <div className="fb">
          <span>© Komtru. All rights reserved.</span>
          <span>Komtru never asks you to pay from a link.</span>
        </div>
      </div>
    </footer>
  );
}
