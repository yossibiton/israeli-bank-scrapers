import { SCRAPERS } from '../definitions';
import { exportTransactions, extendAsyncTimeout, getTestsConfig, maybeTestCompanyAPI } from '../tests/tests-utils';
import { LoginResults } from './base-scraper-with-browser';
import VisaCalScraper, { getPendingCoverage } from './visa-cal';

const COMPANY_ID = 'visaCal'; // TODO this property should be hard-coded in the provider
const testsConfig = getTestsConfig();

describe('VisaCal legacy scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.visaCal).toBeDefined();
    expect(SCRAPERS.visaCal.loginFields).toContain('username');
    expect(SCRAPERS.visaCal.loginFields).toContain('password');
  });

  maybeTestCompanyAPI(COMPANY_ID, config => config.companyAPI.invalidPassword)(
    'should fail on invalid user/password"',
    async () => {
      const options = {
        ...testsConfig.options,
        companyId: COMPANY_ID,
      };

      const scraper = new VisaCalScraper(options);

      const result = await scraper.scrape({ username: '971sddksmsl', password: '3f3ssdkSD3d' });

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

    const scraper = new VisaCalScraper(options);
    const result = await scraper.scrape(testsConfig.credentials.visaCal);
    expect(result).toBeDefined();
    const error = `${result.errorType || ''} ${result.errorMessage || ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();
    // uncomment to test multiple accounts
    // expect(result?.accounts?.length).toEqual(2)
    exportTransactions(COMPANY_ID, result.accounts || []);
  });
});

describe('VisaCal pending response coverage', () => {
  test('accepts the observed pending schema and marks status 96 as partial', () => {
    expect(
      getPendingCoverage({
        statusCode: 1,
        result: { cardsList: [{ cardUniqueID: 'synthetic', authDetalisList: [{}] }] },
      }),
    ).toEqual({
      status: 'available',
      reason: 'response_ok',
      pendingCount: 1,
    });
    expect(getPendingCoverage({ statusCode: 96, result: { cardsList: [] } })).toEqual({
      status: 'partial',
      reason: 'response_status_96',
      pendingCount: 0,
    });
  });

  test('marks malformed and unexpected pending responses partial', () => {
    expect(getPendingCoverage({ statusCode: 96, result: { cardsList: [{ authDetalisList: null }] } })).toEqual({
      status: 'partial',
      reason: 'response_status_96',
    });
    expect(getPendingCoverage({ statusCode: 1, result: { cardsList: 'not-an-array' } })).toEqual({
      status: 'partial',
      reason: 'malformed_payload',
    });
    expect(getPendingCoverage({ statusCode: 4, result: { cardsList: [] } })).toEqual({
      status: 'partial',
      reason: 'unexpected_status',
    });
  });
});
