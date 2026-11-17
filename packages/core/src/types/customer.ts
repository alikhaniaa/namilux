import type {
  BackInStockStatus,
  CustomerTier,
  Gender,
  LoyaltyReason,
  QuestionKind,
  QuestionStatus,
  ReferralStatus,
  ReviewStatus,
} from "./enums";
import type { IsoDate, IsoDateTime, Paged, Toman, Ulid } from "./common";
import type { ProvinceCode } from "../geo/provinces";
import type { SalesChannel } from "../channel";

export type { ProfileInput } from "../validation/auth";
export type { AddressInput } from "../validation/address";
export type { ReviewInput, ReviewModerateInput } from "../validation/reviews";
export type { QuestionInput, ConciergeInput, BackInStockInput, ContactInput, NewsletterInput } from "../validation/requests";

export type Customer = {
  id: Ulid;
  phone: string;
  phoneVerifiedAt: IsoDateTime | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  birthday: IsoDate | null;
  gender: Gender | null;
  tier: CustomerTier;
  pointsBalance: number;
  referralCode: string;
  referredById: Ulid | null;
  marketingOptIn: boolean;
  isBlocked: boolean;
  blockReason: string | null;
  adminNote: string | null;
  lastLoginAt: IsoDateTime | null;
  ordersCount: number;
  lifetimeSpend: Toman;
  createdAt: IsoDateTime;
};

export type Address = {
  id: Ulid;
  customerId: Ulid;
  label: string;
  recipientName: string;
  recipientPhone: string;
  province: ProvinceCode;
  city: string;
  address: string;
  plaque: string | null;
  unit: string | null;
  postcode: string;
  isDefault: boolean;
  createdAt: IsoDateTime;
};

/**
 * Mirrors settings key `loyalty.rules`. DECISION (M0 step 3): re-exported from ../loyalty/rules
 * (`z.infer<typeof loyaltyRulesSchema>`) rather than hand-declared here - the hand-written mirror had
 * drifted from the schema (tiers vs tierThresholds, benefits.*From vs benefits.*.minTier) and this
 * file's own comment names settings/schema.ts - which builds the key from loyaltyRulesSchema - the
 * source of truth. No shape is redeclared, so the two can no longer disagree.
 */
export type { LoyaltyRules } from "../loyalty/rules";

export type LoyaltyLedgerEntry = {
  id: number;
  customerId: Ulid;
  delta: number;
  reason: LoyaltyReason;
  orderId: Ulid | null;
  expiresAt: IsoDateTime | null;
  note: string | null;
  createdAt: IsoDateTime;
};

export type TierInfo = {
  tier: CustomerTier;
  spend12m: Toman;
  nextTier: CustomerTier | null;
  toNextTier: Toman | null;
};

export type Review = {
  id: Ulid;
  productId: number;
  customerId: Ulid;
  customerDisplayName: string;
  orderId: Ulid | null;
  rating: 1 | 2 | 3 | 4 | 5;
  title: string;
  body: string;
  pros: string[];
  cons: string[];
  isVerifiedPurchase: boolean;
  status: ReviewStatus;
  adminReply: string | null;
  repliedAt: IsoDateTime | null;
  helpfulCount: number;
  createdAt: IsoDateTime;
};

export type ReviewSummary = { avg: number; count: number; histogram: Record<1 | 2 | 3 | 4 | 5, number> };

export type Question = {
  id: Ulid;
  productId: number | null;
  customerId: Ulid | null;
  phoneMasked: string;
  kind: QuestionKind;
  body: string;
  answer: string | null;
  status: QuestionStatus;
  answeredByStaffId: Ulid | null;
  createdAt: IsoDateTime;
  answeredAt: IsoDateTime | null;
  /** The storefront it was sent from: a request from the instalment site is answered with that site's price. */
  channel: SalesChannel;
};

/** Admin inbox row for a concierge (price) request - includes the full phone for staff reply. */
export type ConciergeRequest = Question & { kind: "price"; phone: string; productSlug: string; productName: string };

export type BackInStockRequest = {
  id: Ulid;
  productId: number;
  phone: string;
  customerId: Ulid | null;
  status: BackInStockStatus;
  createdAt: IsoDateTime;
  notifiedAt: IsoDateTime | null;
};

export type Referral = {
  id: number;
  referrerId: Ulid;
  refereeId: Ulid;
  status: ReferralStatus;
  orderId: Ulid | null;
  createdAt: IsoDateTime;
};

export type CustomerRow = {
  id: Ulid;
  name: string | null;
  phoneMasked: string;
  tier: CustomerTier;
  ordersCount: number;
  lifetimeSpend: Toman;
  lastOrderAt: IsoDateTime | null;
  marketingOptIn: boolean;
  isBlocked: boolean;
  createdAt: IsoDateTime;
};

export type CustomerQuery = {
  q?: string;
  tier?: CustomerTier[];
  blocked?: boolean;
  optIn?: boolean;
  /** Only customers with at least one order on this storefront (a staff member confined to one site). */
  channel?: SalesChannel;
  page: number;
  pageSize: 50 | 100 | 200;
};

export type ConciergeQuery = {
  kind?: QuestionKind[];
  status?: QuestionStatus[];
  productId?: number;
  page: number;
  pageSize: 50 | 100 | 200;
};

export type CustomersPage = Paged<CustomerRow>;
