export type UserRole = "BIDDER" | "AUCTIONEER";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  public_code: string;
  masked_name: string;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface Wallet {
  id: string;
  user_id: string;
  total_balance_cents: number;
  committed_balance_cents: number;
  available_balance_cents: number;
}

export type TransactionType =
  | "DEPOSIT"
  | "BID_HOLD"
  | "BID_RELEASE"
  | "SETTLEMENT_DEBIT"
  | "SETTLEMENT_CREDIT"
  | "CANCEL_REFUND";

export interface WalletTransaction {
  id: string;
  wallet_id: string;
  user_id: string;
  lot_id: string | null;
  type: TransactionType;
  amount_cents: number;
  balance_after_cents: number;
  committed_after_cents: number;
  description: string;
  created_at: string;
}

export interface CatalogItem {
  external_id: string;
  title: string;
  artist: string;
  date_display: string;
  medium_display: string;
  image_url: string;
  attributes: Record<string, unknown>;
  source: "artic" | "local_fallback" | string;
}

export interface Bid {
  id: string;
  lot_id: string;
  user_id: string;
  bidder_masked_name: string;
  sequence_number: number;
  amount_cents: number;
  previous_hash: string;
  current_hash: string;
  extension_triggered: boolean;
  created_at: string;
}

export interface CertificateSummary {
  id: string;
  receipt_code: string;
  lot_id: string;
  winner_user_id: string;
  winner_masked_name: string;
  auctioneer_user_id: string;
  final_amount_cents: number;
  final_bid_hash: string;
  receipt_signature: string;
  settled_at: string;
  settled_at_iso: string;
}

export type LotStatus = "SCHEDULED" | "LIVE" | "ENDED" | "CANCELLED";

export interface Lot {
  id: string;
  lot_number: number;
  auctioneer_id: string;
  external_artwork_id: string;
  title: string;
  artist: string;
  date_display: string;
  medium_display: string;
  image_url: string;
  attributes_json: Record<string, unknown>;
  starting_bid_cents: number;
  min_increment_cents: number;
  current_bid_cents: number | null;
  leader_user_id: string | null;
  leader_masked_name: string | null;
  start_time: string;
  end_time: string;
  original_end_time: string;
  extension_count: number;
  status: LotStatus;
  bid_count: number;
  head_hash: string;
  cancelled_at: string | null;
  settled_at: string | null;
  created_at: string;
  certificate: CertificateSummary | null;
  bids: Bid[];
}

export interface LotCreatePayload {
  external_artwork_id: string;
  title: string;
  artist: string;
  date_display: string;
  medium_display: string;
  image_url: string;
  attributes_json: Record<string, unknown>;
  starting_bid_cents: number;
  min_increment_cents: number;
  start_time: string;
  end_time: string;
}

export interface PublicReceipt {
  receipt_code: string;
  lot_id: string;
  lot_number: number;
  title: string;
  artist: string;
  date_display: string;
  medium_display: string;
  image_url: string;
  attributes_json: Record<string, unknown>;
  winner_masked_name: string;
  final_amount_cents: number;
  final_bid_hash: string;
  receipt_signature: string;
  settled_at: string;
  settled_at_iso: string;
  is_signature_valid: boolean;
}

export interface ParticipatedLotItem {
  lot: Lot;
  my_highest_bid_cents: number;
  user_bid_status: "WINNING" | "OUTBID" | "WON" | "CANCELLED" | string;
}

export interface BidderBidsAndWins {
  participated_lots: ParticipatedLotItem[];
  won_lots: Lot[];
}

export interface AuctioneerDashboard {
  total_revenue_cents: number;
  settled_with_winner_count: number;
  active_lots_count: number;
  lots: Lot[];
}

export interface AuditNode {
  sequence_number: number;
  bid_id: string;
  bidder_masked_name: string;
  amount_cents: number;
  created_at_iso: string;
  previous_hash: string;
  expected_previous_hash: string;
  stored_hash: string;
  recalculated_hash: string;
  is_valid: boolean;
}

export interface AuditChain {
  lot_id: string;
  lot_number: number;
  title: string;
  is_chain_valid: boolean;
  total_bids: number;
  head_hash: string;
  broken_at_sequence: number | null;
  anomalies: string[];
  nodes: AuditNode[];
}
