'use client';

/**
 * Pasillo live booking state — Zustand store.
 *
 * Single source of truth for: current search, offers, selected offer,
 * hold order, payment, treasury status, workflow log. Replaces the
 * scenario data model.
 */

import { create } from 'zustand';

export interface FlightOffer {
  id: string;
  airline: string;
  airlineIataCode?: string;
  airlineLogoUrl?: string | null;
  airlineLockupUrl?: string | null;
  price: string;
  currency: string;
  departure: string;
  arrival: string;
  originCode?: string;
  originCity?: string | null;
  destinationCode?: string;
  destinationCity?: string | null;
  duration: string;
  stops: number;
  cabinClass: string;
  expiresAt: string;
}

export interface HotelOffer {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  stars: number | null;
  reviewScore: number | null;
  photos: string[];
  price: string;
  currency: string;
  cancellation: 'free' | 'partial' | 'non_refundable' | 'unknown';
  distanceMeters: number | null;
  amenities: string[];
}

export interface HotelSearch {
  location: string;
  checkInDate: string;
  checkOutDate: string;
  guests: number;
  rooms: number;
}

export interface SearchParams {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  passengers: number;
  cabinClass: 'economy' | 'premium_economy' | 'business' | 'first';
}

export interface HoldOrder {
  orderId: string;
  bookingReference: string;
  totalAmount: string;
  totalCurrency: string;
  paymentRequiredBy: string;
  demo?: boolean;
}

export interface Payment {
  paymentId: string;
  status: string;
  amount: string;
  currency: string;
  demo?: boolean;
}

export interface OnChainSettlement {
  jobId: string;
  pnr: string;
  deliverableHash: string;
  /** 7 tx hashes in order: createJob, setBudget, approve, fund, submit, complete, feedback */
  txHashes: string[];
  explorerBase: string;
  completedAt: number;
  demo: boolean;
}

export interface TokenBalance {
  symbol: string;
  amount: string;
  decimals?: number;
  chain: string;
}

export interface ArcStatus {
  blockNumber: string;
  gasPrice: string;
  chainId: number;
  explorerUrl: string;
}

export interface TreasuryState {
  treasuryAddress: string;
  balances: TokenBalance[];
  arc: ArcStatus;
  demo: boolean;
}

export type SettlementPhase =
  | 'idle'
  | 'signing' // user's passkey is being prompted / userOp streaming to bundler
  | 'done'
  | 'error';

export interface SettlementProgress {
  phase: SettlementPhase;
  jobId: string | null;
  /** txs collected as each phase completes, in protocol order. */
  txHashes: string[];
  /** last error message surfaced by any phase. */
  error: string | null;
  /** last passkey user-op hash, useful for debugging. */
  lastUserOpHash: string | null;
}

export type WorkflowEventBullet = 'done' | 'active' | 'pending' | 'fail';

export interface WorkflowEvent {
  id: string;
  group: string;
  bullet: WorkflowEventBullet;
  text: string;
  t: string;
}

export type BookingStatus =
  | 'idle'
  | 'searching'
  | 'selected'
  | 'holding'
  | 'held'
  | 'paying'
  | 'confirmed'
  | 'error';

interface Traveler {
  name: string;
  initials: string;
  email: string;
  role: string;
}

export interface UserAuth {
  /** Passkey-derived MSCA address on Arc Testnet. */
  address: `0x${string}`;
  displayName: string;
  email: string;
  /** E.164 phone — required by Duffel for hold orders. */
  phone: string;
}

interface PasilloState {
  // Settings
  showWorkflow: boolean;
  dark: boolean;

  // Auth
  userAuth: UserAuth | null;
  setUserAuth: (a: UserAuth | null) => void;

  // Traveler derived from userAuth
  traveler: Traveler;

  // Booking
  search: SearchParams | null;
  offers: FlightOffer[];
  selectedOfferId: string | null;
  holdOrder: HoldOrder | null;
  payment: Payment | null;
  onChainSettlement: OnChainSettlement | null;

  // Hotels
  hotelSearch: HotelSearch | null;
  hotels: HotelOffer[];

  status: BookingStatus;
  error: string | null;

  // Settlement (user-signed MSCA flow)
  settlement: SettlementProgress;
  setSettlementPhase: (phase: SettlementPhase) => void;
  setSettlementJobId: (jobId: string | null) => void;
  pushSettlementTx: (hash: string) => void;
  setSettlementError: (msg: string | null) => void;
  setLastUserOpHash: (hash: string | null) => void;
  resetSettlement: () => void;

  // Treasury
  treasury: TreasuryState | null;

  // Workflow log
  workflow: WorkflowEvent[];

  // Actions
  setShowWorkflow: (v: boolean) => void;
  setDark: (v: boolean) => void;

  setSearch: (s: SearchParams) => void;
  setOffers: (offers: FlightOffer[]) => void;
  selectOffer: (id: string) => void;
  setHoldOrder: (h: HoldOrder) => void;
  setPayment: (p: Payment) => void;
  setOnChainSettlement: (s: OnChainSettlement) => void;
  setHotels: (search: HotelSearch, hotels: HotelOffer[]) => void;
  setStatus: (s: BookingStatus) => void;
  setError: (e: string | null) => void;
  resetBooking: () => void;

  setTreasury: (t: TreasuryState) => void;

  logEvent: (e: Omit<WorkflowEvent, 'id'>) => void;
  updateLastEvent: (
    group: string,
    patch: Partial<Omit<WorkflowEvent, 'id'>>,
  ) => void;
  clearLog: () => void;
}

function travelerFromAuth(auth: UserAuth | null): Traveler {
  if (!auth) {
    return {
      name: 'Guest',
      initials: '··',
      email: '',
      role: 'Not signed in',
    };
  }
  const initials =
    auth.displayName
      .split(/\s+/)
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || auth.address.slice(2, 4).toUpperCase();
  return {
    name: auth.displayName,
    initials,
    email: auth.email,
    role: `Passkey · ${auth.address.slice(0, 6)}…${auth.address.slice(-4)}`,
  };
}

let eventCounter = 0;

export const usePasillo = create<PasilloState>((set) => ({
  showWorkflow: true,
  dark: false,

  userAuth: null,
  setUserAuth: (userAuth) =>
    set({ userAuth, traveler: travelerFromAuth(userAuth) }),

  traveler: travelerFromAuth(null),

  search: null,
  offers: [],
  selectedOfferId: null,
  holdOrder: null,
  payment: null,
  onChainSettlement: null,
  hotelSearch: null,
  hotels: [],
  status: 'idle',
  error: null,

  settlement: {
    phase: 'idle',
    jobId: null,
    txHashes: [],
    error: null,
    lastUserOpHash: null,
  },
  setSettlementPhase: (phase) =>
    set((s) => ({ settlement: { ...s.settlement, phase } })),
  setSettlementJobId: (jobId) =>
    set((s) => ({ settlement: { ...s.settlement, jobId } })),
  pushSettlementTx: (hash) =>
    set((s) => ({
      settlement: {
        ...s.settlement,
        txHashes: [...s.settlement.txHashes, hash],
      },
    })),
  setSettlementError: (error) =>
    set((s) => ({
      settlement: {
        ...s.settlement,
        error,
        phase: error ? 'error' : s.settlement.phase,
      },
    })),
  setLastUserOpHash: (lastUserOpHash) =>
    set((s) => ({ settlement: { ...s.settlement, lastUserOpHash } })),
  resetSettlement: () =>
    set({
      settlement: {
        phase: 'idle',
        jobId: null,
        txHashes: [],
        error: null,
        lastUserOpHash: null,
      },
    }),

  treasury: null,

  workflow: [],

  setShowWorkflow: (showWorkflow) => set({ showWorkflow }),
  setDark: (dark) => {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', dark);
    }
    set({ dark });
  },

  setSearch: (search) => set({ search, status: 'searching' }),
  setOffers: (offers) =>
    set({ offers, status: offers.length > 0 ? 'selected' : 'idle' }),
  selectOffer: (selectedOfferId) => set({ selectedOfferId }),
  setHoldOrder: (holdOrder) => set({ holdOrder, status: 'held' }),
  // Duffel was paid — that is NOT the full "confirmed" state. The booking is
  // only confirmed once the user has signed the on-chain settlement.
  setPayment: (payment) => set({ payment }),
  setOnChainSettlement: (s) => set({ onChainSettlement: s, status: 'confirmed' }),
  setHotels: (hotelSearch, hotels) => set({ hotelSearch, hotels }),
  setStatus: (status) => set({ status }),
  setError: (error) =>
    set({ error, status: error ? 'error' : 'idle' }),
  resetBooking: () =>
    set({
      search: null,
      offers: [],
      selectedOfferId: null,
      holdOrder: null,
      payment: null,
      onChainSettlement: null,
      hotelSearch: null,
      hotels: [],
      status: 'idle',
      error: null,
      workflow: [],
      settlement: {
        phase: 'idle',
        jobId: null,
        txHashes: [],
        error: null,
        lastUserOpHash: null,
      },
    }),

  setTreasury: (treasury) => set({ treasury }),

  logEvent: (e) =>
    set((state) => ({
      workflow: [
        ...state.workflow,
        { ...e, id: `evt_${++eventCounter}` },
      ],
    })),

  updateLastEvent: (group, patch) =>
    set((state) => {
      const events = [...state.workflow];
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].group === group) {
          events[i] = { ...events[i], ...patch };
          break;
        }
      }
      return { workflow: events };
    }),

  clearLog: () => set({ workflow: [] }),
}));

// Hydrate persisted settings from localStorage (client-only).
export function hydrateFromStorage() {
  if (typeof window === 'undefined') return;
  // Dev convenience: expose the store on window so QA flows and the
  // browser console can poke state without wiring up React DevTools.
  if (process.env.NODE_ENV !== 'production') {
    (window as any).__pasillo = usePasillo;
  }
  try {
    const raw = localStorage.getItem('pasillo:settings');
    if (!raw) return;
    const p = JSON.parse(raw) as Partial<{
      showWorkflow: boolean;
      dark: boolean;
    }>;
    usePasillo.setState({
      showWorkflow: p.showWorkflow ?? true,
      dark: p.dark ?? false,
    });
    if (p.dark) {
      document.documentElement.classList.add('dark');
    }
  } catch {
    /* ignore */
  }
}

export function subscribePersist() {
  if (typeof window === 'undefined') return () => {};
  return usePasillo.subscribe((state) => {
    try {
      localStorage.setItem(
        'pasillo:settings',
        JSON.stringify({
          showWorkflow: state.showWorkflow,
          dark: state.dark,
        }),
      );
    } catch {
      /* ignore */
    }
  });
}

/**
 * Compact, JSON-serializable snapshot of app state for the chat agent.
 * Sent on every /api/chat POST so the agent can see who the user is, where
 * they are in a booking, and what just failed — without us having to restate
 * it in the system prompt on every turn.
 */
export function runtimeContext(): Record<string, unknown> {
  const s = usePasillo.getState();
  const compactEvents = s.workflow.slice(-6).map((e) => ({
    group: e.group,
    bullet: e.bullet,
    text: stripHtml(e.text),
    at: e.t,
  }));
  return {
    user: s.userAuth
      ? {
          name: s.traveler.name,
          email: s.traveler.email,
          mscaAddress: s.userAuth.address,
        }
      : null,
    booking: {
      status: s.status,
      search: s.search
        ? {
            origin: s.search.origin,
            destination: s.search.destination,
            departureDate: s.search.departureDate,
            returnDate: s.search.returnDate,
            passengers: s.search.passengers,
            cabinClass: s.search.cabinClass,
          }
        : null,
      offerCount: s.offers.length,
      selectedOfferId: s.selectedOfferId,
      hold: s.holdOrder
        ? {
            pnr: s.holdOrder.bookingReference,
            orderId: s.holdOrder.orderId,
            total: `${s.holdOrder.totalAmount} ${s.holdOrder.totalCurrency}`,
            paymentRequiredBy: s.holdOrder.paymentRequiredBy,
          }
        : null,
      duffelPaid: !!s.payment,
      settlement: {
        phase: s.settlement.phase,
        jobId: s.settlement.jobId,
        txsCollected: s.settlement.txHashes.length,
        lastError: s.settlement.error,
      },
      onChainSettled: !!s.onChainSettlement,
    },
    lastError: s.error,
    recentWorkflow: compactEvents,
  };
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// Derive the current workflow step (0-6) for StepRail. Steps:
//   0 Intake · 1 Search · 2 Review · 3 Hold · 4 Pay · 5 Settle · 6 Done.
export function deriveStep(state: PasilloState): number {
  if (state.onChainSettlement) return 6;
  const phase = state.settlement.phase;
  if (phase !== 'idle' && phase !== 'error') return 5; // settling in progress
  if (state.payment) return 5; // Duffel paid, waiting on user to settle
  if (state.holdOrder) return 4; // Hold created, awaiting Duffel pay
  if (state.status === 'holding') return 3;
  if (state.selectedOfferId) return 3;
  if (state.offers.length > 0) return 2;
  if (state.search) return 1;
  if (state.status === 'searching') return 1;
  return 0;
}
