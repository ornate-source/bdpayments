// ============================================================================
// BDPayments — TypeScript Definitions
// ============================================================================

// --- Gateway Names ---

export type GatewayName =
  | "stripe"
  | "paypal"
  | "payoneer"
  | "sslcommerz"
  | "bkash"
  | "nagad";

// --- Per-Gateway Config Interfaces ---

export interface StripeConfig {
  apiKey: string;
}

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  sandbox?: boolean;
}

export interface PayoneerConfig {
  partnerId: string;
  username: string;
  apiPassword: string;
  sandbox?: boolean;
}

export interface SSLCommerzConfig {
  storeId: string;
  storePassword: string;
  sandbox?: boolean;
}

export interface BkashConfig {
  appKey: string;
  appSecret: string;
  username: string;
  password: string;
  sandbox?: boolean;
}

export interface NagadConfig {
  merchantId: string;
  publicKey: string;
  privateKey: string;
  sandbox?: boolean;
}

export interface GatewayConfigs {
  stripe?: StripeConfig;
  paypal?: PayPalConfig;
  payoneer?: PayoneerConfig;
  sslcommerz?: SSLCommerzConfig;
  bkash?: BkashConfig;
  nagad?: NagadConfig;
}

// --- Configure ---

/**
 * Set global credentials for one or more gateways.
 * Call this once at app startup.
 */
export function configure(configs: GatewayConfigs): void;

/**
 * Clear all stored global configuration.
 */
export function clearConfig(): void;

// --- Charge Options ---

export interface BaseChargeOptions {
  gateway: GatewayName;
  amount: number;
  currency?: string;
  description?: string;
  extra?: Record<string, any>;
  [key: string]: any;
}

export interface StripeChargeOptions extends BaseChargeOptions {
  gateway: "stripe";
  apiKey?: string;
  paymentMethod?: string;
  customer?: string;
  confirm?: boolean;
  returnUrl?: string;
  metadata?: Record<string, string>;
}

export interface PayPalChargeOptions extends BaseChargeOptions {
  gateway: "paypal";
  clientId?: string;
  clientSecret?: string;
  sandbox?: boolean;
  returnUrl?: string;
  cancelUrl?: string;
  capture?: boolean;
}

export interface PayoneerChargeOptions extends BaseChargeOptions {
  gateway: "payoneer";
  partnerId?: string;
  username?: string;
  apiPassword?: string;
  sandbox?: boolean;
  payeeId: string;
  clientReferenceId?: string;
}

export interface SSLCommerzChargeOptions extends BaseChargeOptions {
  gateway: "sslcommerz";
  storeId?: string;
  storePassword?: string;
  sandbox?: boolean;
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
  invoiceNumber: string;
  payerReference?: string;
  callbackURL?: string;
  intent?: "sale" | "authorization";
}

export interface NagadChargeOptions extends BaseChargeOptions {
  gateway: "nagad";
  merchantId?: string;
  publicKey?: string;
  privateKey?: string;
  sandbox?: boolean;
  orderId: string;
  callbackURL?: string;
  customerPhone?: string;
}

export type ChargeOptions =
  | StripeChargeOptions
  | PayPalChargeOptions
  | PayoneerChargeOptions
  | SSLCommerzChargeOptions
  | BkashChargeOptions
  | NagadChargeOptions;

// --- Refund Options ---

export interface BaseRefundOptions {
  gateway: GatewayName;
  transactionId: string;
  amount?: number;
  reason?: string;
  extra?: Record<string, any>;
  [key: string]: any;
}

export interface StripeRefundOptions extends BaseRefundOptions {
  gateway: "stripe";
  apiKey?: string;
}

export interface PayPalRefundOptions extends BaseRefundOptions {
  gateway: "paypal";
  clientId?: string;
  clientSecret?: string;
  sandbox?: boolean;
  currency?: string;
}

export interface PayoneerRefundOptions extends BaseRefundOptions {
  gateway: "payoneer";
  partnerId?: string;
  username?: string;
  apiPassword?: string;
  sandbox?: boolean;
}

export interface SSLCommerzRefundOptions extends BaseRefundOptions {
  gateway: "sslcommerz";
  storeId?: string;
  storePassword?: string;
  sandbox?: boolean;
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
  amount: number;
  referenceId?: string;
}

export type RefundOptions =
  | StripeRefundOptions
  | PayPalRefundOptions
  | PayoneerRefundOptions
  | SSLCommerzRefundOptions
  | BkashRefundOptions
  | NagadRefundOptions;

// --- Retrieve Options ---

export interface BaseRetrieveOptions {
  gateway: GatewayName;
  transactionId: string;
  extra?: Record<string, any>;
  [key: string]: any;
}

export type RetrieveOptions = BaseRetrieveOptions & {
  [key: string]: any;
};

// --- Response Types ---

export interface PaymentResult {
  success: boolean;
  transactionId: string | null;
  status: string;
  amount: number;
  currency: string | null;
  gatewayResponse: any;
  /** PayPal-specific: URL for customer approval */
  approvalUrl?: string;
  /** SSLCommerz-specific: Gateway redirect URL */
  gatewayPageURL?: string;
  /** bKash-specific: bKash checkout URL */
  bkashURL?: string;
  /** Nagad-specific: Callback URL */
  callBackUrl?: string;
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
  transactionId: string;
  status: string;
  amount: number;
  currency: string | null;
  gatewayResponse: any;
  [key: string]: any;
}

// --- Global Functions ---

/**
 * Create a charge/payment through any supported gateway.
 */
export function charge(options: ChargeOptions): Promise<PaymentResult>;

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

// --- Error Classes ---

export class PaymentError extends Error {
  gateway: string;
  code: string;
  originalError: any;
  constructor(
    message: string,
    gateway: string,
    code: string,
    originalError?: any
  );
}

export class GatewayNotFoundError extends PaymentError {
  constructor(gatewayName: string);
}

export class ConfigurationError extends PaymentError {
  missingKeys: string[];
  constructor(gateway: string, missingKeys: string[]);
}
