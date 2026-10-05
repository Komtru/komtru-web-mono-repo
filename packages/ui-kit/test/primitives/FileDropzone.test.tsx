// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button, FileDropzone, MediaGate, isMediaGateSatisfied } from '../../src/index.js';
import './setup.js';

describe('isMediaGateSatisfied', () => {
  it('is open only once the required proof is actually attached', () => {
    expect(isMediaGateSatisfied([], 1)).toBe(false);
    expect(isMediaGateSatisfied([{ id: 'a' }], 1)).toBe(true);
    expect(isMediaGateSatisfied([{ id: 'a' }], 2)).toBe(false);
    expect(isMediaGateSatisfied([{ id: 'a' }, { id: 'b' }], 2)).toBe(true);
  });

  it('is open by default, because most uploads are optional evidence', () => {
    expect(isMediaGateSatisfied([], 0)).toBe(true);
  });
});

describe('MediaGate', () => {
  it('computes the gate itself, so a screen cannot hand itself an open one', () => {
    render(
      <MediaGate media={[]} requiredCount={1}>
        {(satisfied) => <Button disabled={!satisfied}>Accept trade request</Button>}
      </MediaGate>,
    );
    expect(screen.getByRole('button', { name: 'Accept trade request' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });

  it('opens once the proof is there', () => {
    render(
      <MediaGate media={[{ id: 'a' }]} requiredCount={1}>
        {(satisfied) => <Button disabled={!satisfied}>Accept trade request</Button>}
      </MediaGate>,
    );
    expect(
      screen.getByRole('button', { name: 'Accept trade request' }).getAttribute('aria-disabled'),
    ).toBeNull();
  });
});

describe('FileDropzone', () => {
  it('names what is still missing while the gate is shut', () => {
    render(<FileDropzone label="Add proof of possession" media={[]} requiredCount={1} />);
    expect(screen.getByText('Accept is locked')).toBeDefined();
    expect(screen.getByRole('status').textContent).toContain('Attach 1 more photo or video');
  });

  it('drops the lock once the proof is attached', () => {
    render(<FileDropzone label="Add proof of possession" media={[{ id: 'a' }]} requiredCount={1} />);
    expect(screen.queryByText('Accept is locked')).toBeNull();
  });

  it('never locks an optional upload', () => {
    render(<FileDropzone label="Add evidence photos" media={[]} />);
    expect(screen.queryByText('Accept is locked')).toBeNull();
  });

  it('draws a slot per place the proof could go, dashed while empty', () => {
    const { container } = render(<FileDropzone label="Proof of possession" media={[{ id: 'a' }]} />);
    const slots = container.querySelectorAll('li');
    expect(slots).toHaveLength(3);
    expect(slots[0]?.className).toContain('bg-[linear-gradient(135deg,var(--stone-gray),var(--cloud-gray))]');
    expect(slots[1]?.className).toContain('border-dashed');
  });

  it('grows past its slots rather than hiding what was attached', () => {
    const { container } = render(
      <FileDropzone label="Proof" media={[{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]} />,
    );
    expect(container.querySelectorAll('li')).toHaveLength(4);
  });

  it('takes a file through the control and hands it back', () => {
    const onAdd = vi.fn();
    const { container } = render(<FileDropzone label="Add evidence photos" media={[]} onAdd={onAdd} />);
    const input = container.querySelector('input[type="file"]');
    const file = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });
    fireEvent.change(input!, { target: { files: [file] } });
    expect(onAdd).toHaveBeenCalledWith([file]);
  });

  it('shows the keyboard ring on the box when the hidden control takes focus', () => {
    const { container } = render(<FileDropzone label="Add evidence photos" media={[]} />);
    const box = container.querySelector('label');
    expect(box?.className).toContain('focus-within:outline-[2.5px]');
    expect(box?.className).toContain('focus-within:outline-trust-indigo');
  });

  it('says what each attachment is, so the grid is not three anonymous squares', () => {
    render(<FileDropzone label="Proof" media={[{ id: 'a', alt: 'MacBook Air, lid open' }]} />);
    expect(screen.getByText('MacBook Air, lid open')).toBeDefined();
  });
});
