import { parseRoomId, roomIdForTrip, roomIdForWorkspace } from './rooms';
import { describe, expect, test } from 'bun:test';

describe('Liveblocks room ids', () => {
  test('builds and parses tenant workspace rooms', () => {
    const room = roomIdForWorkspace('ten_123');
    expect(room).toBe('sendero:ten_123:workspace');
    expect(parseRoomId(room)).toEqual({ kind: 'workspace', tenantId: 'ten_123' });
  });

  test('builds and parses tenant trip rooms', () => {
    const room = roomIdForTrip('ten_123', 'trip_456');
    expect(room).toBe('sendero:ten_123:trip:trip_456');
    expect(parseRoomId(room)).toEqual({
      kind: 'trip',
      tenantId: 'ten_123',
      tripId: 'trip_456',
    });
  });

  test('rejects rooms that do not carry a Sendero tenant namespace', () => {
    expect(parseRoomId('tenant:ten_123')).toBeNull();
    expect(parseRoomId('sendero:ten_123')).toBeNull();
    expect(parseRoomId('sendero:ten_123:room:trip_456')).toBeNull();
  });
});
