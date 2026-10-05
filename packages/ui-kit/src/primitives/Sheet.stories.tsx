import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button.js';
import { Sheet } from './Sheet.js';

const meta = {
  title: 'Primitives/Sheet',
  component: Sheet,
  args: { open: true, title: 'Cancel this Trade?' },
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

/** CT1. No money has moved, so the sheet says so before it asks. */
export const CancelATrade: Story = {
  args: {
    children: (
      <p className="mb-[14px] text-center text-[12px] leading-[1.6] text-slate">
        No money has moved, so there&apos;s nothing to refund — this simply ends the Trade for both sides.
      </p>
    ),
    footer: (
      <>
        <Button variant="danger" className="mb-[8px]">
          Yes, cancel this Trade
        </Button>
        <Button variant="secondary">Keep the Trade</Button>
      </>
    ),
  },
};

/** C4. The irreversible one, with the acknowledgement the reference puts above the button. */
export const ConfirmRelease: Story = {
  args: {
    title: 'Release ₦452,000 to TechEdge NG?',
    children: (
      <p className="mb-[14px] text-center text-[12px] leading-[1.6] text-slate">
        This can&apos;t be undone once confirmed — funds move immediately.
      </p>
    ),
    footer: (
      <>
        <Button className="mb-[8px]">Confirm &amp; Release</Button>
        <Button variant="secondary">Cancel</Button>
      </>
    ),
  },
};

/** Opening moves focus into the sheet; Escape or the dimmed screen closes it and gives focus back. */
export const Interactive: Story = {
  render: function Interactive(args) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button
          onClick={() => {
            setOpen(true);
          }}
        >
          Cancel this Trade
        </Button>
        <Sheet
          {...args}
          open={open}
          onClose={() => {
            setOpen(false);
          }}
          footer={
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              Keep the Trade
            </Button>
          }
        />
      </>
    );
  },
};
