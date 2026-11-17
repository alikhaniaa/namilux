import type { ActorType, CustomerTier, RoleName } from "../constants";
import type { Permission } from "../authz/permissions";

export type Actor = { type: ActorType; id: string | null; ip?: string };

export type Toman = number;
export type IsoDateTime = string;
export type IsoDate = string;
export type Ulid = string;

export type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };

export type Renditions = { avif: Record<string, string>; webp: Record<string, string>; master: string };

export type ImageRef = {
  key: string;
  alt: string;
  width: number;
  height: number;
  lqip?: string;
  renditions?: Renditions;
};

export type Crumb = { name: string; href: string };

export type Badge = { kind: "sale"; percent: number } | { kind: "new" } | { kind: "last" } | { kind: "out" };

export type SeoFields = {
  title: string | null;
  description: string | null;
  robots: string;
  canonical: string;
  ogImage: string | null;
  lastmod: IsoDateTime | null;
};

export type SessionUser = {
  customerId: Ulid;
  phone: string;
  phoneVerifiedAt: IsoDateTime | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  tier: CustomerTier;
  pointsBalance: number;
  isBlocked: boolean;
  sessionId: Ulid;
  /** last successful OTP verification for this customer - drives re-verification */
  lastOtpAt: IsoDateTime | null;
};

export type StaffUser = {
  id: Ulid;
  email: string;
  name: string;
  role: RoleName;
  permissions: Permission[];
  /** M0 step 3 merge: authz/permissions.ts (DONE) narrows to Pick<StaffUser, "role" | "isActive">
   *  and its rules require "inactive staff have no permissions regardless of role". */
  isActive: boolean;
  totpEnabled: boolean;
  /** end of the current sudo window or null */
  sudoUntil: IsoDateTime | null;
  sessionId: Ulid;
  mustChangePassword: boolean;
};

export type DateRange = { from: IsoDateTime; to: IsoDateTime };

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
