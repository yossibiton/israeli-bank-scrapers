import type { Page } from "puppeteer";
import type { ScraperScrapingResult } from "../src/scrapers/interface";
import type { PendingCollection, PendingCoverage, PendingTransaction } from "./isracard-pending-list";
export function scrapeIsracardPendingDashboard(page: Page, options?: { enabled?: boolean; dashboardUrl?: string }): Promise<PendingCollection>;
export function attachPendingTransactions(result: ScraperScrapingResult, transactions: PendingTransaction[], coverage: PendingCoverage): ScraperScrapingResult;
