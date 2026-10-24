export const HAPOALIM_TRANSACTION_ROW_LIMIT = 1000;

export interface HapoalimCollectionCoverage {
  status: 'available' | 'partial';
  returnedCount: number;
  reason?: 'row_limit_reached';
  rowLimit?: number;
}

export interface HapoalimTransactionCollection<T> {
  transactions: T[];
  collectionCoverage: HapoalimCollectionCoverage;
}

export function validateTransactionCollection<T = unknown>(response: unknown): HapoalimTransactionCollection<T> {
  if (
    !response ||
    typeof response !== 'object' ||
    !Array.isArray((response as { transactions?: unknown }).transactions)
  ) {
    throw new Error('Hapoalim returned a malformed transaction collection');
  }

  const transactions = (response as { transactions: T[] }).transactions;
  const collectionCoverage: HapoalimCollectionCoverage =
    transactions.length >= HAPOALIM_TRANSACTION_ROW_LIMIT
      ? {
          status: 'partial',
          reason: 'row_limit_reached',
          rowLimit: HAPOALIM_TRANSACTION_ROW_LIMIT,
          returnedCount: transactions.length,
        }
      : { status: 'available', returnedCount: transactions.length };

  return { transactions, collectionCoverage };
}
