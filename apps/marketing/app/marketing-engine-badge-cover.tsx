'use client';

import { useEffect, useRef, useState } from 'react';

export function MarketingEngineBadgeCover() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const banner = ref.current?.closest('.mk-scene-banner');
    if (!banner) return;

    const observer = new MutationObserver(() => {
      if (banner.querySelector('canvas, [id^="unicorn-"]')) {
        setVisible(true);
        observer.disconnect();
      }
    });

    observer.observe(banner, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      {visible && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 420,
            height: 80,
            background: '#000',
            zIndex: 2147483647,
          }}
        />
      )}
    </div>
  );
}
