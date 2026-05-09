'use client';

import { useState } from 'react';

import { requestBookingPayment } from '@/components/actions';

interface Props {
  orderId: string;
  bookingReference: string;
  amount: string;
  currency?: string;
}

export function RequestBookingPaymentButton({
  orderId,
  bookingReference,
  amount,
  currency = 'USD',
}: Props) {
  const [requesting, setRequesting] = useState<'whatsapp' | 'slack' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function send(channel: 'whatsapp' | 'slack') {
    setRequesting(channel);
    setMessage(null);
    try {
      const result = await requestBookingPayment(
        {
          orderId,
          bookingReference,
          totalAmount: amount,
          totalCurrency: currency,
        },
        channel
      );
      if (result?.status === 'sent') {
        setMessage(`Sent via ${result.channel}`);
      } else if (result?.reason) {
        setMessage(`Not sent: ${result.reason}`);
      }
    } finally {
      setRequesting(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          className="btn"
          disabled={!!requesting}
          onClick={() => send('whatsapp')}
          style={{ padding: '7px 12px', fontSize: 12 }}
        >
          {requesting === 'whatsapp' ? 'Sending...' : 'Request payment - WhatsApp'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!!requesting}
          onClick={() => send('slack')}
          style={{ padding: '7px 12px', fontSize: 12 }}
        >
          {requesting === 'slack' ? 'Sending...' : 'Request payment - Slack'}
        </button>
      </div>
      {message ? (
        <div className="t-mono ink-60" style={{ fontSize: 11 }}>
          {message}
        </div>
      ) : null}
    </div>
  );
}
