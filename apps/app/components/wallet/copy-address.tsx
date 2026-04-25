'use client';

import { useState } from 'react';

interface Props {
  value: string;
  label?: string;
}

export function CopyAddress({ value, label = 'copy' }: Props) {
  const [copied, setCopied] = useState(false);
  const onClick = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'transparent',
        border: 0,
        padding: 0,
        cursor: 'pointer',
        fontFamily: 'var(--font-mono-x)',
        fontSize: 10,
        textDecoration: 'underline',
        color: 'rgba(31,42,68,0.6)',
      }}
    >
      {copied ? 'copied' : label}
    </button>
  );
}
