// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Select } from '../../src/index.js';
import './setup.js';

const OPTIONS = [
  { value: 'park', label: 'Park Pickup — Interstate terminal hub' },
  { value: 'door', label: 'Doorstep Delivery' },
];

describe('Select', () => {
  it('is reachable by its label', () => {
    render(<Select label="Delivery method" options={OPTIONS} />);
    expect(screen.getByLabelText('Delivery method')).toBeDefined();
  });

  it('lists what it was given', () => {
    render(<Select label="Delivery method" options={OPTIONS} />);
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Park Pickup — Interstate terminal hub',
      'Doorstep Delivery',
    ]);
  });

  it('accepts options written as children too', () => {
    render(
      <Select label="Bank name">
        <option value="">Select bank</option>
      </Select>,
    );
    expect(screen.getByRole('option', { name: 'Select bank' })).toBeDefined();
  });

  it('reports a choice back', () => {
    const onChange = vi.fn();
    render(<Select label="Delivery method" options={OPTIONS} value="park" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Delivery method'), { target: { value: 'door' } });
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('says it is invalid', () => {
    render(<Select label="Bank name" options={OPTIONS} invalid helper="Pick a bank." />);
    expect(screen.getByLabelText('Bank name').getAttribute('aria-invalid')).toBe('true');
  });
});
