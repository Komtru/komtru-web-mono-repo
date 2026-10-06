import { useState } from 'react';

export function Maybe({ enabled }: { enabled: boolean }): React.JSX.Element {
  if (enabled) {
    const [count] = useState(0);
    return <span>{count}</span>;
  }
  return <span>off</span>;
}
