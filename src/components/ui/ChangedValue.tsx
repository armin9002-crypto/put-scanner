import { useState, type HTMLAttributes } from 'react';

/** Acknowledge changed display strings, never initial mount or unchanged renders.
 * Bounded summary use only: CSS owns the one-shot fade, with no timers.
 */
export function ChangedValue({ value, className = '', ...props }: HTMLAttributes<HTMLDivElement> & { value: string }) {
  const [display, setDisplay] = useState({ value, revision: 0 });
  if (display.value !== value) {
    setDisplay({ value, revision: display.revision + 1 });
  }
  return <div {...props} key={display.revision} className={`${className}${display.revision ? ' motion-value' : ''}`}>{value}</div>;
}
