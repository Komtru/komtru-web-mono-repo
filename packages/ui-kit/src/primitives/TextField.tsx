'use client';

import { useId } from 'react';
import { CONTROL_CLASS, CONTROL_INVALID_CLASS, Field, type HelperTone } from './Field.js';
import { cx } from './cx.js';

export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  helper?: React.ReactNode;
  helperTone?: HelperTone;
  invalid?: boolean;
  /** `.input.mono-code` — the wide-tracked upper-case field a Trade Code is typed into. */
  mono?: boolean;
  id?: string;
}

export function TextField({
  label,
  helper,
  helperTone,
  invalid = false,
  mono = false,
  id,
  className,
  ...rest
}: TextFieldProps): React.JSX.Element {
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
      <input
        {...rest}
        id={fieldId}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={helper === undefined ? undefined : helperId}
        className={cx(
          CONTROL_CLASS,
          mono && 'text-center font-mono text-[18px] tracking-[.08em] uppercase',
          invalid && CONTROL_INVALID_CLASS,
          className,
        )}
      />
    </Field>
  );
}
