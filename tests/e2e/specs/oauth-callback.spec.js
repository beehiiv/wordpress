const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin, loginAs } = require( '../utils/auth' );
const { wpCli, wpCliSafe, ensurePluginActive } = require( '../utils/wp-cli' );

/**
 * PRD: requirements/03-authentication/1-oauth-flow/oauth-callback.prd.md
 * (brownfield-mapped -- no PLAN/EXECUTION artifacts exist for this feature;
 * the real files below were located by direct code search, not a plan/
 * execution trail. Verified by reading: includes/OAuth/CallbackHandler.php
 * (unit under test), includes/OAuth/Authorization.php (state/PKCE
 * validation, consumed here), includes/OAuth/HttpClient.php (token
 * exchange transport), includes/OAuth/TokenStore.php (credential storage),
 * includes/OAuth/AdminActions.php (renders the resulting admin notice),
 * includes/API/Client.php (the /users/identify call), includes/API/Cache.php.
 *
 * CallbackHandler::maybe_handle() runs on admin_init (priority 1) and only
 * engages when $_GET['page'] === Config::CALLBACK_PAGE
 * ('beehiiv-oauth-callback') -- a hidden submenu (add_submenu_page with a
 * null parent), reached at /wp-admin/admin.php?page=beehiiv-oauth-callback.
 *
 * A REAL state+PKCE verifier pair is required for most ACs here (the
 * handler validates against the live transient, not a value this spec can
 * fabricate) -- obtained by driving the real "Connect to beehiiv" button
 * (seeding a client_id first, same technique oauth-authorization.spec.js
 * uses) and capturing the state param from the intercepted redirect,
 * exactly as beehiiv itself would hand it back on a real callback.
 *
 * AC-001/AC-005/AC-006 (successful redirect, token storage, user identity)
 * require the full success path, which needs beehiiv's real /oauth/token
 * and /users/identify endpoints -- mocked via the test-only mu-plugin
 * seam's generic beehiiv_e2e_mock_http() (tests/e2e/plugins/beehiiv-options.php),
 * since this wp-env build has no real beehiiv account to complete a
 * genuine exchange against.
 */

const SETTINGS_PATH = '/wp-admin/admin.php?page=beehiiv';
const SETTINGS_URL_RE = /\/wp-admin\/admin\.php\?page=beehiiv(&|$)/;
const CALLBACK_PATH = '/wp-admin/admin.php?page=beehiiv-oauth-callback';
const CLIENT_ID = 'qa-e2e-oauth-callback-client';
const STATE_PREFIX = 'beehiiv_oauth_state_';
const VERIFIER_PREFIX = 'beehiiv_oauth_verifier_';

const NON_ADMIN_USERNAME = 'qa_e2e_oauth_callback_contributor';
const NON_ADMIN_PASSWORD = 'qa-e2e-password';

let adminUserId;

/** Removes any stored OAuth connection/client registration. */
function clearConnection() {
	wpCliSafe( `eval '\\Beehiiv\\OAuth\\TokenStore::delete_all();'` );
}

/** Seeds only a client_id, the same real storage path a successful registration would use. */
function seedClientId() {
	wpCli(
		`eval '\\Beehiiv\\OAuth\\TokenStore::save_client_id( "${ CLIENT_ID }" );'`
	);
}

/**
 * Deletes the PKCE verifier and CSRF state transients for one user.
 * @param {number|string} userId
 */
function clearAuthTransients( userId ) {
	wpCliSafe( `option delete _transient_${ VERIFIER_PREFIX }${ userId }` );
	wpCliSafe(
		`option delete _transient_timeout_${ VERIFIER_PREFIX }${ userId }`
	);
	wpCliSafe( `option delete _transient_${ STATE_PREFIX }${ userId }` );
	wpCliSafe(
		`option delete _transient_timeout_${ STATE_PREFIX }${ userId }`
	);
}

/**
 * Drives the real "Connect to beehiiv" button and captures the real `state`
 * WordPress issued, aborting the external navigation before any real
 * request reaches beehiiv (same technique as oauth-authorization.spec.js).
 *
 * @param {import('@playwright/test').Page} page
 * @return {Promise<string>} The real, server-validated state value.
 */
async function seedRealAuthorizationState( page ) {
	clearConnection();
	seedClientId();

	await page.route( '**/oauth/authorize**', ( route ) => route.abort() );
	await page.goto( SETTINGS_PATH );

	const [ request ] = await Promise.all( [
		page.waitForRequest( ( req ) =>
			req.url().includes( '/oauth/authorize' )
		),
		page.getByRole( 'link', { name: 'Connect to beehiiv' } ).click(),
	] );

	return new URL( request.url() ).searchParams.get( 'state' );
}

/**
 * Builds a callback URL with the given query params appended.
 * @param {Object} params
 */
function callbackUrl( params ) {
	return `${ CALLBACK_PATH }&${ new URLSearchParams( params ).toString() }`;
}

test.beforeAll( () => {
	ensurePluginActive();
	adminUserId = wpCli( 'user get admin --field=ID' ).trim();

	// Idempotent fixture user for the AC-007 permission-gate test.
	wpCliSafe(
		`user create ${ NON_ADMIN_USERNAME } ${ NON_ADMIN_USERNAME }@example.test ` +
			`--role=contributor --user_pass=${ NON_ADMIN_PASSWORD }`
	);

	// Known clean baseline for every test in this file. This is wp-env's
	// dedicated *tests* environment (never dev/production), so there is no
	// real state worth preserving here.
	clearConnection();
	clearAuthTransients( adminUserId );
	wpCliSafe( "eval 'beehiiv_e2e_reset_all();'" );
} );

test.afterAll( () => {
	clearConnection();
	clearAuthTransients( adminUserId );
	wpCliSafe( "eval 'beehiiv_e2e_reset_all();'" );
} );

test.describe( 'OAuth Callback & Token Exchange', () => {
	test.beforeEach( async ( { page } ) => {
		await loginAsAdmin( page );
	} );

	test( 'AC-002: invalid or missing authorization codes show an error message and prevent incomplete connections', async ( {
		page,
	} ) => {
		const state = await seedRealAuthorizationState( page );

		// No `code` param at all -- CallbackHandler::process() rejects on
		// `'' === $code` before even reaching Authorization::validate_state().
		await page.goto( callbackUrl( { state } ) );
		await page.waitForURL( SETTINGS_URL_RE );
		await expect( page.locator( '.notice-error' ) ).toContainText(
			/invalid beehiiv connection response/i
		);

		const connectedAfter = wpCli(
			'eval \'echo \\Beehiiv\\Connection\\Manager::is_connected() ? "yes" : "no";\''
		);
		expect( connectedAfter.trim() ).toBe( 'no' );

		clearAuthTransients( adminUserId );
	} );

	test( 'AC-004: CSRF state validation prevents authorization codes obtained through redirects to other sites from being accepted', async ( {
		page,
	} ) => {
		await seedRealAuthorizationState( page );

		// A tampered/foreign state value must be rejected even with a
		// well-formed `code` present. Note: this hits the exact same
		// "Invalid beehiiv connection response" message as AC-002 -- the
		// handler uses one combined branch for `'' === $code ||
		// !validate_state($state)`, not separate messages per failure mode.
		await page.goto(
			callbackUrl( {
				code: 'qa-e2e-fake-code',
				state: 'not-the-real-state-value-000000',
			} )
		);
		await page.waitForURL( SETTINGS_URL_RE );
		await expect( page.locator( '.notice-error' ) ).toContainText(
			/invalid beehiiv connection response/i
		);

		const connectedAfter = wpCli(
			'eval \'echo \\Beehiiv\\Connection\\Manager::is_connected() ? "yes" : "no";\''
		);
		expect( connectedAfter.trim() ).toBe( 'no' );

		clearAuthTransients( adminUserId );
	} );

	test( 'AC-003: expired authorization sessions (older than 10 minutes) display a clear error message', async ( {
		page,
	} ) => {
		const state = await seedRealAuthorizationState( page );

		// BR-002 / Authorization::get_authorize_url(): the state and PKCE
		// verifier transients are written with the SAME TTL and therefore
		// always expire together in practice -- since validate_state() (state
		// only) runs BEFORE consume_code_verifier() (verifier), a fully
		// elapsed 10-minute window would hit the generic "Invalid beehiiv
		// connection response" branch (AC-002/AC-004's message), never this
		// one. The "session expired" message is only reachable when the
		// verifier specifically is gone while state is still valid -- e.g.
		// this exact asymmetric loss, or a same-code replay after a first
		// successful exchange already consumed both (BR-002's single-use
		// guarantee). Reproduced precisely here rather than waiting out the
		// shared TTL, which would not exercise this code path at all.
		wpCliSafe(
			`option delete _transient_${ VERIFIER_PREFIX }${ adminUserId }`
		);
		wpCliSafe(
			`option delete _transient_timeout_${ VERIFIER_PREFIX }${ adminUserId }`
		);

		await page.goto( callbackUrl( { code: 'qa-e2e-fake-code', state } ) );
		await page.waitForURL( SETTINGS_URL_RE );
		await expect( page.locator( '.notice-error' ) ).toContainText(
			/connection session expired/i
		);

		clearAuthTransients( adminUserId );
	} );

	test( 'AC-001: after granting permission on beehiiv, the admin is redirected back to WordPress settings', async ( {
		page,
	} ) => {
		const state = await seedRealAuthorizationState( page );

		wpCli(
			'eval \'beehiiv_e2e_mock_http( "/oauth/token", [ "body" => [ "access_token" => "qa-e2e-ac1-access", "refresh_token" => "qa-e2e-ac1-refresh", "expires_in" => 3600 ] ] ); beehiiv_e2e_mock_http( "/users/identify", [ "body" => [] ] );\''
		);

		await page.goto( callbackUrl( { code: 'qa-e2e-real-code', state } ) );
		await expect( page ).toHaveURL( SETTINGS_URL_RE );
		await expect( page.locator( '.notice-success' ) ).toContainText(
			/successfully connected/i
		);

		clearConnection();
		clearAuthTransients( adminUserId );
		wpCliSafe( "eval 'beehiiv_e2e_reset_all();'" );
	} );

	test( 'AC-005: successfully exchanged tokens are stored and available for authenticated API requests', async ( {
		page,
	} ) => {
		const state = await seedRealAuthorizationState( page );

		wpCli(
			'eval \'beehiiv_e2e_mock_http( "/oauth/token", [ "body" => [ "access_token" => "qa-e2e-ac5-access", "refresh_token" => "qa-e2e-ac5-refresh", "expires_in" => 3600 ] ] ); beehiiv_e2e_mock_http( "/users/identify", [ "body" => [] ] );\''
		);

		await page.goto( callbackUrl( { code: 'qa-e2e-real-code', state } ) );
		await page.waitForURL( SETTINGS_URL_RE );

		const accessToken = wpCli(
			"eval 'echo \\Beehiiv\\OAuth\\TokenStore::get_access_token();'"
		);
		expect( accessToken.trim() ).toBe( 'qa-e2e-ac5-access' );

		clearConnection();
		clearAuthTransients( adminUserId );
		wpCliSafe( "eval 'beehiiv_e2e_reset_all();'" );
	} );

	test( "AC-006: the authenticated user's identity is saved and displayed in the connection status", async ( {
		page,
	} ) => {
		const state = await seedRealAuthorizationState( page );

		wpCli(
			'eval \'beehiiv_e2e_mock_http( "/oauth/token", [ "body" => [ "access_token" => "qa-e2e-ac6-access", "refresh_token" => "qa-e2e-ac6-refresh", "expires_in" => 3600 ] ] ); beehiiv_e2e_mock_http( "/users/identify", [ "body" => [ "first_name" => "QA", "last_name" => "Tester", "email" => "qa-e2e-ac6@example.test" ] ] );\''
		);

		await page.goto( callbackUrl( { code: 'qa-e2e-real-code', state } ) );
		await page.waitForURL( SETTINGS_URL_RE );

		await expect(
			page.locator( '.beehiiv-connection-status__account' )
		).toContainText( 'QA Tester (qa-e2e-ac6@example.test)' );

		clearConnection();
		clearAuthTransients( adminUserId );
		wpCliSafe( "eval 'beehiiv_e2e_reset_all();'" );
	} );

	test( 'AC-007: only users with admin permissions can complete the OAuth connection', async ( {
		page,
	} ) => {
		// CallbackHandler::process()'s own current_user_can('manage_options')
		// check -- and its custom "You do not have permission to connect
		// beehiiv." message -- is unreachable for this exact scenario. The
		// callback page is registered via add_submenu_page(null, ...,
		// 'manage_options', ...) (CallbackHandler::register_page(), hooked to
		// admin_menu). WordPress core's own capability gate for a
		// nopriv-registered page runs synchronously inside
		// wp-admin/includes/menu.php, required from wp-admin/menu.php at
		// admin.php's line 163 -- *before* `do_action('admin_init')` at line
		// 180, which is what CallbackHandler::maybe_handle() hooks. So a
		// non-admin never reaches CallbackHandler::process() at all here;
		// WP core's generic "Sorry, you are not allowed to access this page."
		// (403) always wins first. Verified directly via wp-admin/menu.php
		// and wp-admin/includes/menu.php source, not just inferred from this
		// test's own result. The AC's actual guarantee (non-admins cannot
		// complete the connection) still holds -- just via WP core's page
		// registration, not the plugin's own redundant check.
		await loginAs( page, NON_ADMIN_USERNAME, NON_ADMIN_PASSWORD );
		const response = await page.goto(
			callbackUrl( {
				code: 'qa-e2e-any-code',
				state: 'qa-e2e-any-state',
			} )
		);

		expect( response.status() ).toBe( 403 );
		await expect(
			page.getByText( /sorry, you are not allowed to access this page/i )
		).toBeVisible();

		const connectedAfter = wpCli(
			'eval \'echo \\Beehiiv\\Connection\\Manager::is_connected() ? "yes" : "no";\''
		);
		expect( connectedAfter.trim() ).toBe( 'no' );
	} );
} );
