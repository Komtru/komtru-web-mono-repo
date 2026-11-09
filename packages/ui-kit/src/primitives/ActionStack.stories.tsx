import type { Meta, StoryObj } from '@storybook/react-vite';
import { ActionStack } from './ActionStack.js';
import { Button } from './Button.js';

const meta = {
  title: 'Primitives/ActionStack',
  component: ActionStack,
  args: { children: null },
} satisfies Meta<typeof ActionStack>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Actions in the page flow. `StickyFooter` pins to the viewport bottom, which on a screen inside the
 * app shell is where the tab bar is; this is for those screens.
 */
export const Default: Story = {
  render: () => (
    <ActionStack>
      <Button>Accept trade request</Button>
      <Button variant="secondary">Propose a change</Button>
      <Button variant="ghost">Decline</Button>
    </ActionStack>
  ),
};
