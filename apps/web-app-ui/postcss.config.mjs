// Tailwind v4 through PostCSS, which is how a Next app consumes it (`ui-kit`'s Storybook uses the
// Vite plugin instead). The preset and the `@source` lines live in `app/globals.css`.
const config = { plugins: { '@tailwindcss/postcss': {} } };

export default config;
