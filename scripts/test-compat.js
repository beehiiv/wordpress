#!/usr/bin/env node
/**
 * Runs PHPUnit against a specific PHP / WordPress core combination and
 * writes an HTML dashboard scoped to that combination, for
 * backward-compatibility testing.
 *
 * Usage:
 *   npm run test:compat -- --php=8.1 --wp=6.8
 *
 * Writes:
 *   tests/phpunit/test-results/php8.1-wp6.8/junit.xml
 *   tests/phpunit/test-results/php8.1-wp6.8/dashboard.html
 *
 * Runs `wp-env destroy` before starting, so each combination gets a genuinely
 * clean WordPress install rather than the new core version's files sitting on
 * top of a database from a previous version (which triggers the "database
 * needs to be updated" nag and can skew test results). THIS DELETES YOUR
 * CURRENT WP-ENV DATABASE AND CONTENT for this project -- only run this
 * against a wp-env instance you're fine wiping, not one with dev content you
 * want to keep. Plain `npm run env:set-version` + `npm run env:start` (for
 * manual browsing) does not destroy anything.
 *
 * Leaves the wp-env PHP/WP version set via scripts/wp-env-set-version.js so
 * a subsequent `npm run env:start` keeps using this combination; run
 * `npm run env:set-version -- --clear` to go back to the tracked default.
 */

const { execFileSync } = require( 'child_process' );
const path = require( 'path' );

const PLUGIN_ROOT = path.join( __dirname, '..' );

function parseArgs( argv ) {
	const args = {};
	for ( const arg of argv ) {
		const match = arg.match( /^--([a-z-]+)(?:=(.*))?$/ );
		if ( match ) {
			args[ match[ 1 ] ] = match[ 2 ] ?? true;
		}
	}
	return args;
}

const args = parseArgs( process.argv.slice( 2 ) );

if ( ! args.php || ! args.wp ) {
	console.error( 'Usage: npm run test:compat -- --php=<version> --wp=<version|latest|nightly>' );
	process.exit( 1 );
}

const slug = `php${ args.php }-wp${ args.wp }`;
const reportDir = `tests/phpunit/test-results/${ slug }`;
const junitPath = `${ reportDir }/junit.xml`;
const dashboardPath = `${ reportDir }/dashboard.html`;
const label = `PHP ${ args.php } / WP ${ args.wp }`;

function run( command, commandArgs ) {
	console.log( `$ ${ command } ${ commandArgs.join( ' ' ) }` );
	execFileSync( command, commandArgs, { stdio: 'inherit', cwd: PLUGIN_ROOT } );
}

run( 'node', [
	'scripts/wp-env-set-version.js',
	`--php=${ args.php }`,
	`--wp=${ args.wp }`,
	'--destroy',
] );
run( 'npx', [ 'wp-env', 'start' ] );

let exitCode = 0;
try {
	run( 'npx', [
		'wp-env',
		'run',
		'tests-cli',
		'--',
		'bash',
		'-c',
		`cd wp-content/plugins/beehiiv && mkdir -p ${ reportDir } && vendor/bin/phpunit -c phpunit.xml.dist --log-junit ${ junitPath }`,
	] );
} catch ( error ) {
	exitCode = 1;
}

try {
	run( 'node', [
		'tests/phpunit/report/generate-dashboard.js',
		`--junit=${ junitPath }`,
		`--out=${ dashboardPath }`,
		`--label=${ label }`,
	] );
} catch ( error ) {
	console.error( 'Could not generate dashboard (no JUnit report to read).' );
	exitCode = 1;
}

try {
	run( 'npx', [ 'wp-env', 'stop' ] );
} catch ( error ) {
	// Ignore stop failures; the run's own exit code already reflects the test outcome.
}

process.exit( exitCode );
