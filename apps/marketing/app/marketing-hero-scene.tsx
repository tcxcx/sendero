'use client';

import UnicornScene from 'unicornstudio-react/next';

const SDK_URL =
  'https://cdn.jsdelivr.net/gh/hiunicornstudio/unicornstudio.js@v2.1.9/dist/unicornStudio.umd.js';

export function MarketingHeroScene() {
  return (
    <div className="mk-hero-scene-wrap">
      <UnicornScene
        projectId="nSeIGzF3okRILKrUl8hi"
        sdkUrl={SDK_URL}
        width="100%"
        height="100%"
        lazyLoad
      />
    </div>
  );
}
