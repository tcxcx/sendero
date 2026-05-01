import {
  parseRoomId,
  roomIdForReservation,
  roomIdForRun,
  roomIdForSupportCase,
  roomIdForTrip,
  roomIdForWorkspace,
} from './rooms';
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

  test('builds and parses agent run, reservation, and support rooms', () => {
    expect(parseRoomId(roomIdForRun('ten_123', 'run_456'))).toEqual({
      kind: 'run',
      tenantId: 'ten_123',
      runId: 'run_456',
    });
    expect(parseRoomId(roomIdForReservation('ten_123', 'res_456'))).toEqual({
      kind: 'reservation',
      tenantId: 'ten_123',
      reservationId: 'res_456',
    });
    expect(parseRoomId(roomIdForSupportCase('ten_123', 'case_456'))).toEqual({
      kind: 'support',
      tenantId: 'ten_123',
      caseId: 'case_456',
    });
  });

  test('rejects rooms that do not carry a Sendero tenant namespace', () => {
    expect(parseRoomId('tenant:ten_123')).toBeNull();
    expect(parseRoomId('sendero:ten_123')).toBeNull();
    expect(parseRoomId('sendero:ten_123:room:trip_456')).toBeNull();
    expect(parseRoomId('sendero:ten_123:trip:trip:456')).toBeNull();
  });
});
