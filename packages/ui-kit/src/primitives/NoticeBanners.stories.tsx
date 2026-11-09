import type { Meta, StoryObj } from '@storybook/react-vite';
import { NoteBanner, ReadyBanner, RiskBanner, WarnBanner } from './NoticeBanners.js';

const meta = {
  title: 'Primitives/NoticeBanners',
  component: NoteBanner,
  args: { children: 'Only the terms you change are different.' },
} satisfies Meta<typeof NoteBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Note: Story = {};

/** The alert mark, as `.guard-lock-banner` draws it. */
export const Warn: Story = {
  render: () => <WarnBanner title="Accept is locked">Attach a photo first.</WarnBanner>,
};

export const Risk: Story = { render: () => <RiskBanner>We couldn't save that address.</RiskBanner> };

export const Ready: Story = {
  render: () => <ReadyBanner title="Agreement recorded">Version 3 accepted.</ReadyBanner>,
};
