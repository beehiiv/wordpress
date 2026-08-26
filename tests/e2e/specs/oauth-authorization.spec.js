const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin } = require( '../utils/auth' );
const { wpCli, wpCliSafe, ensurePluginActive } = require( '../utils/wp-cli' );

/**
 * PRD: requirements/03-authentication/1-oauth-flow/oauth-authorization.prd.md
 * (brownfield-mapped -- no PLAN/EXECUTION artifacts exist for this feature;
 * the real files below were located by direct code search, not a plan/
 * execution trail. Verified by reading: includes/OAuth/Authorization.php,
 * includes/OAuth/Pkce.php, includes/OAuth/ClientRegistrar.php,
 * includes/OAuth/Config.php, includes/OAuth/AdminActions.php,
 * includes/Connection/Manager.php (builds the nonced connect URL) and
 * includes/Admin/Views/connection.php (renders the "Connect to beehiiv"
 * button consumed here).)
 *
 * Authorization::get_authorize_url() is the unit under test:
 *   - if TokenStore::get_client_id() is already set, it skips
 *     ClientRegistrar::register() entirely and builds the authorize URL
 *     locally (no network call) -- so AC-001/002/004 are testable by
 *     seeding a client_id via TokenStore::save_client_id() (the same real
 *     storage path a genuine registration would use) and driving the real
 *     "Connect to beehiiv" button.
 *   - if no client_id exists, it calls ClientRegistrar::register(), which
 *     in this environment always fails with 'beehiiv_registration_token_missing'
 *     because BEEHIIV_REGISTRATION_TOKEN is an unreplaced build placeholder
 *     (Config::has_registration_token() is false) -- this is a real,
 *     deterministic, reachable code path here, not a gap. AC-003 exercises
 *     that path directly rather than a real network round-trip, since no
 *     real beehiiv registration credentials exist in this environment.
 *
 * The external authorize navigation (https://app.beehiiv.com/oauth/authorize)
 * is intercepted and aborted via page.route() before any real network call
 * is dispatched -- this both keeps the test hermetic (no outbound call to
 * beehiiv) and lets the test inspect the exact redirect URL WordPress built,
 * which is what AC-001/AC-002 are actually asserting.
 *
 * PKCE verifier/state transients are stored per-user
 * (beehiiv_oauth_verifier_{user_id} / beehiiv_oauth_state_{user_id}), plain
 * WordPress transients backed by wp_options in this environment (no
 * object-cache.php drop-in present) -- AC-004 fast-forwards past the real
 * 600s TTL by rewriting the stored `_transient_timeout_*` option directly,
 * rather than sleeping 10 real minutes in a test.
 */

const SETTINGS_PATH = '/wp-admin/admin.php?page=beehiiv';
const SETTINGS_URL_RE = /\/wp-admin\/admin\.php\?page=beehiiv/;
const OAUTH_OPTION = 'beehiiv_oauth';
const CLIENT_ID = 'qa-e2e-oauth-authz-client';
const STATE_PREFIX = 'beehiiv_oauth_state_';
const VERIFIER_PREFIX = 'beehiiv_oauth_verifier_';

let adminUserId;

/** Removes any stored OAuth connection/client registration. */
function clearConnection() {
	wpCliSafe( `eval '\\Beehiiv\\OAuth\\TokenStore::delete_all();'` );
}

/**
 * Seeds only a client_id (no access token) through the plugin's real
 * storage path -- TokenStore::save_client_id() is exactly what
 * ClientRegistrar::register() calls on a real successful registration, so
 * this reproduces "already registered" state without a network call.
 */
function seedClientId() {
	wpCli( `eval '\\Beehiiv\\OAuth\\TokenStore::save_client_id( "${ CLIENT_ID }" );'` );
}

/** Deletes the PKCE verifier and CSRF state transients for one user. */
function clearAuthTransients( userId ) {
	wpCliSafe( `option delete _transient_${ VERIFIER_PREFIX }${ userId }` );
	wpCliSafe( `option delete _transient_timeout_${ VERIFIER_PREFIX }${ userId }` );
	wpCliSafe( `option delete _transient_${ STATE_PREFIX }${ userId }` );
	wpCliSafe( `option delete _transient_timeout_${ STATE_PREFIX }${ userId }` );
}

/**
 * Clicks "Connect to beehiiv" and captures the intercepted redirect request
 * to the external authorize endpoint, aborting it before any real network
 * call reaches beehiiv.
 *
 * @param {import('@playwright/test').Page} page
 * @return {Promise<URL>} The parsed authorize URL WordPress redirected to.
 */
async function clickConnectAndCaptureAuthorizeUrl( page ) {
	await page.route( '**/oauth/authorize**', ( route ) => route.abort() );

	const [ request ] = await Promise.all( [
		page.waitForRequest( ( req ) => req.url().includes( '/oauth/authorize' ) ),
		page.getByRole( 'link', { name: 'Connect to beehiiv' } ).click(),
	] );

	return new URL( request.url() );
}

test.beforeAll( () => {
	ensurePluginActive();
	adminUserId = wpCli( 'user get admin --field=ID' ).trim();

	// Known clean baseline for every test in this file. This is wp-env's
	// dedicated *tests* environment (never dev/production), so there is no
	// real state worth preserving -- the only contract other agents' specs
	// need from this file is "leave beehiiv_oauth and any oauth transients
	// absent", not "restore whatever was here before".
	clearConnection();
	clearAuthTransients( adminUserId );
} );

test.afterAll( () => {
	clearConnection();
	clearAuthTransients( adminUserId );
} );

test.describe( 'OAuth Authorization Initiation', () => {
	test.beforeEach( async ( { page } ) => {
		await loginAsAdmin( page );
	} );

	test( 'AC-001: admin can trigger an authorization flow that generates a beehiiv login URL', async ( { page } ) => {
		clearConnection();
		seedClientId();

		await page.goto( SETTINGS_PATH );
		const authorizeUrl = await clickConnectAndCaptureAuthorizeUrl( page );

		expect( authorizeUrl.origin + authorizeUrl.pathname ).toBe( 'https://app.beehiiv.com/oauth/authorize' );
		expect( authorizeUrl.searchParams.get( 'client_id' ) ).toBe( CLIENT_ID );
		expect( authorizeUrl.searchParams.get( 'response_type' ) ).toBe( 'code' );
		expect( authorizeUrl.searchParams.get( 'redirect_uri' ) ).toContain( 'page=beehiiv-oauth-callback' );

		clearConnection();
		clearAuthTransients( adminUserId );
	} );

	test( 'AC-002: the generated URL includes PKCE challenge and CSRF state token for security', async ( { page } ) => {
		clearConnection();
		seedClientId();

		await page.goto( SETTINGS_PATH );
		const authorizeUrl = await clickConnectAndCaptureAuthorizeUrl( page );

		const state = authorizeUrl.searchParams.get( 'state' );
		const challenge = authorizeUrl.searchParams.get( 'code_challenge' );
		const method = authorizeUrl.searchParams.get( 'code_challenge_method' );

		// BR-002: CSRF state is a random 32-character string.
		// wp_generate_password( 32, false, false ) -> alphanumeric only.
		expect( state ).toMatch( /^[A-Za-z0-9]{32}$/ );

		// BR-001: PKCE code verifier/challenge are 43-char base64url (RFC 7636
		// S256: base64url( sha256( verifier ) ), padding stripped).
		expect( challenge ).toMatch( /^[A-Za-z0-9_-]{43}$/ );
		expect( method ).toBe( 'S256' );

		// BR-003: scopes cover identify, publications, and posts.
		expect( authorizeUrl.searchParams.get( 'scope' ) ).toBe(
			'identify:read publications:read posts:read posts:write'
		);

		// Cross-check the state param actually matches what Authorization
		// persisted server-side (not just a client-visible value) -- this is
		// the same value the callback handler will validate against later.
		const storedState = wpCli( `option get _transient_${ STATE_PREFIX }${ adminUserId }` );
		expect( storedState.trim() ).toBe( state );

		clearConnection();
		clearAuthTransients( adminUserId );
	} );

	test( 'AC-003: the system automatically registers the site as an OAuth client if one does not exist', async ( { page } ) => {
		clearConnection(); // No client_id -> get_authorize_url() must attempt registration.

		await page.goto( SETTINGS_PATH );
		await page.getByRole( 'link', { name: 'Connect to beehiiv' } ).click();
		await page.waitForURL( SETTINGS_URL_RE );

		// This exact message is only emitted from ClientRegistrar::register()'s
		// has_registration_token() branch, which only executes when
		// get_authorize_url() found no existing client_id -- reaching it proves
		// automatic registration was attempted, not skipped. A real successful
		// registration round-trip cannot be exercised here: this environment's
		// BEEHIIV_REGISTRATION_TOKEN is an unreplaced build placeholder.
		await expect( page.locator( '.notice-error' ) ).toContainText( /not configured for this plugin build/i );

		const clientIdAfter = wpCli( `eval 'echo \\Beehiiv\\OAuth\\TokenStore::get_client_id();'` );
		expect( clientIdAfter.trim() ).toBe( '' );
	} );

	test( 'AC-004: authorization session data expires after 10 minutes to prevent replay attacks', async ( { page } ) => {
		clearConnection();
		seedClientId();

		await page.goto( SETTINGS_PATH );
		const authorizeUrl = await clickConnectAndCaptureAuthorizeUrl( page );
		const state = authorizeUrl.searchParams.get( 'state' );

		// BR-004 / Config::PKCE_TRANSIENT_TTL: session transients are created
		// with a 600-second TTL.
		const timeoutOption = wpCli( `option get _transient_timeout_${ STATE_PREFIX }${ adminUserId }` );
		const secondsRemaining = parseInt( timeoutOption.trim(), 10 ) - Math.floor( Date.now() / 1000 );
		expect( secondsRemaining ).toBeGreaterThan( 590 );
		expect( secondsRemaining ).toBeLessThanOrEqual( 600 );

		// Sanity check: the freshly-issued state is still valid right now.
		// Authorization::validate_state() keys off get_current_user_id(), so
		// this must run as the same admin user the browser session used to
		// generate it -- plain `wp eval` runs as user 0 by default, which
		// would silently check the wrong transient key
		// (beehiiv_oauth_state_0, never created) and always report invalid
		// regardless of real expiry behavior.
		const validNow = wpCli(
			`eval --user=admin 'echo \\Beehiiv\\OAuth\\Authorization::validate_state( "${ state }" ) ? "yes" : "no";'`
		);
		expect( validNow.trim() ).toBe( 'yes' );

		// Fast-forward past expiry by rewriting the stored timeout into the
		// past -- equivalent to 10+ real minutes elapsing -- rather than
		// sleeping in the test. WordPress transients (DB-backed here, no
		// object-cache.php present) self-expire once now() passes this value.
		wpCli(
			`option update _transient_timeout_${ STATE_PREFIX }${ adminUserId } ${ Math.floor( Date.now() / 1000 ) - 5 }`
		);

		const validAfterExpiry = wpCli(
			`eval --user=admin 'echo \\Beehiiv\\OAuth\\Authorization::validate_state( "${ state }" ) ? "yes" : "no";'`
		);
		expect( validAfterExpiry.trim() ).toBe( 'no' );

		clearConnection();
		clearAuthTransients( adminUserId );
	} );

	test( 'AC-005: OAuth base URL can be overridden via wp-config.php for local and staging environments', async () => {
		// Config::get_oauth_base_url() reads the BEEHIIV_OAUTH_BASE_URL
		// constant via defined()/constant() at call time -- defining it earlier
		// in the same PHP process (as `wp eval` does here) exercises the exact
		// same resolution code wp-config.php would trigger, without touching
		// the shared environment's actual wp-config.php or requiring a
		// wp-env restart that could affect other agents' concurrent specs.
		// The defined constant does not persist beyond this single `wp eval`
		// process, so no cleanup is needed.
		const overrideHost = 'oauth.staging.example.test';
		const result = wpCli(
			`eval 'define( "BEEHIIV_OAUTH_BASE_URL", "https://${ overrideHost }" ); echo \\Beehiiv\\OAuth\\Config::get_oauth_base_url() . "|" . implode( ",", \\Beehiiv\\OAuth\\Config::get_oauth_redirect_hosts() );'`
		);
		const [ overriddenBaseUrl, hosts ] = result.trim().split( '|' );

		expect( overriddenBaseUrl ).toBe( `https://${ overrideHost }` );
		expect( hosts.split( ',' ) ).toContain( overrideHost );

		// Unset (default/production) behavior, proving the override is
		// opt-in rather than baked into the default resolution.
		const defaultResult = wpCli( `eval 'echo \\Beehiiv\\OAuth\\Config::get_oauth_base_url();'` );
		expect( defaultResult.trim() ).toBe( 'https://app.beehiiv.com' );
	} );
} );
