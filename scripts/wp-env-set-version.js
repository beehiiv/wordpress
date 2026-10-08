#!/usr/bin/env node
/* eslint-disable no-console -- CLI script, console is its output. */
/**
 * Point wp-env at a specific PHP / WordPress core version, for backward-compatibility testing.
 *
 * Writes `phpVersion` / `core` into `.wp-env.override.json`, which wp-env deep-merges
 * over `.wp-env.json` natively. That file is gitignored, so this never touches tracked
 * config, and wp-env rebuilds the affected containers automatically the next time
 * `wp-env start` runs, because it detects that the resolved config changed.
 *
 * Usage:
 *   node scripts/wp-env-set-version.js --php=8.1 --wp=6.8
 *   node scripts/wp-env-set-version.js --php=8.3            # PHP only, leave WP core as-is
 *   node scripts/wp-env-set-version.js --wp=nightly         # WordPress/WordPress#master
 *   node scripts/wp-env-set-version.js --wp=latest          # wp-env default (newest stable)
 *   node scripts/wp-env-set-version.js --clear              # remove both overrides
 *
 * Then apply with: npm run env:start
 *
 * Add --destroy to also run `wp-env destroy` right away (e.g.
 * `--php=8.1 --wp=6.8 --destroy`). wp-env only refreshes the WordPress core
 * files when the version changes, not the database, so a stale database
 * can trigger the "database needs to be updated" screen or skew test
 * results after switching versions -- --destroy avoids that by starting
 * the next `wp-env start` from a clean install. THIS DELETES YOUR CURRENT
 * WP-ENV DATABASE AND CONTENT for this project; omit it to keep them.
 */

const fs = require( 'fs' );
const path = require( 'path' );
const { execFileSync } = require( 'child_process' );

const PLUGIN_ROOT = path.join( __dirname, '..' );
const overridePath = path.join( PLUGIN_ROOT, '.wp-env.override.json' );

function parseArgs( argv ) {
	const args = {};
	for ( const arg of argv ) {
		const match = arg.match( /^--([a-z]+)(?:=(.*))?$/ );
		if ( match ) {
			args[ match[ 1 ] ] = match[ 2 ] ?? true;
		}
	}
	return args;
}

// Maps a WP core version string to the wp-env `core` value that pins it.
function resolveCore( wpVersion ) {
	if ( ! wpVersion || wpVersion === 'latest' ) {
		return undefined; // Fall back to wp-env's own default (newest stable).
	}
	if ( wpVersion === 'nightly' || wpVersion === 'trunk' ) {
		return 'WordPress/WordPress#master';
	}
	return `https://wordpress.org/wordpress-${ wpVersion }.zip`;
}

function readOverride() {
	if ( ! fs.existsSync( overridePath ) ) {
		return {};
	}
	return JSON.parse( fs.readFileSync( overridePath, 'utf8' ) );
}

function writeOverride( config ) {
	fs.writeFileSync(
		overridePath,
		`${ JSON.stringify( config, null, '\t' ) }\n`
	);
}

function destroyEnv() {
	console.log(
		'Destroying wp-env (database and content for this project will be lost)...'
	);
	try {
		execFileSync( 'npx', [ 'wp-env', 'destroy', '--force' ], {
			stdio: 'inherit',
			cwd: PLUGIN_ROOT,
		} );
	} catch {
		// Nothing to destroy on a first run; a later `wp-env start` still works fine.
	}
}

const args = parseArgs( process.argv.slice( 2 ) );
const override = readOverride();

if ( args.clear ) {
	delete override.phpVersion;
	delete override.core;
	writeOverride( override );
	console.log(
		'Cleared phpVersion/core overrides from .wp-env.override.json.'
	);
	if ( args.destroy ) {
		destroyEnv();
	}
	process.exit( 0 );
}

if ( ! args.php && ! args.wp ) {
	console.error(
		'Usage: node scripts/wp-env-set-version.js --php=<version> --wp=<version|latest|nightly> [--destroy]\n' +
			'       node scripts/wp-env-set-version.js --clear [--destroy]'
	);
	process.exit( 1 );
}

if ( args.php ) {
	override.phpVersion = args.php;
}

if ( args.wp ) {
	const core = resolveCore( args.wp );
	if ( core === undefined ) {
		delete override.core;
	} else {
		override.core = core;
	}
}

writeOverride( override );

console.log(
	`Updated .wp-env.override.json — phpVersion: ${
		override.phpVersion ?? '(default)'
	}, core: ${ override.core ?? '(latest stable)' }`
);

if ( args.destroy ) {
	destroyEnv();
}

console.log(
	'Run `npm run env:start` to apply (wp-env rebuilds automatically).'
);
