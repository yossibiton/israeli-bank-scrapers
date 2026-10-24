export interface PendingRoutes { transactionsUrl: string | null; dashboardUrl: string | null; }
export function discoverPendingRoutes(input: { companyCode: string; baseUrl: string; currentUrl?: string; links?: string[] }): PendingRoutes | null;
