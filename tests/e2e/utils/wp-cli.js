const { execSync } = require( 'child_process' );

const PLUGIN_ROOT = __dirname + '/../../..';

/**
 * Runs a wp-cli command inside wp-env's tests-cli container.
 *
 * `wp-env run` wraps real output with its own "Starting.../Ran..." lines --
 * strip those out so callers get exactly what wp-cli itself printed.
 */
function wpCli( cmd ) {
	const raw = execSync( `npx wp-env run tests-cli -- wp ${ cmd }`, {
		encoding: 'utf8',
		cwd: PLUGIN_ROOT,
	} );
	return raw
		.split( '\n' )
		.filter( ( line ) => line.trim() && ! /^(ℹ|✔)/.test( line.trim() ) )
		.join( '\n' )
		.trim();
}

/** Same as wpCli, but returns null instead of throwing on a non-zero exit. */
function wpCliSafe( cmd ) {
	try {
		return wpCli( cmd );
	} catch ( e ) {
		return null;
	}
}

/**
 * Activates the plugin if it isn't already.
 *
 * wp-env's tests environment does not reliably keep the plugin active across
 * every `wp-env start` cycle (observed: dev site stayed active, tests site
 * came back inactive) -- every spec here depends on it being active.
 */
function ensurePluginActive( slug = 'beehiiv' ) {
	if ( wpCliSafe( `plugin is-active ${ slug }` ) === null ) {
		wpCli( `plugin activate ${ slug }` );
	}
}

/**
 * Ensures pretty permalinks are set.
 *
 * On "Plain" permalinks (permalink_structure empty -- the WP default, and
 * what a fresh/reinitialized wp-env tests DB comes back with), a bare
 * `/wp-json/...` request 301-redirects to add a trailing slash. Playwright's
 * API request context follows that redirect, but the final response can come
 * back with an empty body -- surfacing downstream as a confusing
 * "Unexpected end of JSON input" with no obvious connection to permalinks.
 * Observed after several `wp-env start` cycles reset the tests DB's options.
 */
function ensurePrettyPermalinks() {
	const structure = wpCliSafe( 'option get permalink_structure' );
	if ( ! structure ) {
		wpCli( "rewrite structure '/%postname%/'" );
		wpCli( 'rewrite flush --hard' );
	}
}

module.exports = { wpCli, wpCliSafe, ensurePluginActive, ensurePrettyPermalinks };
