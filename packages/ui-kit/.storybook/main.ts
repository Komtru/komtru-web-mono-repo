import tailwind from '@tailwindcss/vite';
import type { StorybookConfig } from '@storybook/react-vite';

/**
 * `@komtru/ui-kit/fonts` is deliberately absent here: it reaches for `next/font/google`, which only a
 * Next build can resolve. `preview.css` names the families and loads the webfaces by `<link>`.
 */
const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  // A component library's build should not phone home from CI or a worktree.
  core: { disableTelemetry: true },
  stories: ['../src/**/*.stories.tsx'],
  addons: ['@storybook/addon-docs'],
  viteFinal: (viteConfig) => ({
    ...viteConfig,
    plugins: [...(viteConfig.plugins ?? []), tailwind()],
  }),
};

export default config;
