# Scoped provider reliability fork

This branch retains upstream source history and changes only American Express, Isracard, MAX, CAL and Hapoalim behavior needed by the local consumer.

- Shared Isracard/Amex authentication accepts documented numeric/string responses and empty provider usernames. Unknown rejection responses stay unknown; raw authentication responses are never logged.
- Optional pending collection follows observed authenticated provider routes. It enumerates cards, waits for stable card state, bounds the pending section separately from posted purchases, checks visible counts and retains unknown/partial coverage explicitly.
- MAX preserves valid posted results when a later month is unavailable. CAL and Hapoalim expose collection coverage instead of silently claiming completeness.
- Pending records without reliable source identifiers remain explicitly marked; downstream identity reconciliation must retain source evidence and ambiguous occurrences.

The hand-written runtime helpers are shipped alongside compiled TypeScript. They contain no credentials or financial samples. Enable experimental pending collection explicitly; it is not an unattended-service guarantee.

Validation: type checking, ESLint/Prettier, synthetic provider Jest tests with live integrations disabled, and `npm run test:runtime`. Live credentials must never enter fixtures. Do not run upstream reset/prepare scripts on a checkout containing local changes.
