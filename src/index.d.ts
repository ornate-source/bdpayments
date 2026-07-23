// ============================================================================
// BDPayments — TypeScript Definitions
// ============================================================================

// --- Gateway Names ---

export type GatewayName = "stripe" | "sslcommerz" | "bkash" | "nagad";

// --- Per-Gateway Config Interfaces ---

/** Options accepted by every gateway config. */
export interface CommonConfig {
  /** Abort gateway requests after this many milliseconds. Defaults to 30000. */
  timeoutMs?: number;
}

export interface StripeConfig extends CommonConfig {
  apiKey: string;
}

export interface SSLCommerzConfig extends CommonConfig {
  storeId: string;
  storePassword: string;
  sandbox?: boolean;
}

export interface BkashConfig extends CommonConfig {
  appKey: string;
  appSecret: string;
  username: string;
  password: string;
  sandbox?: boolean;
}

export interface NagadConfig extends CommonConfig {
  merchantId: string;
  publicKey: string;
  privateKey: string;
  sandbox?: boolean;
  /** Sent as the `X-KM-IP-V4` header. Defaults to "127.0.0.1". */
  clientIp?: string;
  /** Override the API base URL (e.g. an HTTPS sandbox endpoint). */
  baseUrl?: string;
}

export interface GatewayConfigs {
  stripe?: StripeConfig;
  sslcommerz?: SSLCommerzConfig;
  bkash?: BkashConfig;
  nagad?: NagadConfig;
}

// --- Configure ---

/**
 * Set global credentials for one or more gateways.
 * Call this once at app startup.
 *
 * @throws {PaymentError} With code "INVALID_CONFIG" for unknown gateway names.
 */
export function configure(configs: GatewayConfigs): void;

/**
 * Clear all stored global configuration, plus cached auth tokens and SDK clients.
 */
export function clearConfig(): void;

// --- Charge Options ---

/**
 * Fields shared by every charge call.
 *
 * Gateway-specific option types intentionally do **not** carry an index
 * signature, so TypeScript rejects fields belonging to another gateway.
 * Use `extra` to pass anything not modelled here.
 */
export interface BaseChargeOptions {
  gateway: GatewayName;
  amount: number;
  currency?: string;
  description?: string;
  /** Passed straight through to the gateway API. */
  extra?: Record<string, any>;
}

export interface StripeChargeOptions extends BaseChargeOptions {
  gateway: "stripe";
  /** Amount in the smallest currency unit (e.g. cents). Must be an integer. */
  amount: number;
  currency: string;
  apiKey?: string;
  timeoutMs?: number;
  paymentMethod?: string;
  customer?: string;
  confirm?: boolean;
  returnUrl?: string;
  metadata?: Record<string, string>;
  /** Forwarded to Stripe as an idempotency key. */
  idempotencyKey?: string;
}

export interface SSLCommerzChargeOptions extends BaseChargeOptions {
  gateway: "sslcommerz";
  storeId?: string;
  storePassword?: string;
  sandbox?: boolean;
  timeoutMs?: number;
  transactionId: string;
  successUrl: string;
  failUrl: string;
  cancelUrl: string;
  ipnUrl?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAddress?: string;
  customerCity?: string;
  customerCountry?: string;
  productName?: string;
  productCategory?: string;
  productProfile?: string;
  shippingMethod?: string;
}

export interface BkashChargeOptions extends BaseChargeOptions {
  gateway: "bkash";
  appKey?: string;
  appSecret?: string;
  username?: string;
  password?: string;
  sandbox?: boolean;
  timeoutMs?: number;
  invoiceNumber: string;
  payerReference?: string;
  callbackURL?: string;
  intent?: "sale" | "authorization";
  mode?: string;
}

export interface NagadChargeOptions extends BaseChargeOptions {
  gateway: "nagad";
  merchantId?: string;
  publicKey?: string;
  privateKey?: string;
  sandbox?: boolean;
  timeoutMs?: number;
  clientIp?: string;
  baseUrl?: string;
  orderId: string;
  callbackURL?: string;
  customerPhone?: string;
}

export type ChargeOptions =
  | StripeChargeOptions
  | SSLCommerzChargeOptions
  | BkashChargeOptions
  | NagadChargeOptions;

// --- Execute Options ---

export interface BkashExecuteOptions {
  gateway: "bkash";
  /** The bKash payment ID returned by charge(). */
  paymentID: string;
  appKey?: string;
  appSecret?: string;
  username?: string;
  password?: string;
  sandbox?: boolean;
  timeoutMs?: number;
  extra?: Record<string, any>;
}

/** Only bKash implements execute() today. */
export type ExecuteOptions = BkashExecuteOptions;

// --- Refund Options ---

export interface BaseRefundOptions {
  gateway: GatewayName;
  transactionId: string;
  amount?: number;
  reason?: string;
  extra?: Record<string, any>;
}

export interface StripeRefundOptions extends BaseRefundOptions {
  gateway: "stripe";
  apiKey?: string;
  timeoutMs?: number;
  /** Forwarded to Stripe as an idempotency key. */
  idempotencyKey?: string;
}

export interface SSLCommerzRefundOptions extends BaseRefundOptions {
  gateway: "sslcommerz";
  storeId?: string;
  storePassword?: string;
  sandbox?: boolean;
  timeoutMs?: number;
  amount: number;
  refundRemarks?: string;
  refundRefId?: string;
}

export interface BkashRefundOptions extends BaseRefundOptions {
  gateway: "bkash";
  appKey?: string;
  appSecret?: string;
  username?: string;
  password?: string;
  sandbox?: boolean;
  timeoutMs?: number;
  /** The trxID returned by execute(). */
  trxID: string;
  amount: number;
  sku?: string;
}

export interface NagadRefundOptions extends BaseRefundOptions {
  gateway: "nagad";
  merchantId?: string;
  publicKey?: string;
  privateKey?: string;
  sandbox?: boolean;
  timeoutMs?: number;
  clientIp?: string;
  baseUrl?: string;
  amount: number;
  referenceId?: string;
}

export type RefundOptions =
  | StripeRefundOptions
  | SSLCommerzRefundOptions
  | BkashRefundOptions
  | NagadRefundOptions;

// --- Retrieve Options ---

export interface StripeRetrieveOptions {
  gateway: "stripe";
  transactionId: string;
  apiKey?: string;
  timeoutMs?: number;
  extra?: Record<string, any>;
}

export interface SSLCommerzRetrieveOptions {
  gateway: "sslcommerz";
  /** Required unless `valId` is given. */
  transactionId?: string;
  /** Validation ID from the success callback / IPN. Preferred. */
  valId?: string;
  storeId?: string;
  storePassword?: string;
  sandbox?: boolean;
  timeoutMs?: number;
  extra?: Record<string, any>;
}

export interface BkashRetrieveOptions {
  gateway: "bkash";
  transactionId: string;
  appKey?: string;
  appSecret?: string;
  username?: string;
  password?: string;
  sandbox?: boolean;
  timeoutMs?: number;
  extra?: Record<string, any>;
}

export interface NagadRetrieveOptions {
  gateway: "nagad";
  transactionId: string;
  merchantId?: string;
  publicKey?: string;
  privateKey?: string;
  sandbox?: boolean;
  timeoutMs?: number;
  clientIp?: string;
  baseUrl?: string;
  extra?: Record<string, any>;
}

export type RetrieveOptions =
  | StripeRetrieveOptions
  | SSLCommerzRetrieveOptions
  | BkashRetrieveOptions
  | NagadRetrieveOptions;

// --- Response Types ---

export interface PaymentResult {
  success: boolean;
  transactionId: string | null;
  status: string;
  amount: number;
  currency: string | null;
  gatewayResponse: any;
  /** SSLCommerz-specific: Gateway redirect URL */
  gatewayPageURL?: string;
  /** SSLCommerz-specific: Session key */
  sessionKey?: string;
  /** bKash-specific: bKash checkout URL */
  bkashURL?: string;
  /** bKash-specific: payment ID to pass to execute() */
  paymentID?: string;
  /** bKash-specific: transaction ID, present after execute() */
  trxID?: string | null;
  /** Nagad-specific: Callback URL */
  callBackUrl?: string | null;
  [key: string]: any;
}

export interface RefundResult {
  success: boolean;
  refundId: string | null;
  transactionId: string;
  status: string;
  amount: number | null;
  currency: string | null;
  gatewayResponse: any;
  [key: string]: any;
}

export interface RetrieveResult {
  success: boolean;
  /** Null when the gateway returns no identifier and none was supplied. */
  transactionId: string | null;
  status: string;
  amount: number;
  currency: string | null;
  gatewayResponse: any;
  [key: string]: any;
}

export interface GatewayCapabilities {
  charge: boolean;
  execute: boolean;
  refund: boolean;
  retrieve: boolean;
}

// --- Global Functions ---

/**
 * Create a charge/payment through any supported gateway.
 */
export function charge(options: ChargeOptions): Promise<PaymentResult>;

/**
 * Execute a payment (e.g. bKash tokenized checkout).
 *
 * @throws {PaymentError} With code "UNSUPPORTED_OPERATION" if the gateway has no execute().
 */
export function execute(options: ExecuteOptions): Promise<PaymentResult>;

/**
 * Refund a payment through any supported gateway.
 */
export function refund(options: RefundOptions): Promise<RefundResult>;

/**
 * Retrieve payment details from any supported gateway.
 */
export function retrieve(options: RetrieveOptions): Promise<RetrieveResult>;

/**
 * Get the list of all supported gateway names.
 */
export function getSupportedGateways(): GatewayName[];

/**
 * Report which operations a gateway implements.
 */
export function getGatewayCapabilities(
  name: GatewayName | string
): Promise<GatewayCapabilities>;

// --- Webhooks ---

/**
 * Verify the `verify_sign` on an SSLCommerz IPN / success callback payload.
 *
 * Not a substitute for `retrieve({ gateway: 'sslcommerz', valId })` — use that
 * as the source of truth for payment status.
 */
export function verifySslcommerzIpn(
  payload: Record<string, any>,
  options?: { storeId?: string; storePassword?: string; sandbox?: boolean }
): boolean;

export interface NagadCallback {
  orderId: string | null;
  paymentRefId: string | null;
  status: string | null;
  amount: number | null;
  /** Always false — Nagad callbacks are unsigned. Confirm with retrieve(). */
  verified: false;
  raw: Record<string, any>;
}

/**
 * Parse a Nagad callback query string into a normalized shape.
 * Always confirm the result with `retrieve()` before treating an order as paid.
 */
export function parseNagadCallback(
  query: Record<string, any> | URLSearchParams | string
): NagadCallback;

// --- Error Classes ---

export type PaymentErrorCode =
  | "CHARGE_FAILED"
  | "EXECUTE_FAILED"
  | "REFUND_FAILED"
  | "RETRIEVE_FAILED"
  | "AUTH_FAILED"
  | "API_FAILED"
  | "GATEWAY_NOT_FOUND"
  | "MISSING_CREDENTIALS"
  | "MISSING_DEPENDENCY"
  | "INVALID_CONFIG"
  | "INVALID_REQUEST"
  | "INVALID_AMOUNT"
  | "UNSUPPORTED_OPERATION"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | (string & {});

export class PaymentError extends Error {
  gateway: string;
  code: PaymentErrorCode;
  originalError: any;
  /** HTTP status code, when the error came from an HTTP response. */
  status: number | null;
  constructor(
    message: string,
    gateway: string,
    code: string,
    originalError?: any
  );
}

export class GatewayNotFoundError extends PaymentError {
  supportedGateways: string[];
  constructor(gatewayName: string, supportedGateways?: string[]);
}

export class ConfigurationError extends PaymentError {
  missingKeys: string[];
  constructor(gateway: string, missingKeys: string[]);
}
