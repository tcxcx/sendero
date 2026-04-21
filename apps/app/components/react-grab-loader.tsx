'use client';

import { useEffect } from 'react';

export function ReactGrabLoader() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    if (process.env.NEXT_PUBLIC_SENDERO_ENABLE_REACT_GRAB !== '1') return;
    if (document.querySelector('script[data-sendero-react-grab]')) return;

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/react-grab/dist/index.global.js';
    script.crossOrigin = 'anonymous';
    script.dataset.senderoReactGrab = 'true';
    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, []);

  return null;
}
