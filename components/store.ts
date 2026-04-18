'use client';

/**
 * Pasillo live booking state — Zustand store.
 *
 * Single source of truth for: current search, offers, selected offer,
 * hold order, payment, treasury status, workflow log. Replaces the
 * scenario data model.
 */

import { create } from 'zustand';

export type Token = 'USDC' | 'EURC' | 'AUTO';
export type Verbosity = 'terse' | 'normal' | 'verbose';

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

interface PasilloState {
  // Settings
  token: Token;
  verbosity: Verbosity;
  showGlobe: boolean;
  dark: boolean;

  // Traveler / partner (host context)
  traveler: Traveler;
  partner: { name: string; code: string; tier: string };

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

  // Treasury
  treasury: TreasuryState | null;

  // Workflow log
  workflow: WorkflowEvent[];

  // Actions
  setToken: (t: Token) => void;
  setVerbosity: (v: Verbosity) => void;
  setShowGlobe: (v: boolean) => void;
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

const DEFAULT_TRAVELER: Traveler = {
  name: 'Nadia Chen',
  initials: 'NC',
  email: 'n.chen@acme.fin',
  role: 'Senior PM · Acme Finance',
};

const DEFAULT_PARTNER = {
  name: 'Acme Finance Co.',
  code: 'ACME-FIN',
  tier: 'Corporate',
};

let eventCounter = 0;

export const usePasillo = create<PasilloState>((set) => ({
  token: 'AUTO',
  verbosity: 'normal',
  showGlobe: true,
  dark: false,

  traveler: DEFAULT_TRAVELER,
  partner: DEFAULT_PARTNER,

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

  treasury: null,

  workflow: [],

  setToken: (token) => set({ token }),
  setVerbosity: (verbosity) => set({ verbosity }),
  setShowGlobe: (showGlobe) => set({ showGlobe }),
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
  setPayment: (payment) => set({ payment, status: 'confirmed' }),
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
  try {
    const raw = localStorage.getItem('pasillo:settings');
    if (!raw) return;
    const p = JSON.parse(raw) as Partial<{
      token: Token;
      verbosity: Verbosity;
      showGlobe: boolean;
      dark: boolean;
    }>;
    usePasillo.setState({
      token: p.token ?? 'AUTO',
      verbosity: p.verbosity ?? 'normal',
      showGlobe: p.showGlobe ?? true,
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
          token: state.token,
          verbosity: state.verbosity,
          showGlobe: state.showGlobe,
          dark: state.dark,
        }),
      );
    } catch {
      /* ignore */
    }
  });
}

// Derive the current workflow step (0-5) for StepRail.
export function deriveStep(state: PasilloState): number {
  if (state.status === 'confirmed') return 6;
  if (state.status === 'paying') return 5;
  if (state.status === 'held') return 4;
  if (state.status === 'holding') return 3;
  if (state.status === 'selected') return 2;
  if (state.status === 'searching') return 1;
  return 0;
}
