'use client';

/**
 * Pasillo × Arc — Root App
 *
 * Mounts: GlobeHero (optional) → Topbar + Subbar → 3-column workspace
 * (Chat · Stage · WorkflowLog) → FooterRail. Settings persist via store.
 */

import { useEffect, useState } from 'react';
import { GlobeHero } from './globe';
import { Topbar, Subbar, FooterRail } from './ui';
import { ChatCol } from './chat-col';
import { Stage } from './stage';
import { WorkflowLog } from './workflow-log';
import { AgentCard } from './agent-card';
import {
  hydrateFromStorage,
  subscribePersist,
  usePasillo,
  type Token,
  type Verbosity,
} from './store';
import { refreshTreasury } from './actions';

export function PasilloApp() {
  const showGlobe = usePasillo((s) => s.showGlobe);
  const setShowGlobe = usePasillo((s) => s.setShowGlobe);

  // Hydrate settings + start a treasury poll on mount.
  useEffect(() => {
    hydrateFromStorage();
    const unsub = subscribePersist();
    refreshTreasury();
    const iv = setInterval(refreshTreasury, 20_000);
    return () => {
      unsub();
      clearInterval(iv);
    };
  }, []);

  return (
    <>
      {showGlobe && (
        <GlobeHero
          onEnter={() => setShowGlobe(false)}
          onHide={() => setShowGlobe(false)}
        />
      )}

      <div className="app" data-screen-label="Agent Console">
        <Topbar />
        <Subbar />

        <div
          style={{
            padding: '8px 16px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-elev)',
          }}
        >
          <AgentCard />
        </div>

        <div className="workspace">
          <ChatCol />
          <Stage />
          <WorkflowLog />
        </div>

        <FooterRail />
      </div>

      <TweaksToggle />
    </>
  );
}

function TweaksToggle() {
  const token = usePasillo((s) => s.token);
  const verbosity = usePasillo((s) => s.verbosity);
  const showGlobe = usePasillo((s) => s.showGlobe);
  const dark = usePasillo((s) => s.dark);
  const setToken = usePasillo((s) => s.setToken);
  const setVerbosity = usePasillo((s) => s.setVerbosity);
  const setShowGlobe = usePasillo((s) => s.setShowGlobe);
  const setDark = usePasillo((s) => s.setDark);

  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        aria-label="Tweaks"
        style={{
          position: 'fixed',
          right: 16,
          bottom: 44,
          zIndex: 99,
          padding: '8px 12px',
          border: '1.5px solid var(--ink)',
          background: 'var(--bg-elev)',
          color: 'var(--ink)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
        }}
      >
        ◇ Tweaks
      </button>

      {open && (
        <div className="tweaks-panel">
          <div className="tweaks-head">
            <span>TWEAKS</span>
            <button onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="tweaks-body">
            <TweakGroup label="Settlement token">
              {(['USDC', 'EURC', 'AUTO'] as Token[]).map((t) => (
                <button
                  key={t}
                  className={`tweak-opt ${token === t ? 'sel' : ''}`}
                  onClick={() => setToken(t)}
                >
                  {t === 'AUTO' ? 'Auto-FX' : t}
                </button>
              ))}
            </TweakGroup>

            <TweakGroup label="Agent verbosity">
              {(
                [
                  ['terse', 'Terse'],
                  ['normal', 'Normal'],
                  ['verbose', 'Verbose'],
                ] as [Verbosity, string][]
              ).map(([k, l]) => (
                <button
                  key={k}
                  className={`tweak-opt ${verbosity === k ? 'sel' : ''}`}
                  onClick={() => setVerbosity(k)}
                >
                  {l}
                </button>
              ))}
            </TweakGroup>

            <div className="tweak-group">
              <span className="tk-label">Globe hero</span>
              <div className="tweak-toggle">
                <div
                  className={`tw-switch ${showGlobe ? 'on' : ''}`}
                  onClick={() => setShowGlobe(!showGlobe)}
                >
                  <div className="knob" />
                </div>
                <span>{showGlobe ? 'Visible on load' : 'Hidden'}</span>
              </div>
            </div>

            <div className="tweak-group">
              <span className="tk-label">Theme</span>
              <div className="tweak-toggle">
                <div
                  className={`tw-switch ${dark ? 'on' : ''}`}
                  onClick={() => setDark(!dark)}
                >
                  <div className="knob" />
                </div>
                <span>{dark ? 'Dark' : 'Light'}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TweakGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="tweak-group">
      <span className="tk-label">{label}</span>
      <div className="tweak-opts">{children}</div>
    </div>
  );
}

