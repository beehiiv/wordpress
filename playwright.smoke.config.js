const base = require( './playwright.config.js' );

/**
 * Post-launch smoke suite (tests/e2e/smoke), the automated equivalent of the
 * manual QA sheet "beehiiv v1.1.0 | Post-launch Manual Smoke Tests". Same wp-env tests environment and
 * single-worker rules as the main E2E config; kept separate so `npm run
 * test:e2e` does not run it. Run with `npm run test:smoke`.
 */
module.exports = {
	...base,
	testDir: './tests/e2e/smoke',
	outputDir: './tests/e2e/test-results/smoke',
	reporter: [
		[ 'list' ],
		[ 'json', { outputFile: 'tests/e2e/test-results/smoke-results.json' } ],
	],
};
