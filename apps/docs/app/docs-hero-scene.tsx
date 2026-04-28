'use client';

import UnicornScene from 'unicornstudio-react/next';

const SDK_URL =
  'https://cdn.jsdelivr.net/gh/hiunicornstudio/unicornstudio.js@v2.1.9/dist/unicornStudio.umd.js';

export function DocsHeroScene() {
  return (
    <UnicornScene
      projectId="KPclYpfajUEvTD80Y5iW"
      sdkUrl={SDK_URL}
      width="100%"
      height="400px"
      lazyLoad
    />
  );
}
