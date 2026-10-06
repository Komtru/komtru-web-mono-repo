// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TextField } from '../../src/index.js';
import './setup.js';

describe('TextField', () => {
  it('ties the label to the control, so clicking the label lands in the field', () => {
    render(<TextField label="Phone number" />);
    const input = screen.getByLabelText('Phone number');
    fireEvent.click(screen.getByText('Phone number'));
    expect(input).toBeDefined();
    input.focus();
    expect(document.activeElement).toBe(input);
  });

  it('announces its helper through the control rather than leaving it floating', () => {
    render(<TextField label="Phone number" helper="We'll match it to the seller's profile." />);
    const input = screen.getByLabelText('Phone number');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe(
      "We'll match it to the seller's profile.",
    );
  });

  it('says it is invalid and turns the helper into the error voice', () => {
    render(<TextField label="Account number" helper="That doesn't look like 10 digits." invalid />);
    const input = screen.getByLabelText('Account number');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.className).toContain('border-risk');
    expect(screen.getByText("That doesn't look like 10 digits.").className).toContain('text-risk-on-soft');
  });

  it('is not marked invalid when it is fine', () => {
    render(<TextField label="Phone number" />);
    expect(screen.getByLabelText('Phone number').getAttribute('aria-invalid')).toBeNull();
  });

  it('types through to the caller', () => {
    const onChange = vi.fn();
    render(<TextField label="Trade Code" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Trade Code'), { target: { value: 'KMT-88190' } });
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('wears the mono-code treatment a Trade Code is typed in', () => {
    render(<TextField label="Trade Code" mono />);
    expect(screen.getByLabelText('Trade Code').className).toContain('font-mono');
  });
});
