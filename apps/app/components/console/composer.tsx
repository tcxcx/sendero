'use client';

/**
 * Console composer.
 *
 * Two visual modes:
 *   - Internal (operator → Sendero AI). Dark midnight terminal,
 *     monospace prompt `$ sendero --internal`, "PRIVATE" pill.
 *     Emphasizes "nothing here goes to a customer".
 *   - Channel (operator → customer via WhatsApp / Slack / SMS / web).
 *     Tinted to the channel's accent so an operator can never confuse
 *     an internal scratchpad for a real outbound message.
 *
 * Wires `onSubmit` so the parent can hand text into either the agent
 * dispatch path (internal) or the channel reply API (per-trip).
 */

import { useState } from 'react';

import { type ChannelKey, CHANNELS } from './channels';

interface ComposerProps {
  channel: ChannelKey;
  /** When provided, also shows above the input as click-to-fill chips. */
  suggestions?: string[];
  /** Caller decides what to do with the text. */
  onSubmit: (text: string) => void | Promise<void>;
  disabled?: boolean;
}

export function ConsoleComposer({ channel, suggestions = [], onSubmit, disabled }: ComposerProps) {
  const [text, setText] = useState('');
  const isInternal = channel === 'internal';
  const c = CHANNELS[channel];

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
                boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
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
          boxShadow: isInternal ? 'inset 0 0 0 1px var(--midnight)' : `inset 0 0 0 1px ${c.accent}`,
          padding: '12px 14px',
          background: isInternal ? 'var(--midnight)' : c.tint,
          color: isInternal ? '#fdfbf7' : 'inherit',
          borderRadius: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isInternal ? (
            <>
              <span className="t-mono" style={{ fontSize: 11, color: '#e8b98e', fontWeight: 600 }}>
                $ sendero --internal
              </span>
              <span style={{ flex: 1 }} />
              <span
                className="t-mono"
                style={{
                  fontSize: 10,
                  padding: '2px 6px',
                  background: 'rgba(232,185,142,0.12)',
                  color: '#e8b98e',
                  borderRadius: 3,
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                }}
              >
                PRIVATE
              </span>
            </>
          ) : (
            <>
              <span style={{ flexShrink: 0 }}>{c.icon(14)}</span>
              <span className="t-meta" style={{ color: c.accent }}>
                Reply via {c.name}
              </span>
              <span style={{ flex: 1 }} />
              <span className="t-mono ink-60" style={{ fontSize: 10 }}>
                {c.handle}
              </span>
            </>
          )}
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
              background: isInternal ? '#e8b98e' : 'var(--vermillion)',
              color: isInternal ? 'var(--midnight)' : '#fdfbf7',
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
