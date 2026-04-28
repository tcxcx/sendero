'use client';

import UnicornScene from 'unicornstudio-react/next';

const SDK_URL =
  'https://cdn.jsdelivr.net/gh/hiunicornstudio/unicornstudio.js@v2.1.9/dist/unicornStudio.umd.js';

export function MarketingEngineScene() {
  return (
    <div className="mk-engine-scene">
      <UnicornScene
        projectId="DjgcW6hHS1JwLuHzpZ0c"
        sdkUrl={SDK_URL}
        width="100%"
        height="100%"
        lazyLoad
      />
    </div>
  );
}
