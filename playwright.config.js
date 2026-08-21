const { defineConfig } = require( '@playwright/test' );

/**
 * Runs against wp-env's dedicated tests environment (testsEnvironment: true
 * in .wp-env.json), never the dev environment, so E2E runs never touch real
 * dev data. Default port matches wp-env's own tests-environment default.
 */
const baseURL = process.env.WP_BASE_URL || 'http://localhost:8889';

module.exports = defineConfig( {
	testDir: './tests/e2e/specs',
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
