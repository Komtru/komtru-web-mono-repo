/*
 * The reference's illustrations, carried across unchanged.
 *
 * Each was drawn as inline SVG in the design file rather than exported as an asset, and each is
 * small enough (1-3KB) that inlining still beats a request. They are decorative-with-a-caption:
 * every scene keeps the reference's own `role="img"` and `aria-label`, which is what a screen
 * reader announces in place of the picture.
 */

/** Two people agreeing the terms of a trade */
export function AgreementScene(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 480 360"
      role="img"
      aria-label="Two people agreeing the terms of a trade"
      preserveAspectRatio="xMidYMid slice"
    >
      <rect width="480" height="360" fill="#E5F5EE" />
      <circle cx="410" cy="60" r="90" fill="#fff" opacity=".5" />
      <circle cx="50" cy="320" r="70" fill="#fff" opacity=".4" />
      <g transform="translate(100 170) scale(1.1)">
        <path d="M-52 130c0-56 24-84 52-84s52 28 52 84z" fill="#4552D6" />
        <rect x="-10" y="26" width="20" height="26" rx="8" fill="#8A5A3C" />
        <ellipse cx="0" cy="6" rx="27" ry="31" fill="#8A5A3C" />
        <path
          d="M-29 2c-4-36 22-48 38-44 24 4 26 30 20 44-6-18-18-26-32-26-12 0-20 10-26 26z"
          fill="#14100e"
        />
        <circle cx="-9" cy="8" r="2.6" fill="#1a110c" />
        <circle cx="9" cy="8" r="2.6" fill="#1a110c" />
        <path d="M-8 20q8 6 16 0" stroke="#1a110c" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      </g>
      <g transform="translate(380 170) scale(1.1)">
        <path d="M-52 130c0-56 24-84 52-84s52 28 52 84z" fill="#0D1420" />
        <rect x="-10" y="26" width="20" height="26" rx="8" fill="#7C4E34" />
        <ellipse cx="0" cy="6" rx="27" ry="31" fill="#7C4E34" />
        <path d="M-30 6c-6-40 18-52 32-50 22 2 32 20 26 50-4-22-16-34-28-34s-24 12-30 34z" fill="#0e0b0a" />
        <circle cx="-26" cy="-18" r="9" fill="#0e0b0a" />
        <circle cx="26" cy="-18" r="9" fill="#0e0b0a" />
        <circle cx="-9" cy="8" r="2.6" fill="#1a110c" />
        <circle cx="9" cy="8" r="2.6" fill="#1a110c" />
        <path d="M-8 20q8 6 16 0" stroke="#1a110c" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      </g>
      <rect x="170" y="70" width="140" height="190" rx="16" fill="#fff" stroke="#E5E9F0" />
      <rect x="186" y="86" width="108" height="8" rx="4" fill="#0D1420" />
      <path
        d="M188 120l7 7 12-14"
        stroke="#159768"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="218" y="118" width="70" height="6" rx="3" fill="#E5E9F0" />
      <path
        d="M188 152l7 7 12-14"
        stroke="#159768"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="218" y="150" width="62" height="6" rx="3" fill="#E5E9F0" />
      <path
        d="M188 184l7 7 12-14"
        stroke="#159768"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="218" y="182" width="54" height="6" rx="3" fill="#E5E9F0" />
      <path
        d="M188 216l7 7 12-14"
        stroke="#159768"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="218" y="214" width="46" height="6" rx="3" fill="#E5E9F0" />
    </svg>
  );
}

/** A buyer reviewing a protected trade on their phone */
export function BuyerScene(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 480 360"
      role="img"
      aria-label="A buyer reviewing a protected trade on their phone"
      preserveAspectRatio="xMidYMid slice"
    >
      <rect width="480" height="360" fill="#EDEFFC" />
      <circle cx="410" cy="60" r="90" fill="#fff" opacity=".5" />
      <circle cx="50" cy="320" r="70" fill="#fff" opacity=".4" />
      <g transform="translate(150 150) scale(1.25)">
        <path d="M-52 130c0-56 24-84 52-84s52 28 52 84z" fill="#4552D6" />
        <rect x="-10" y="26" width="20" height="26" rx="8" fill="#8A5A3C" />
        <ellipse cx="0" cy="6" rx="27" ry="31" fill="#8A5A3C" />
        <path
          d="M-29 2c-4-36 22-48 38-44 24 4 26 30 20 44-6-18-18-26-32-26-12 0-20 10-26 26z"
          fill="#14100e"
        />
        <circle cx="-9" cy="8" r="2.6" fill="#1a110c" />
        <circle cx="9" cy="8" r="2.6" fill="#1a110c" />
        <path d="M-8 20q8 6 16 0" stroke="#1a110c" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <g transform="rotate(-12 34 96)">
          <rect x="18" y="62" width="34" height="62" rx="7" fill="#0D1420" />
          <rect x="21" y="66" width="28" height="54" rx="5" fill="#fff" />
          <rect x="24" y="72" width="22" height="5" rx="2" fill="#159768" />
          <rect x="24" y="82" width="16" height="3" rx="1.5" fill="#E5E9F0" />
        </g>
        <ellipse cx="30" cy="108" rx="13" ry="9" fill="#8A5A3C" />
      </g>
      <rect x="270" y="50" width="170" height="220" rx="16" fill="#fff" stroke="#E5E9F0" />
      <rect x="286" y="66" width="60" height="60" rx="10" fill="#F5F7FA" />
      <text
        x="286"
        y="152"
        fontFamily="Space Grotesk,sans-serif"
        fontSize="18"
        fontWeight="600"
        fill="#0D1420"
      >
        ₦452,000
      </text>
      <rect x="286" y="164" width="120" height="6" rx="3" fill="#E5E9F0" />
      <rect x="286" y="178" width="90" height="6" rx="3" fill="#E5E9F0" />
      <rect x="286" y="192" width="110" height="6" rx="3" fill="#E5E9F0" />
      <rect x="286" y="226" width="138" height="30" rx="8" fill="#0D1420" />
      <g>
        <rect x="250" y="30" width="160" height="30" rx="15" fill="#E5F5EE" />
        <circle cx="266" cy="45" r="4" fill="#0C6B49" />
        <text x="278" y="50" fontFamily="Inter,sans-serif" fontSize="12" fontWeight="600" fill="#0C6B49">
          Payment protected
        </text>
      </g>
    </svg>
  );
}

/** A seller packing a parcel after the buyer has paid */
export function SellerScene(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 480 360"
      role="img"
      aria-label="A seller packing a parcel after the buyer has paid"
      preserveAspectRatio="xMidYMid slice"
    >
      <rect width="480" height="360" fill="#E5F5EE" />
      <circle cx="410" cy="60" r="90" fill="#fff" opacity=".5" />
      <circle cx="50" cy="320" r="70" fill="#fff" opacity=".4" />
      <rect x="40" y="280" width="400" height="16" rx="8" fill="#0D1420" opacity=".12" />
      <rect x="250" y="190" width="150" height="100" rx="8" fill="#F2C063" />
      <rect x="310" y="190" width="30" height="100" fill="#D9A23D" />
      <g transform="translate(160 150) scale(1.3)">
        <path d="M-52 130c0-56 24-84 52-84s52 28 52 84z" fill="#0D1420" />
        <rect x="-10" y="26" width="20" height="26" rx="8" fill="#6E4430" />
        <ellipse cx="0" cy="6" rx="27" ry="31" fill="#6E4430" />
        <path d="M-30 6c-6-40 18-52 32-50 22 2 32 20 26 50-4-22-16-34-28-34s-24 12-30 34z" fill="#0e0b0a" />
        <circle cx="-26" cy="-18" r="9" fill="#0e0b0a" />
        <circle cx="26" cy="-18" r="9" fill="#0e0b0a" />
        <circle cx="-9" cy="8" r="2.6" fill="#1a110c" />
        <circle cx="9" cy="8" r="2.6" fill="#1a110c" />
        <path d="M-8 20q8 6 16 0" stroke="#1a110c" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      </g>
      <rect x="300" y="70" width="130" height="80" rx="16" fill="#fff" stroke="#E5E9F0" />
      <text
        x="316"
        y="104"
        fontFamily="Space Grotesk,sans-serif"
        fontSize="20"
        fontWeight="600"
        fill="#0D1420"
      >
        ₦89,500
      </text>
      <rect x="316" y="116" width="90" height="6" rx="3" fill="#E5E9F0" />
      <rect x="316" y="130" width="60" height="6" rx="3" fill="#E5E9F0" />
      <g>
        <rect x="40" y="40" width="150" height="30" rx="15" fill="#E5F5EE" />
        <circle cx="56" cy="55" r="4" fill="#0C6B49" />
        <text x="68" y="60" fontFamily="Inter,sans-serif" fontSize="12" fontWeight="600" fill="#0C6B49">
          Buyer has paid
        </text>
      </g>
    </svg>
  );
}

/** A motor-park hub where parcels are collected */
export function HubScene(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 480 360"
      role="img"
      aria-label="A motor-park hub where parcels are collected"
      preserveAspectRatio="xMidYMid slice"
    >
      <rect width="480" height="360" fill="#FBF0DD" />
      <circle cx="410" cy="60" r="90" fill="#fff" opacity=".5" />
      <circle cx="50" cy="320" r="70" fill="#fff" opacity=".4" />
      <rect x="40" y="290" width="400" height="10" rx="5" fill="#0D1420" opacity=".15" />
      <rect x="60" y="150" width="260" height="120" rx="18" fill="#4552D6" />
      <rect x="80" y="168" width="50" height="40" rx="6" fill="#EDEFFC" />
      <rect x="140" y="168" width="50" height="40" rx="6" fill="#EDEFFC" />
      <rect x="200" y="168" width="50" height="40" rx="6" fill="#EDEFFC" />
      <rect x="260" y="168" width="44" height="80" rx="6" fill="#EDEFFC" />
      <circle cx="120" cy="272" r="22" fill="#0D1420" />
      <circle cx="120" cy="272" r="9" fill="#ccc" />
      <circle cx="260" cy="272" r="22" fill="#0D1420" />
      <circle cx="260" cy="272" r="9" fill="#ccc" />
      <rect x="330" y="230" width="60" height="50" rx="6" fill="#F2C063" />
      <rect x="345" y="196" width="46" height="38" rx="6" fill="#D9A23D" />
      <g transform="translate(410 170) scale(0.9)">
        <path d="M-52 130c0-56 24-84 52-84s52 28 52 84z" fill="#159768" />
        <rect x="-10" y="26" width="20" height="26" rx="8" fill="#A56F4D" />
        <ellipse cx="0" cy="6" rx="27" ry="31" fill="#A56F4D" />
        <path
          d="M-29 2c-4-36 22-48 38-44 24 4 26 30 20 44-6-18-18-26-32-26-12 0-20 10-26 26z"
          fill="#1a120d"
        />
        <circle cx="-9" cy="8" r="2.6" fill="#1a110c" />
        <circle cx="9" cy="8" r="2.6" fill="#1a110c" />
        <path d="M-8 20q8 6 16 0" stroke="#1a110c" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      </g>
      <path d="M200 40c-18 0-30 14-30 30 0 22 30 50 30 50s30-28 30-50c0-16-12-30-30-30z" fill="#159768" />
      <circle cx="200" cy="70" r="10" fill="#fff" />
    </svg>
  );
}

/** A Trust Passport card with trade history */
export function PassportScene(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 480 360"
      role="img"
      aria-label="A Trust Passport card with trade history"
      preserveAspectRatio="xMidYMid slice"
    >
      <rect width="480" height="360" fill="#EDEFFC" />
      <circle cx="410" cy="60" r="90" fill="#fff" opacity=".5" />
      <circle cx="50" cy="320" r="70" fill="#fff" opacity=".4" />
      <rect x="60" y="60" width="230" height="240" rx="16" fill="#fff" stroke="#E5E9F0" />
      <rect x="60" y="60" width="230" height="86" rx="16" fill="#0D1420" />
      <circle cx="102" cy="103" r="22" fill="#8A5A3C" />
      <text x="136" y="98" fontFamily="Space Grotesk,sans-serif" fontSize="16" fontWeight="600" fill="#fff">
        TechEdge NG
      </text>
      <text x="136" y="118" fontFamily="Inter,sans-serif" fontSize="11" fill="#fff" opacity=".7">
        Trust Passport
      </text>
      <text x="80" y="190" fontFamily="IBM Plex Mono,monospace" fontSize="22" fontWeight="600" fill="#0D1420">
        342
      </text>
      <text x="80" y="206" fontFamily="Inter,sans-serif" fontSize="10" fill="#4C5568">
        Trades
      </text>
      <text
        x="180"
        y="190"
        fontFamily="IBM Plex Mono,monospace"
        fontSize="22"
        fontWeight="600"
        fill="#0D1420"
      >
        98.7%
      </text>
      <text x="180" y="206" fontFamily="Inter,sans-serif" fontSize="10" fill="#4C5568">
        Fulfilment
      </text>
      <text x="80" y="244" fontFamily="IBM Plex Mono,monospace" fontSize="22" fontWeight="600" fill="#0D1420">
        2.1d
      </text>
      <text x="80" y="260" fontFamily="Inter,sans-serif" fontSize="10" fill="#4C5568">
        Delivery
      </text>
      <text
        x="180"
        y="244"
        fontFamily="IBM Plex Mono,monospace"
        fontSize="22"
        fontWeight="600"
        fill="#0D1420"
      >
        4 yrs
      </text>
      <text x="180" y="260" fontFamily="Inter,sans-serif" fontSize="10" fill="#4C5568">
        Active
      </text>
      <g transform="translate(380 190) scale(1.1)">
        <path d="M-52 130c0-56 24-84 52-84s52 28 52 84z" fill="#159768" />
        <rect x="-10" y="26" width="20" height="26" rx="8" fill="#A56F4D" />
        <ellipse cx="0" cy="6" rx="27" ry="31" fill="#A56F4D" />
        <path
          d="M-29 2c-4-36 22-48 38-44 24 4 26 30 20 44-6-18-18-26-32-26-12 0-20 10-26 26z"
          fill="#1a120d"
        />
        <circle cx="-9" cy="8" r="2.6" fill="#1a110c" />
        <circle cx="9" cy="8" r="2.6" fill="#1a110c" />
        <path d="M-8 20q8 6 16 0" stroke="#1a110c" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <g transform="rotate(-12 34 96)">
          <rect x="18" y="62" width="34" height="62" rx="7" fill="#0D1420" />
          <rect x="21" y="66" width="28" height="54" rx="5" fill="#fff" />
          <rect x="24" y="72" width="22" height="5" rx="2" fill="#159768" />
          <rect x="24" y="82" width="16" height="3" rx="1.5" fill="#E5E9F0" />
        </g>
        <ellipse cx="30" cy="108" rx="13" ry="9" fill="#A56F4D" />
      </g>
      <g>
        <rect x="300" y="60" width="150" height="30" rx="15" fill="#E5F5EE" />
        <circle cx="316" cy="75" r="4" fill="#0C6B49" />
        <text x="328" y="80" fontFamily="Inter,sans-serif" fontSize="12" fontWeight="600" fill="#0C6B49">
          Identity verified
        </text>
      </g>
    </svg>
  );
}

/** The hero's network of nodes and edges, drawn behind the words. */
export function HeroNetwork(): React.JSX.Element {
  return (
    <svg className="net" viewBox="0 0 560 800" fill="none">
      <g stroke="#4552D6" strokeWidth="1" opacity=".25">
        <path d="M60 120L200 60L380 150L500 90M60 120L120 300L300 260L380 150M120 300L220 460L420 420L300 260M420 420L520 540M220 460L140 640L340 700" />
      </g>
      <g fill="#159768">
        <circle className="p" cx="60" cy="120" r="4" />
        <circle className="p" cx="200" cy="60" r="5" />
        <circle className="p" cx="380" cy="150" r="4" />
        <circle className="p" cx="500" cy="90" r="4" />
        <circle className="p" cx="120" cy="300" r="4" />
        <circle className="p" cx="300" cy="260" r="5" />
        <circle className="p" cx="220" cy="460" r="4" />
        <circle className="p" cx="420" cy="420" r="5" />
        <circle className="p" cx="520" cy="540" r="4" />
        <circle className="p" cx="140" cy="640" r="4" />
        <circle className="p" cx="340" cy="700" r="5" />
      </g>
    </svg>
  );
}

/** Behind the hero's phone: the person holding it. */
export function HeroBackdrop(): React.JSX.Element {
  return (
    <svg className="bk" viewBox="0 0 560 900">
      <defs>
        <linearGradient id="sk" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#B27A57" />
          <stop offset="1" stopColor="#85543A" />
        </linearGradient>
      </defs>
      <path d="M170 770c60-20 230-20 300 0l30 140H150z" fill="#4552D6" />
      <path d="M120 650c20 110 70 130 120 140h230c-10-90-20-180-30-260z" fill="url(#sk)" />
      <g fill="#A06A4A">
        <rect x="420" y="340" width="112" height="64" rx="32" transform="rotate(-4 470 372)" />
        <rect x="422" y="414" width="118" height="66" rx="33" transform="rotate(-2 480 447)" />
        <rect x="420" y="490" width="112" height="64" rx="32" />
        <rect x="418" y="564" width="96" height="58" rx="29" transform="rotate(4 466 593)" />
      </g>
      <g stroke="#7B4B33" strokeWidth="2" opacity=".35" fill="none" strokeLinecap="round">
        <path d="M486 372h34M492 447h36M486 522h34M476 593h30" />
      </g>
    </svg>
  );
}

/** In front of the hero's phone: the arm that overlaps its lower edge. */
export function HeroForeground(): React.JSX.Element {
  return (
    <svg className="fr" viewBox="0 0 560 900">
      <path
        d="M70 790c-20-60 20-120 70-190"
        stroke="#9A6444"
        strokeWidth="64"
        strokeLinecap="round"
        fill="none"
      />
      <ellipse
        cx="152"
        cy="582"
        rx="19"
        ry="25"
        transform="rotate(35 152 582)"
        fill="#D9A785"
        opacity=".65"
      />
    </svg>
  );
}

/** The gradient backdrop of the Trade Code card. */
export function TradeCodeBackdrop(): React.JSX.Element {
  return (
    <svg className="tcs" viewBox="0 0 400 340" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <circle cx="270" cy="105" r="48" fill="#0D1420" opacity=".4" />
      <path d="M175 340c0-76 42-118 95-118s95 42 95 118z" fill="#0D1420" opacity=".4" />
      <g transform="rotate(-12 245 250)">
        <rect x="222" y="200" width="50" height="96" rx="11" fill="#0D1420" />
      </g>
    </svg>
  );
}
