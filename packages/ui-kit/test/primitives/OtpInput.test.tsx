// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OtpInput } from '../../src/index.js';
import './setup.js';

/** The reference's OTP is controlled by the screen; this is that screen, reduced to its state. */
function Harness({ onComplete, invalid }: { onComplete?: (value: string) => void; invalid?: boolean }) {
  const [value, setValue] = useState('');
  return (
    <OtpInput
      label="One-time code"
      value={value}
      onChange={setValue}
      onComplete={onComplete}
      invalid={invalid}
    />
  );
}

const cells = () => screen.getAllByRole('textbox');

describe('OtpInput', () => {
  it('draws one cell per digit, each named by its position', () => {
    render(<Harness />);
    expect(cells()).toHaveLength(6);
    expect(screen.getByLabelText('Digit 1 of 6')).toBeDefined();
    expect(screen.getByLabelText('Digit 6 of 6')).toBeDefined();
  });

  it('advances as digits are typed', () => {
    render(<Harness />);
    fireEvent.change(cells()[0]!, { target: { value: '4' } });
    expect(document.activeElement).toBe(cells()[1]);
    expect(cells()[0]).toHaveProperty('value', '4');
  });

  it('ignores anything that is not a digit', () => {
    render(<Harness />);
    fireEvent.change(cells()[0]!, { target: { value: 'k' } });
    expect(cells()[0]).toHaveProperty('value', '');
    expect(document.activeElement).not.toBe(cells()[1]);
  });

  it('backspaces out of an empty cell into the one before, clearing it', () => {
    render(<Harness />);
    fireEvent.change(cells()[0]!, { target: { value: '4' } });
    fireEvent.change(cells()[1]!, { target: { value: '8' } });
    fireEvent.keyDown(cells()[2]!, { key: 'Backspace' });
    expect(cells()[1]).toHaveProperty('value', '');
    expect(document.activeElement).toBe(cells()[1]);
  });

  it('backspaces within a filled cell without moving', () => {
    render(<Harness />);
    fireEvent.change(cells()[0]!, { target: { value: '4' } });
    fireEvent.keyDown(cells()[0]!, { key: 'Backspace' });
    expect(cells()[0]).toHaveProperty('value', '');
  });

  it('walks left and right with the arrow keys', () => {
    render(<Harness />);
    fireEvent.keyDown(cells()[2]!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(cells()[1]);
    fireEvent.keyDown(cells()[1]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cells()[2]);
  });

  it('does not walk off either end', () => {
    render(<Harness />);
    fireEvent.keyDown(cells()[0]!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(cells()[0]);
    fireEvent.keyDown(cells()[5]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cells()[5]);
  });

  it('takes a pasted code in one go and reports it complete', () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    fireEvent.paste(cells()[0]!, { clipboardData: { getData: () => '482 315' } });
    expect(cells().map((cell) => (cell as HTMLInputElement).value)).toEqual(['4', '8', '2', '3', '1', '5']);
    expect(onComplete).toHaveBeenCalledWith('482315');
  });

  it('marks the whole code wrong, not one digit — the person is told the code is wrong', () => {
    render(<Harness invalid />);
    expect(screen.getByRole('group').getAttribute('aria-invalid')).toBe('true');
    for (const cell of cells()) {
      expect(cell.className).toContain('border-risk');
      expect(cell.className).toContain('bg-risk-soft');
    }
  });

  it('outlines a filled cell indigo and leaves an empty one hairline', () => {
    render(<Harness />);
    fireEvent.change(cells()[0]!, { target: { value: '4' } });
    expect(cells()[0]?.className).toContain('border-trust-indigo');
    expect(cells()[1]?.className).toContain('border-border-hairline');
  });

  it('rings the cell the caret is in', () => {
    render(<Harness />);
    const first = cells()[0]!;
    first.focus();
    expect(document.activeElement).toBe(first);
    expect(first.className).toContain('focus-visible:shadow-[0_0_0_3px_var(--trust-indigo-soft)]');
  });
});
