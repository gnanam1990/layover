import { z } from "zod";
import { CURRENCIES } from "./money";

// Mirrors docs/build-pack/08-reference/schemas/*.json (names kept identical).

export const Iata = z.string().regex(/^[A-Z]{3}$/);
export const Money = z.strictObject({
  amountMinor: z.string().regex(/^-?[0-9]+$/),
  currency: z.enum(CURRENCIES),
});

export const FlightState = z.enum(["scheduled", "delayed", "cancelled", "departed", "arrived"]);
export const ReasonClass = z.enum(["weather", "atc", "security", "technical", "crew", "strike", "unknown"]);

export const FlightStatus = z.strictObject({
  state: FlightState,
  depDelayMin: z.number().int(),
  arrDelayMin: z.number().int(),
  noticeAtUtc: z.string().nullable().optional(),
  reasonText: z.string().nullable().optional(),
  reasonClass: ReasonClass.nullable().optional(),
});

export const Flight = z.object({
  id: z.string(),
  carrier: z.string(),
  number: z.string(),
  from: Iata,
  to: Iata,
  schedDepUtc: z.string(),
  schedArrUtc: z.string(),
  bookingRef: z.string().nullable().optional(),
  airlineCountry: z.string().nullable().optional(),
  status: FlightStatus.optional(),
});

export const RoomClass = z.enum(["standard", "superior", "deluxe", "suite"]);
export const ROOM_RANK: Record<z.infer<typeof RoomClass>, number> = {
  standard: 0,
  superior: 1,
  deluxe: 2,
  suite: 3,
};

export const HotelBooking = z.object({
  id: z.string(),
  merchantId: z.string(),
  hotelId: z.string(),
  hotelName: z.string(),
  rating: z.number().optional(),
  roomClass: RoomClass.optional(),
  checkIn: z.iso.date(),
  checkOut: z.iso.date(),
  price: Money,
  refundable: z.boolean(),
  cancelDeadlineUtc: z.string().optional(),
  confirmation: z.string().optional(),
  paymentTx: z.string().nullable().optional(),
  payer: z.string().nullable().optional(),
  status: z.enum(["active", "cancelled", "replaced"]),
});

export const TripSettings = z.object({
  autoRebook: z.boolean(),
  minSaving: Money,
  autoRescue: z.boolean(),
  emergencyBudget: Money,
  maxPerBooking: Money,
  maxHotelDistanceKm: z.number().default(10),
  minRating: z.number().default(3.5),
});

export const Trip = z.object({
  id: z.string(),
  travelerName: z.string(),
  flights: z.array(Flight),
  hotelBookings: z.array(HotelBooking),
  settings: TripSettings,
  status: z.enum(["draft", "protected", "completed"]),
});

export const SessionStatus = z.enum(["requested", "active", "expired", "exhausted", "rejected"]);
export const SessionRecord = z.object({
  id: z.string(),
  requestId: z.string(),
  purpose: z.literal("trip").optional(),
  maxPerTx: Money,
  maxTotal: Money,
  ttlUntilUtc: z.string(),
  status: SessionStatus,
  approvalUrl: z.string().nullable().optional(),
});

export const Offer = z.object({
  merchantId: z.string(),
  hotelId: z.string(),
  hotelName: z.string(),
  rating: z.number().optional(),
  roomClass: z.string().optional(),
  distanceKm: z.number().nullable().optional(),
  checkIn: z.string(),
  checkOut: z.string(),
  price: Money,
  refundable: z.boolean(),
  cancelDeadlineUtc: z.string().optional(),
  payUrl: z.url(),
  rateTier: z.number().int().optional(),
});

export const PolicyCheck = z.object({ name: z.string(), pass: z.boolean(), detail: z.string() });
export const PolicyDecision = z.object({
  allow: z.boolean(),
  action: z.enum(["rebook", "rescue_hotel", "rescue_ride"]),
  checks: z.array(PolicyCheck),
  reasons: z.array(z.string()),
});

export const PackId = z.enum(["eu261", "uk261", "us_dot", "in_dgca"]);
export const Confidence = z.enum(["HIGH", "MEDIUM", "VERIFY"]);
export const EntitlementKind = z.enum([
  "refund",
  "compensation",
  "care_meal",
  "care_hotel",
  "care_transport",
  "reroute",
]);
export const Entitlement = z.object({
  kind: EntitlementKind,
  amount: Money.optional(),
  amountUpTo: Money.optional(),
  confidence: Confidence,
  basis: z.string(),
  sourceUrl: z.string(),
});
export const PackAssessment = z.object({
  pack: PackId,
  applies: z.boolean(),
  why: z.string().optional(),
  entitlements: z.array(Entitlement),
  doNot: z.array(z.string()),
  actions: z.array(z.string()),
  evidenceNeeded: z.array(z.string()),
});
export const RightsAssessment = z.object({
  flightId: z.string(),
  packs: z.array(PackAssessment),
  bestRemedy: z.string(),
  rulePackVersions: z.record(z.string(), z.string()),
  disclaimer: z.string(),
});

export const Receipt = z.object({ desc: z.string(), amount: Money, tx: z.string(), explorerUrl: z.string() });
export const ClaimLetter = z.strictObject({ subject: z.string(), body: z.string() });
export const ClaimPack = z.object({
  id: z.string(),
  tripId: z.string(),
  flightId: z.string(),
  airline: z.string(),
  packs: z.array(z.string()).optional(),
  entitlements: z.array(Entitlement),
  timeline: z.array(z.unknown()).optional(),
  receipts: z.array(Receipt),
  letter: ClaimLetter,
  validated: z.boolean(),
});

export const TIMELINE_TYPES = [
  "trip_added",
  "session_requested",
  "session_active",
  "price_checked",
  "price_drop",
  "policy_decision",
  "payment",
  "booking_confirmed",
  "cancel_requested",
  "refund_verified",
  "flight_status",
  "disruption",
  "rights_assessed",
  "rescue_booked",
  "voucher_warning",
  "claim_ready",
  "rescue_options",
  "error",
] as const;
export const TimelineEventType = z.enum(TIMELINE_TYPES);
export const TimelineLink = z.object({ label: z.string(), url: z.string() });
export const TimelineEvent = z.object({
  id: z.string(),
  tripId: z.string(),
  atUtc: z.string(),
  type: TimelineEventType,
  simulated: z.boolean(),
  title: z.string(),
  detail: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  links: z.array(TimelineLink).optional(),
});

// ---- SERV structured outputs (strict: no extra keys) ----
const nstr = z.string().nullable();
export const TripDraft = z.strictObject({
  travelerName: nstr,
  flights: z.array(
    z.strictObject({ carrier: nstr, number: nstr, from: nstr, to: nstr, date: nstr, bookingRef: nstr }),
  ),
  hotels: z.array(
    z.strictObject({
      name: nstr,
      checkIn: nstr,
      checkOut: nstr,
      confirmation: nstr,
      pricePaid: z.number().nullable(),
    }),
  ),
  missing: z.array(z.string()),
});
export const NoticeFacts = z.strictObject({
  state: z.enum(["cancelled", "delayed", "rescheduled", "unknown"]),
  newDepUtc: nstr,
  offeredAlternatives: z.array(z.string()),
  offeredVoucher: z.boolean(),
  reasonClass: ReasonClass,
  noticeAtUtc: nstr,
});
export const Explanation = z.strictObject({
  headline: z.string(),
  bullets: z.array(z.string()).max(5),
  doNot: z.array(z.string()).max(3),
  disclaimer: z.string(),
});
export const OptionWhy = z.strictObject({ why: z.array(z.string()) });
export const DeskPhrases = z.strictObject({
  language: z.string(),
  phrases: z.array(z.strictObject({ local: z.string(), english: z.string() })).max(4),
});

/** Language spoken at the airport desk, by airport country (null = English is fine). */
export const DESK_LANGUAGE: Record<string, string | null> = {
  DE: "German",
  FR: "French",
  NL: "Dutch",
  ES: "Spanish",
  IN: "Hindi",
  AE: "Arabic",
  GB: null,
  US: null,
  SG: null,
};

// ---- Rule packs ----
export const RulePackEntry = z.object({ key: z.string(), confidence: Confidence, source: z.string() });
export const RulePackBand = z.object({
  maxKm: z.number().nullable(),
  amount: z.number().int(),
  currency: z.string(),
  careAfterMin: z.number().int().optional(),
});
export const RulePack = z.looseObject({
  id: PackId,
  version: z.string(),
  officialUrl: z.string(),
  applies: z.record(z.string(), z.unknown()),
  bands: z.array(RulePackBand).optional(),
  cancellation: z.record(z.string(), z.unknown()).optional(),
  delay: z.record(z.string(), z.unknown()).optional(),
  care: z.record(z.string(), z.unknown()).optional(),
  voucherWarning: z.record(z.string(), z.unknown()).optional(),
  entries: z.array(RulePackEntry),
});

export const Airport = z.object({
  lat: z.number(),
  lon: z.number(),
  country: z.string(),
  region: z.enum(["EU", "EEA", "UK", "US", "IN", "OTHER"]),
  tz: z.string(),
  name: z.string().optional(),
});

// ---- Inferred types (same names as the schemas) ----
export type Money = z.infer<typeof Money>;
export type Flight = z.infer<typeof Flight>;
export type FlightStatus = z.infer<typeof FlightStatus>;
export type ReasonClass = z.infer<typeof ReasonClass>;
export type RoomClass = z.infer<typeof RoomClass>;
export type HotelBooking = z.infer<typeof HotelBooking>;
export type TripSettings = z.infer<typeof TripSettings>;
export type Trip = z.infer<typeof Trip>;
export type SessionRecord = z.infer<typeof SessionRecord>;
export type Offer = z.infer<typeof Offer>;
export type PolicyCheck = z.infer<typeof PolicyCheck>;
export type PolicyDecision = z.infer<typeof PolicyDecision>;
export type PackId = z.infer<typeof PackId>;
export type Confidence = z.infer<typeof Confidence>;
export type Entitlement = z.infer<typeof Entitlement>;
export type PackAssessment = z.infer<typeof PackAssessment>;
export type RightsAssessment = z.infer<typeof RightsAssessment>;
export type Receipt = z.infer<typeof Receipt>;
export type ClaimLetter = z.infer<typeof ClaimLetter>;
export type ClaimPack = z.infer<typeof ClaimPack>;
export type TimelineEventType = z.infer<typeof TimelineEventType>;
export type TimelineEvent = z.infer<typeof TimelineEvent>;
export type TripDraft = z.infer<typeof TripDraft>;
export type NoticeFacts = z.infer<typeof NoticeFacts>;
export type Explanation = z.infer<typeof Explanation>;
export type OptionWhy = z.infer<typeof OptionWhy>;
export type DeskPhrases = z.infer<typeof DeskPhrases>;
export type RulePack = z.infer<typeof RulePack>;
export type Airport = z.infer<typeof Airport>;
