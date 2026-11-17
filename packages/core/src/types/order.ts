import type {
  CouponKind,
  ErrorCodeLike,
  ManualPaymentMethod,
  OrderEventType,
  OrderSource,
  OrderStatus,
  PaymentDriverKey,
  PaymentStatus,
  RefundStatus,
  ShipmentCarrier,
  ShipmentStatus,
  ShippingKind,
  ShippingMethodKey,
} from "./enums";
import type { Actor, IsoDateTime, Paged, Toman, Ulid } from "./common";
import type { Address } from "./customer";
import type { SalesChannel } from "../channel";
import type { ProvinceCode } from "../geo/provinces";

export type {
  QuoteRequest,
  PlaceRequest,
  TrackRequest,
  CartLineInput,
  CartSyncInput,
  WishlistSyncInput,
  ReturnRequestInput,
  QuoteAddressRef,
} from "../validation/checkout";

// ---------------------------------------------------------------- pure pricing (money/totals.ts)
export type PricedLine = { productId: number; unitPrice: Toman; qty: number; compareAt: Toman | null };

export type CouponEval = {
  couponId: number;
  code: string;
  kind: CouponKind;
  value: Toman;
  maxDiscount: Toman | null;
  minSubtotal: Toman;
  eligibleProductIds: number[] | "all";
  stackableWithPoints: boolean;
};

export type TotalsLine = { productId: number; qty: number; unitPrice: Toman; lineTotal: Toman };

export type Totals = {
  subtotal: Toman;
  couponAmount: Toman;
  discount: Toman;
  pointsDiscount: Toman;
  shipping: Toman;
  grandTotal: Toman;
  freeShipping: boolean;
  lines: TotalsLine[];
};

// ---------------------------------------------------------------- quote
export type QuoteLineStatus = "ok" | "qty_reduced" | "removed" | "price_changed";

export type QuoteLine = {
  productId: number;
  name: string;
  image: string | null;
  unitPrice: Toman;
  compareAt?: Toman;
  qty: number;
  lineTotal: Toman;
  available: number;
  status: QuoteLineStatus;
};

export type QuoteWarning =
  | { kind: "price_changed"; productId: number; from: Toman; to: Toman }
  | { kind: "qty_reduced"; productId: number; from: number; to: number; reason: "stock" | "max_per_order" }
  | { kind: "removed"; productId: number; reason: "on_request" | "archived" | "hidden" | "out_of_stock" | "instalment_ineligible" }
  | { kind: "coupon_not_applied"; code: string; error: ErrorCodeLike }
  | { kind: "points_capped"; requested: number; used: number };

export type QuoteCoupon = { code: string; kind: CouponKind; amount: Toman } | { error: ErrorCodeLike };
export type QuotePoints = { available: number; used: number; value: Toman };
export type ShippingOption = { key: string; name: string; cost: Toman; etaMin: number; etaMax: number };

export type Quote = {
  /** Which storefront priced it - part of the signed payload (pricing/sign.ts). */
  channel: SalesChannel;
  lines: QuoteLine[];
  subtotal: Toman;
  discount: Toman;
  pointsDiscount: Toman;
  shipping: Toman;
  grandTotal: Toman;
  coupon?: QuoteCoupon;
  points?: QuotePoints;
  shippingKey: string | null;
  shippingOptions: ShippingOption[];
  warnings: QuoteWarning[];
  sig: string;
  expiresAt: IsoDateTime;
};

// ---------------------------------------------------------------- orders
export type OrderAddressSnapshot = Omit<Address, "id" | "customerId" | "isDefault" | "createdAt">;

export type OrderShippingSnapshot = { key: string; name: string; etaMin: number; etaMax: number; cost: Toman };

export type OrderItem = {
  id: Ulid;
  productId: number;
  name: string;
  sku: string | null;
  modelCode: string | null;
  colorName: string | null;
  imageKey: string | null;
  unitPrice: Toman;
  compareAtPrice: Toman | null;
  qty: number;
  lineTotal: Toman;
  warrantyMonths: number | null;
};

export type OrderEvent = {
  id: number;
  // DECISION (M0 lint): was `OrderEventType | string`, which TypeScript collapses to plain `string` - 
  // the union documented nothing and disabled switch-exhaustiveness. The column is `text`, so
  // the repository validates the row against ORDER_EVENT_TYPES when mapping it to this domain type.
  type: OrderEventType;
  payload: Record<string, unknown> | null;
  actor: Actor;
  createdAt: IsoDateTime;
};

export type Order = {
  id: Ulid;
  code: string;
  invoiceNo: number | null;
  customerId: Ulid | null;
  phone: string;
  email: string | null;
  status: OrderStatus;
  source: OrderSource;
  /** Which storefront placed it - NOT `channelRef`, which is an external id of a `source`. */
  channel: SalesChannel;
  channelRef: string | null;
  subtotal: Toman;
  discountTotal: Toman;
  shippingTotal: Toman;
  pointsDiscount: Toman;
  grandTotal: Toman;
  couponId: number | null;
  couponCode: string | null;
  pointsRedeemed: number;
  pointsEarned: number;
  shippingMethodKey: string;
  shipping: OrderShippingSnapshot;
  address: OrderAddressSnapshot;
  customerNote: string | null;
  adminNote: string | null;
  giftMessage: string | null;
  isGift: boolean;
  items: OrderItem[];
  placedAt: IsoDateTime;
  paidAt: IsoDateTime | null;
  shippedAt: IsoDateTime | null;
  deliveredAt: IsoDateTime | null;
  cancelledAt: IsoDateTime | null;
  cancelReason: string | null;
  expiresAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type Payment = {
  id: Ulid;
  orderId: Ulid;
  // DECISION (M0 lint): see OrderEvent.type - `| string` collapsed the union to `string`; the driver
  // registry is closed (PAYMENT_DRIVER_KEYS, the spec).
  driver: PaymentDriverKey;
  amount: Toman;
  status: PaymentStatus;
  authority: string | null;
  refId: string | null;
  cardPanMasked: string | null;
  fee: Toman | null;
  createdAt: IsoDateTime;
  verifiedAt: IsoDateTime | null;
};

export type Refund = {
  id: Ulid;
  paymentId: Ulid;
  orderId: Ulid;
  amount: Toman;
  reason: string;
  status: RefundStatus;
  providerRef: string | null;
  byStaffId: Ulid | null;
  createdAt: IsoDateTime;
  doneAt: IsoDateTime | null;
};

export type Shipment = {
  id: Ulid;
  orderId: Ulid;
  carrier: ShipmentCarrier;
  trackingCode: string | null;
  trackingUrl: string | null;
  status: ShipmentStatus;
  cost: Toman | null;
  shippedAt: IsoDateTime | null;
  deliveredAt: IsoDateTime | null;
  note: string | null;
};

/** Internal order detail shared with admin tools. Never serialize this directly to a customer. */
export type OrderView = Order & {
  events: OrderEvent[];
  payment: Pick<Payment, "driver" | "status" | "refId" | "cardPanMasked" | "verifiedAt"> | null;
  shipment: Shipment | null;
  canCancel: boolean;
  /** Paid with SnappPay and not shipped yet: cancellation goes through support (and a refund). */
  cancelViaSupport: boolean;
  canReturn: boolean;
  canRetryPayment: boolean;
  isTest: boolean;
};

export type CustomerTimelineStep = { key: "placed" | "paid" | "processing" | "shipped" | "delivered" | "cancelled" | "refunded" | "returned"; at: string | null; label: string; done: boolean; tracking?: { carrier: ShipmentCarrier; code: string | null; url: string | null } };

/** Explicit allowlist: adding an internal Order field must not expand a customer response. */
export type CustomerOrderView = Pick<Order,
  "id" | "code" | "invoiceNo" | "status" | "channel" | "phone" | "subtotal" |
  "discountTotal" | "shippingTotal" | "pointsDiscount" | "grandTotal" | "pointsRedeemed" |
  "pointsEarned" | "shipping" | "address" | "customerNote" | "giftMessage" | "isGift" |
  "items" | "placedAt" | "paidAt" | "shippedAt" | "deliveredAt" | "cancelledAt" | "expiresAt"
> & Pick<OrderView, "payment" | "canCancel" | "cancelViaSupport" | "canReturn" | "canRetryPayment" | "isTest"> & {
  timeline: CustomerTimelineStep[];
  shipment: Pick<Shipment, "carrier" | "trackingCode" | "trackingUrl" | "status" | "shippedAt" | "deliveredAt"> | null;
};

/** Tracking by code and phone only needs fulfilment status, items and the paid total. */
export type OrderTrackView = Pick<CustomerOrderView, "code" | "status" | "grandTotal" | "timeline"> & {
  items: Pick<OrderItem, "id" | "name" | "qty" | "lineTotal">[];
  phoneMasked: string;
};

export type OrderRow = {
  id: Ulid;
  code: string;
  customerName: string | null;
  phoneMasked: string;
  itemsCount: number;
  grandTotal: Toman;
  status: OrderStatus;
  paymentStatus: PaymentStatus | null;
  /** The driver of the SUCCEEDED payment, if there is one - which gateway actually took the money. */
  paymentDriver: PaymentDriverKey | null;
  /** The method of the latest payment attempt, whatever its state; null = no online payment at all. */
  method: PaymentDriverKey | null;
  shipmentStatus: ShipmentStatus | null;
  source: OrderSource;
  channel: SalesChannel;
  placedAt: IsoDateTime;
  hasNote: boolean;
  flagged: boolean;
};

/** Customer history never includes staff flags, internal-note presence or customer identifiers. */
export type CustomerOrderRow = Pick<OrderRow,
  "id" | "code" | "itemsCount" | "grandTotal" | "status" | "paymentStatus" |
  "paymentDriver" | "method" | "shipmentStatus" | "channel" | "placedAt"
>;

export type OrderQuery = {
  q?: string;
  status?: OrderStatus[];
  source?: OrderSource[];
  channel?: SalesChannel;
  /** The latest payment attempt's method; "none" = orders with no payment row (phone/manual). */
  method?: PaymentDriverKey | "none";
  /** SnappPay orders a person must look at (see repo `snapppayAttentionSql`). */
  attention?: boolean;
  from?: IsoDateTime;
  to?: IsoDateTime;
  shippingMethodKey?: string;
  couponCode?: string;
  province?: ProvinceCode;
  hasNote?: boolean;
  flagged?: boolean;
  customerId?: Ulid;
  page: number;
  pageSize: 50 | 100 | 200;
  sort?: "placed_desc" | "placed_asc" | "total_desc" | "total_asc";
};

export type OrdersPage = Paged<OrderRow>;

export type PlaceResult = { order: Order; payment: { redirectUrl: string } };
export type CallbackResult = { orderCode: string; ok: boolean; test: boolean; pending?: boolean };

export type ManualOrderInput = {
  customerId: Ulid | null;
  phone: string;
  customer?: { firstName: string; lastName: string };
  items: { productId: number; qty: number; unitPriceOverride?: Toman; overrideReason?: string }[];
  discount?: { amount: Toman; note: string };
  shippingMethodKey: string;
  address: OrderAddressSnapshot;
  adminNote?: string;
  source: Exclude<OrderSource, "web">;
  channelRef?: string;
  settle: { kind: "payment_link" } | { kind: "manual"; method: ManualPaymentMethod; reference: string };
};

// ---------------------------------------------------------------- shipping
export type ShippingRate = {
  flat?: Toman;
  byProvince?: Partial<Record<ProvinceCode, Toman>>;
  freeAbove?: Toman;
};

export type ShippingMethod = {
  id: number;
  // DECISION (M0 lint): see OrderEvent.type - `| string` collapsed the union to `string`; the seeded
  // set is closed (SHIPPING_METHOD_KEYS, the spec).
  key: ShippingMethodKey;
  name: string;
  description: string;
  kind: ShippingKind;
  rate: ShippingRate;
  provinces: ProvinceCode[] | null;
  etaMinDays: number;
  etaMaxDays: number;
  isActive: boolean;
  sort: number;
};

// ---------------------------------------------------------------- cart / coupons
export type CartLine = { id: number; qty: number; addedAt: IsoDateTime };

export type CouponScope = { brandIds?: number[]; categoryIds?: number[]; collectionIds?: number[]; productIds?: number[] };

export type Coupon = {
  id: number;
  code: string;
  kind: CouponKind;
  value: Toman;
  minSubtotal: Toman;
  maxDiscount: Toman | null;
  startsAt: IsoDateTime | null;
  endsAt: IsoDateTime | null;
  usageLimit: number | null;
  usagePerCustomer: number;
  firstOrderOnly: boolean;
  customerId: Ulid | null;
  applies: CouponScope;
  excludes: CouponScope;
  stackableWithPoints: boolean;
  isActive: boolean;
  usedCount: number;
  createdAt: IsoDateTime;
};
