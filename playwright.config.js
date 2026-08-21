const { defineConfig } = require( '@playwright/test' );

/**
 * Runs against wp-env's dedicated tests environment (testsEnvironment: true
 * in .wp-env.json), never the dev environment, so E2E runs never touch real
 * dev data. Port matches the explicit env.tests.port set in .wp-env.json
 * (chosen to avoid colliding with other wp-env projects on this machine —
 * the wp-env default of 8889 was already taken locally).
 */
const baseURL = process.env.WP_BASE_URL || 'http://localhost:8891';

module.exports = defineConfig( {
	testDir: './tests/e2e/specs',
	outputDir: './tests/e2e/test-results',
	timeout: 30 * 1000,
	expect: {
		timeout: 5 * 1000,
	},
	fullyParallel: false,
	retries: process.env.CI ? 1 : 0,
	reporter: [
		[ 'list' ],
		[ 'json', { outputFile: 'tests/e2e/test-results/results.json' } ],
	],
	use: {
		baseURL,
		screenshot: 'only-on-failure',
		trace: 'retain-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			use: { browserName: 'chromium' },
		},
	],
} );
