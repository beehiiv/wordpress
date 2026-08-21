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
	// fullyParallel: false only serializes tests *within* a file -- separate
	// spec files still default to running in separate parallel workers.
	// Every spec here writes real data (posts, users, plugin state) into the
	// one shared wp-env tests environment, so cross-file concurrency corrupts
	// state the same way parallel qa-e2e-author runs would -- force a single
	// worker so every spec file runs strictly one at a time too.
	fullyParallel: false,
	workers: 1,
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
