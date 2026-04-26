'use client';

/**
 * Console composer.
 *
 * One surface, two routings flipped via the destination dropdown
 * sitting where the old PRIVATE pill used to be:
 *
 *   - PRIVATE  (internal): operator ↔ Sendero AI. Ink-toned terminal,
 *     monospace prompt `$ sendero --internal`. Nothing here goes to a
 *     customer.
 *   - CHANNEL  (whatsapp/slack/email/web/sms): operator → traveler
 *     over the trip's primary channel. Tinted to the channel accent so
 *     an internal scratchpad never gets mistaken for an outbound reply.
 *
 * Sometimes Sendero asks the operator a question (internal turn);
 * sometimes it runs free against an identified workflow; sometimes it
 * needs additional info from the customer (channel turn). The
 * dropdown is the one knob that flips routing — autonomous behavior
 * keeps running on the agent side regardless of UI mode.
 */

import { useState } from 'react';

import { type ChannelKey, CHANNELS } from './channels';

export type ComposerMode = 'internal' | 'channel';

interface ComposerProps {
  /**
   * Active mode. `'internal'` renders the ink terminal, `'channel'`
   * renders the channel-tinted reply surface. The composer reads
   * `tripChannel` to know which channel "channel" maps to.
   */
  mode: ComposerMode;
  /**
   * The trip's primary channel. Used to label the channel option in
   * the dropdown and to tint the surface in channel mode. `'internal'`
   * means no trip is selected — only the PRIVATE option is offered.
   */
  tripChannel: ChannelKey;
  /** Mode change → upstream wires this to swap message routing. */
  onModeChange: (mode: ComposerMode) => void;
  /** Click-to-fill suggestion chips above the input. */
  suggestions?: string[];
  /** Caller decides what to do with the text (sendMessage vs reply). */
  onSubmit: (text: string) => void | Promise<void>;
  disabled?: boolean;
}

export function ConsoleComposer({
  mode,
  tripChannel,
  onModeChange,
  suggestions = [],
  onSubmit,
  disabled,
}: ComposerProps) {
  const [text, setText] = useState('');
  const isInternal = mode === 'internal';
  // The visual surface picks up the channel tint in channel mode and
  // falls back to the trip's channel descriptor for the dropdown
  // label. Unscoped state passes `tripChannel='internal'` so only the
  // PRIVATE option is available.
  const surfaceChannel = isInternal ? 'internal' : tripChannel;
  const c = CHANNELS[surfaceChannel];
  const trip = CHANNELS[tripChannel];
  const tripIsInternal = tripChannel === 'internal';

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    void onSubmit(trimmed);
    setText('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {suggestions.length > 0 ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {suggestions.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setText(t => (t ? `${t} ${s}` : s))}
              className="sd-pill"
              style={{
                background: 'var(--surface-floating)',
                boxShadow: 'inset 0 0 0 1px var(--ink-soft)',
                fontSize: 11,
                cursor: 'pointer',
                padding: '5px 10px',
                border: 0,
              }}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <div
        style={{
          boxShadow: isInternal
            ? 'inset 0 0 0 1px rgba(253,251,247,0.16)'
            : `inset 0 0 0 1px ${c.accent}`,
          padding: '12px 14px',
          background: isInternal ? 'var(--ink)' : c.tint,
          color: isInternal ? '#fdfbf7' : 'inherit',
          borderRadius: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isInternal ? (
            <span
              className="t-mono"
              style={{ fontSize: 11, color: 'rgba(253,251,247,0.85)', fontWeight: 600 }}
            >
              $ sendero --internal
            </span>
          ) : (
            <>
              <span style={{ flexShrink: 0 }}>{c.icon(14)}</span>
              <span className="t-meta" style={{ color: c.accent }}>
                Reply via {c.name}
              </span>
            </>
          )}
          <span style={{ flex: 1 }} />
          {/* Destination dropdown — supersedes the old static PRIVATE
              pill. PRIVATE is always available; the channel option
              only appears when a trip is selected. */}
          <DestinationSelect
            mode={mode}
            tripChannel={tripChannel}
            tripChannelName={tripIsInternal ? '' : trip.name}
            onChange={onModeChange}
            isInternalSurface={isInternal}
          />
          {!isInternal ? (
            <span className="t-mono ink-60" style={{ fontSize: 10 }}>
              {c.handle}
            </span>
          ) : null}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              isInternal
                ? 'ask sendero anything · /scope @trp- · /policy · /spend'
                : `Reply to traveler via ${c.name}…`
            }
            disabled={disabled}
            style={{
              flex: 1,
              background: 'transparent',
              border: 0,
              outline: 'none',
              color: isInternal ? '#fdfbf7' : 'var(--midnight)',
              fontSize: isInternal ? 13 : 14,
              fontFamily: isInternal ? 'var(--font-mono-x)' : 'var(--font-sans)',
            }}
          />
          <button
            type="button"
            onClick={submit}
            disabled={disabled || !text.trim()}
            style={{
              padding: '5px 14px',
              background: isInternal ? '#fdfbf7' : 'var(--vermillion)',
              color: isInternal ? 'var(--ink)' : '#fdfbf7',
              border: 0,
              borderRadius: 5,
              fontSize: 11,
              fontWeight: 600,
              cursor: disabled || !text.trim() ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-mono-x)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              opacity: disabled || !text.trim() ? 0.5 : 1,
            }}
          >
            {isInternal ? 'Run' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Destination dropdown that replaces the static PRIVATE pill.
 *
 *   - PRIVATE                   — operator ↔ Sendero AI
 *   - CHANNEL · {channel name}  — operator → traveler (when scoped)
 *
 * Native <select> for keyboard accessibility + zero dependencies. The
 * trigger looks like the original pill so the affordance feels the
 * same; the underlying control is just dressed up.
 */
function DestinationSelect({
  mode,
  tripChannel,
  tripChannelName,
  onChange,
  isInternalSurface,
}: {
  mode: ComposerMode;
  tripChannel: ChannelKey;
  tripChannelName: string;
  onChange: (mode: ComposerMode) => void;
  isInternalSurface: boolean;
}) {
  const tripIsInternal = tripChannel === 'internal';
  // Default = soft / faded ink (parchment text on tinted bg). Active
  // (hover, focus, pointer interaction with the underlying <select>)
  // pops to full ink with white text — see the :hover/:focus-within
  // styles below.
  return (
    <label
      className="sd-composer-dest"
      data-internal-surface={isInternalSurface ? '1' : '0'}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        cursor: tripIsInternal ? 'default' : 'pointer',
      }}
    >
      <span className="sd-composer-dest-pill t-mono">
        {mode === 'internal' ? 'PRIVATE' : `CHANNEL · ${tripChannelName.toUpperCase()}`}
        <span aria-hidden className="sd-composer-dest-caret">
          ▾
        </span>
      </span>
      <select
        value={mode}
        onChange={e => onChange(e.target.value as ComposerMode)}
        disabled={tripIsInternal}
        aria-label="Message destination"
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0,
          cursor: tripIsInternal ? 'default' : 'pointer',
          width: '100%',
          height: '100%',
          appearance: 'none',
        }}
      >
        <option value="internal">PRIVATE — Sendero AI</option>
        {!tripIsInternal ? <option value="channel">CHANNEL — {tripChannelName}</option> : null}
      </select>
      {/* Pill stays *dim* in default + active states; the only thing
          that changes on hover / focus-within / pointer-active is the
          ink saturation. Default = barely-there ghost ink. Active =
          dim ink fill (around 28% ink) with parchment text — visible
          but never loud. Used both on the ink-surface composer
          (PRIVATE) and the channel-tinted surface. */}
      <style jsx>{`
        .sd-composer-dest {
          --sd-pill-bg: transparent;
          --sd-pill-fg: rgba(253, 251, 247, 0.55);
          --sd-pill-bg-active: color-mix(in oklab, var(--ink) 28%, transparent);
          --sd-pill-fg-active: rgba(253, 251, 247, 0.95);
          --sd-pill-ring-active: color-mix(in oklab, #fdfbf7 28%, transparent);
        }
        .sd-composer-dest[data-internal-surface='0'] {
          --sd-pill-bg: transparent;
          --sd-pill-fg: color-mix(in oklab, var(--ink) 50%, transparent);
          --sd-pill-bg-active: color-mix(in oklab, var(--ink) 18%, transparent);
          --sd-pill-fg-active: var(--ink);
          --sd-pill-ring-active: color-mix(in oklab, var(--ink) 30%, transparent);
        }
        .sd-composer-dest-pill {
          font-size: 10px;
          padding: 2px 18px 2px 6px;
          background: var(--sd-pill-bg);
          color: var(--sd-pill-fg);
          border-radius: 3px;
          font-weight: 600;
          letter-spacing: 0.04em;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          box-shadow: inset 0 0 0 1px transparent;
          transition:
            background 120ms ease,
            color 120ms ease,
            box-shadow 120ms ease;
        }
        .sd-composer-dest-caret {
          position: absolute;
          right: 6px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 8px;
          opacity: 0.45;
          transition: opacity 120ms ease;
        }
        .sd-composer-dest:hover .sd-composer-dest-pill,
        .sd-composer-dest:focus-within .sd-composer-dest-pill,
        .sd-composer-dest:active .sd-composer-dest-pill {
          background: var(--sd-pill-bg-active);
          color: var(--sd-pill-fg-active);
          box-shadow: inset 0 0 0 1px var(--sd-pill-ring-active);
        }
        .sd-composer-dest:hover .sd-composer-dest-caret,
        .sd-composer-dest:focus-within .sd-composer-dest-caret {
          opacity: 1;
        }
      `}</style>
    </label>
  );
}
