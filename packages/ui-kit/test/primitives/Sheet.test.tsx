// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button, Sheet } from '../../src/index.js';
import './setup.js';

function Harness() {
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
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Cancel this Trade?"
        footer={<Button variant="danger">Yes, cancel this Trade</Button>}
      >
        <p>No money has moved, so there is nothing to refund.</p>
      </Sheet>
    </>
  );
}

describe('Sheet', () => {
  it('renders nothing while closed', () => {
    render(<Sheet open={false} title="Cancel this Trade?" />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is a modal dialog named by its question', () => {
    render(<Sheet open title="Release ₦452,000 to TechEdge NG?" />);
    const dialog = screen.getByRole('dialog', { name: 'Release ₦452,000 to TechEdge NG?' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('takes focus when it opens and gives it back to the opener when it closes', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Cancel this Trade' });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('closes on the dimmed screen behind it, not on its own content', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Sheet open onClose={onClose} title="Cancel this Trade?">
        <p>No money has moved.</p>
      </Sheet>,
    );
    fireEvent.click(screen.getByText('No money has moved.'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(container.firstElementChild!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps its actions under the question', () => {
    render(<Sheet open title="Cancel this Trade?" footer={<Button variant="danger">Yes, cancel</Button>} />);
    expect(screen.getByRole('button', { name: 'Yes, cancel' })).toBeDefined();
  });

  it('cycles Tab inside itself, which is what aria-modal promises', () => {
    render(
      <>
        <Button>Behind the scrim</Button>
        <Sheet
          open
          title="Cancel this Trade?"
          footer={
            <>
              <Button variant="danger">Yes, cancel</Button>
              <Button variant="secondary">Keep the Trade</Button>
            </>
          }
        />
      </>,
    );
    const dialog = screen.getByRole('dialog');
    const yes = screen.getByRole('button', { name: 'Yes, cancel' });
    const keep = screen.getByRole('button', { name: 'Keep the Trade' });

    keep.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(yes);

    yes.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(keep);
  });

  it('keeps focus on itself when it holds nothing focusable', () => {
    render(<Sheet open title="Cancel this Trade?" />);
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(dialog);
  });

  it('rises on the reference’s raised shadow', () => {
    render(<Sheet open title="Cancel this Trade?" />);
    expect(screen.getByRole('dialog').className).toContain('shadow-raised');
  });
});
