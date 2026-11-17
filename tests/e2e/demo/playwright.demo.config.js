/**
 * Playwright config for the intake demo recordings (record-intake-demo skill).
 * Runs one demo script with video on, at a pace a person can follow.
 *
 * Env: DEMO_SPEC (the demo script's file name in this folder),
 * DEMO_OUT (output folder, default tests/e2e/test-results/demo/<name>, which
 * is gitignored and keeps the QA run's own results.json untouched),
 * WP_BASE_URL (tests environment URL).
 */
const path = require( 'path' );
const { defineConfig } = require( '@playwright/test' );

const spec = process.env.DEMO_SPEC;
const outDir =
	process.env.DEMO_OUT ||
	path.join(
		__dirname,
		'../test-results/demo',
		spec.replace( /\.demo\.js$/, '' )
	);

module.exports = defineConfig( {
	testDir: __dirname,
	testMatch: spec,
	outputDir: path.join( outDir, 'raw' ),
	timeout: 6 * 60 * 1000,
	expect: { timeout: 8 * 1000 },
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: [
		[ 'list' ],
		[ 'json', { outputFile: path.join( outDir, 'results.json' ) } ],
	],
	use: {
		baseURL: process.env.WP_BASE_URL || 'http://localhost:8891',
		viewport: { width: 1280, height: 720 },
		video: { mode: 'on', size: { width: 1280, height: 720 } },
		screenshot: 'off',
		trace: 'off',
		launchOptions: { slowMo: 120 },
	},
	projects: [ { name: 'chromium', use: { browserName: 'chromium' } } ],
} );
