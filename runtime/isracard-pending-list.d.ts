import type { Page } from "puppeteer";
import type { Transaction } from "../src/transactions";
export interface PendingTransaction extends Transaction {
  accountLast4: string;
  needsReview?: boolean;
}
export interface PendingCoverage {
  source: string;
  status: string;
  coverage: string;
  cardCount?: number;
  failure?: string | null;
  [key: string]: unknown;
}
export interface PendingCollection { transactions: PendingTransaction[]; coverage: PendingCoverage; }
export function scrapeIsracardPendingList(page: Page, options?: {
  enabled?: boolean;
  transactionsUrl?: string;
  detailsReadyTimeoutMs?: number;
  listReadyTimeoutMs?: number;
  settleMs?: number;
}): Promise<PendingCollection>;
