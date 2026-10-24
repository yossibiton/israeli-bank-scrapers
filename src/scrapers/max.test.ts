import moment from 'moment';
import MaxScraper, { fetchMonthlyCollections, getMemo, getMonthlyTransactions } from './max';
import { maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig, exportTransactions } from '../tests/tests-utils';
import { SCRAPERS } from '../definitions';
import { LoginResults } from './base-scraper-with-browser';

const COMPANY_ID = 'max'; // TODO this property should be hard-coded in the provider
const testsConfig = getTestsConfig();

describe('Max scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.max).toBeDefined();
    expect(SCRAPERS.max.loginFields).toContain('username');
    expect(SCRAPERS.max.loginFields).toContain('password');
  });

  maybeTestCompanyAPI(COMPANY_ID, config => config.companyAPI.invalidPassword)(
    'should fail on invalid user/password"',
    async () => {
      const options = {
        ...testsConfig.options,
        companyId: COMPANY_ID,
      };

      const scraper = new MaxScraper(options);

      const result = await scraper.scrape({ username: 'e10s12', password: '3f3ss3d' });

      expect(result).toBeDefined();
      expect(result.success).toBeFalsy();
      expect(result.errorType).toBe(LoginResults.InvalidPassword);
    },
  );

  maybeTestCompanyAPI(COMPANY_ID)('should scrape transactions"', async () => {
    const options = {
      ...testsConfig.options,
      companyId: COMPANY_ID,
    };

    const scraper = new MaxScraper(options);
    const result = await scraper.scrape(testsConfig.credentials.max);
    expect(result).toBeDefined();
    const error = `${result.errorType || ''} ${result.errorMessage || ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();

    exportTransactions(COMPANY_ID, result.accounts || []);
  });
});

describe('getMemo', () => {
  type TransactionForMemoTest = Parameters<typeof getMemo>[0];
  test.each<[TransactionForMemoTest, string]>([
    [{ comments: '' }, ''],
    [{ comments: 'comment without funds' }, 'comment without funds'],
    [{ comments: '', fundsTransferReceiverOrTransfer: 'Daniel H' }, 'Daniel H'],
    [{ comments: '', fundsTransferReceiverOrTransfer: 'Daniel', fundsTransferComment: 'Foo bar' }, 'Daniel: Foo bar'],
  ])('%o should create memo: %s', (transaction, expected) => {
    const memo = getMemo(transaction);
    expect(memo).toBe(expected);
  });
});

describe('MAX monthly transaction collection validation', () => {
  test('accepts a valid empty month and rejects malformed or failed responses', () => {
    expect(getMonthlyTransactions({ result: { statusCode: 1, transactions: [] } })).toEqual([]);
    expect(() => getMonthlyTransactions(null)).toThrow('missing result');
    expect(() => getMonthlyTransactions({ result: { statusCode: 3, transactions: [] } })).toThrow('request failed');
    expect(() => getMonthlyTransactions({ result: {} })).toThrow('missing transactions array');
  });

  test('preserves available months and reports unavailable months as partial coverage', async () => {
    const months = [moment('2026-10-01'), moment('2026-11-01')];
    const result = await fetchMonthlyCollections(months, month => {
      if (month.month() === 9) return Promise.reject(new Error('synthetic unavailable month'));
      return Promise.resolve({ 'card-1': [] });
    });
    expect(result.allResults).toEqual({ 'card-1': [] });
    expect(result.collectionCoverage).toEqual({
      status: 'partial',
      reason: 'monthly_response_unavailable',
      requestedMonths: ['2026-10', '2026-11'],
      availableMonths: ['2026-11'],
      unavailableMonths: ['2026-10'],
    });
  });

  test('fails when every requested month is unavailable', async () => {
    await expect(
      fetchMonthlyCollections([moment('2026-10-01')], () => Promise.reject(new Error('synthetic unavailable month'))),
    ).rejects.toThrow('collections unavailable');
  });
});
