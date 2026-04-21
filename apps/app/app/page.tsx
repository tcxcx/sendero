import { Show } from '@clerk/nextjs';
import Link from 'next/link';
import { SenderoApp } from '@/components/sendero-app';

export default function Page() {
  return (
    <>
      <header
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          padding: '16px 24px',
          gap: 12,
          position: 'absolute',
          top: 0,
          right: 0,
          zIndex: 10,
        }}
      >
        <Show when="signed-in">
          <Link
            href="/app"
            style={{
              background: '#fb542b',
              color: '#fff',
              padding: '10px 20px',
              borderRadius: 12,
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            Go to app →
          </Link>
        </Show>
        <Show when="signed-out">
          <Link
            href="/sign-in"
            style={{ color: '#0b0b0b', padding: '10px 16px', textDecoration: 'none', fontSize: 14 }}
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            style={{
              background: '#fb542b',
              color: '#fff',
              padding: '10px 20px',
              borderRadius: 12,
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            Get started
          </Link>
        </Show>
      </header>
      <SenderoApp />
    </>
  );
}
