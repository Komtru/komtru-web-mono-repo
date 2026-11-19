'use client';

import { useId } from 'react';
import { CONTROL_CLASS, CONTROL_INVALID_CLASS, Field, type HelperTone } from './Field.js';
import { cx } from './cx.js';

export interface TextAreaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  helper?: React.ReactNode;
  helperTone?: HelperTone;
  invalid?: boolean;
  id?: string;
}

/**
 * `.m-textarea` — the free-text box the reference draws wherever a person explains something in
 * their own words: reporting an issue, answering one, appealing a decision.
 *
 * Shares `Field` and `CONTROL_CLASS` with `TextField` rather than restating them, so the two
 * controls cannot drift apart on focus ring, border or invalid state. The only difference is the
 * element and that it grows vertically.
 */
export function TextArea({
  label,
  helper,
  helperTone,
  invalid = false,
  id,
  className,
  rows = 4,
  ...rest
}: TextAreaProps): React.JSX.Element {
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
      <textarea
        {...rest}
        id={fieldId}
        rows={rows}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={helper === undefined ? undefined : helperId}
        className={cx(CONTROL_CLASS, 'resize-y leading-[1.5]', invalid && CONTROL_INVALID_CLASS, className)}
      />
    </Field>
  );
}
