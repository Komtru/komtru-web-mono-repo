'use client';

import { useId } from 'react';
import { CONTROL_CLASS, CONTROL_INVALID_CLASS, Field, type HelperTone } from './Field.js';
import { cx } from './cx.js';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  helper?: React.ReactNode;
  helperTone?: HelperTone;
  invalid?: boolean;
  options?: readonly SelectOption[];
  id?: string;
}

/** The reference gives `<select>` the same chrome as `.input`; only the control element differs. */
export function Select({
  label,
  helper,
  helperTone,
  invalid = false,
  options,
  id,
  className,
  children,
  ...rest
}: SelectProps): React.JSX.Element {
  const generated = useId();
  const fieldId = id ?? generated;
  const helperId = `${fieldId}-helper`;
  return (
    <Field
      id={fieldId}
      label={label}
      helper={helper}
      helperTone={invalid ? 'error' : helperTone}
      helperId={helperId}
    >
      <select
        {...rest}
        id={fieldId}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={helper === undefined ? undefined : helperId}
        className={cx(CONTROL_CLASS, invalid && CONTROL_INVALID_CLASS, className)}
      >
        {options?.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        {children}
      </select>
    </Field>
  );
}
