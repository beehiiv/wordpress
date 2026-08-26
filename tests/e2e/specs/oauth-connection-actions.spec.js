const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin, loginAs } = require( '../utils/auth' );
const { wpCli, wpCliSafe, ensurePluginActive } = require( '../utils/wp-cli' );

/**
 * PRD: requirements/03-authentication/3-oauth-admin-actions/oauth-connection-actions.prd.md
 * (brownfield-mapped -- no PLAN/EXECUTION artifacts exist for this feature;
 * the real files below were located by direct code search, not a plan/
 * execution trail. Verified by reading: includes/OAuth/AdminActions.php
 * (unit under test -- handle_connect/handle_disconnect/verify_request/
 * render_notice), includes/OAuth/Authorization.php, includes/OAuth/Revoker.php,
 * includes/OAuth/TokenStore.php.
 *
 * This PRD substantially overlaps three PRDs already independently tested
 * this session:
 *   - authentication/oauth-flow/oauth-authorization (AC-001/AC-003 here)
 *   - authentication/oauth-flow/oauth-callback (AC-004/AC-005/AC-006 here)
 *   - admin-interface/settings-page/connection-status-card (AC-007 here)
 * Rather than re-deriving identical coverage, this spec writes lightweight,
 * direct tests for each AC (cheap given the existing test-only mocking
 * seam) and additionally covers BR-001/BR-002 (capability + nonce
 * enforcement on these specific admin_post handlers), which no prior spec
 * exercised -- AdminActions::verify_request() is shared plumbing for both
 * handle_connect() and handle_disconnect() and was untested until now.
 */

const SETTINGS_PATH = '/wp-admin/admin.php?page=beehiiv';
const SETTINGS_URL_RE = /\/wp-admin\/admin\.php\?page=beehiiv(&|$)/;
const OAUTH_OPTION = 'beehiiv_oauth';
const SETTINGS_OPTION = 'beehiiv_settings';
const CONNECT_URL = '/wp-admin/admin-post.php?action=beehiiv_oauth_connect';
const DISCONNECT_URL = '/wp-admin/admin-post.php?action=beehiiv_oauth_disconnect';

const NON_ADMIN_USERNAME = 'qa_e2e_oauth_actions_contributor';
const NON_ADMIN_PASSWORD = 'qa-e2e-password';

function clearConnection() {
	wpCliSafe( `eval '\\Beehiiv\\OAuth\\TokenStore::delete_all();'` );
}

function seedClientId() {
	wpCli( `eval '\\Beehiiv\\OAuth\\TokenStore::save_client_id( "qa-e2e-conn-actions-client" );'` );
}

function seedConnected() {
	wpCli(
		`eval '\\Beehiiv\\OAuth\\TokenStore::save_tokens( "qa-e2e-conn-actions-client", [ "access_token" => "qa-e2e-conn-actions-access", "refresh_token" => "qa-e2e-conn-actions-refresh", "expires_in" => 3600 ] );'`
	);
}

test.beforeAll( () => {
	ensurePluginActive();

	wpCliSafe(
		`user create ${ NON_ADMIN_USERNAME } ${ NON_ADMIN_USERNAME }@example.test ` +
			`--role=contributor --user_pass=${ NON_ADMIN_PASSWORD }`
	);

	// Known clean baseline. This is wp-env's dedicated *tests* environment
	// (never dev/production), so there is no real state worth preserving.
	clearConnection();
	wpCliSafe( `option delete ${ SETTINGS_OPTION }` );
	wpCliSafe( "eval 'beehiiv_e2e_reset_all();'" );
} );

test.afterAll( () => {
	clearConnection();
	wpCliSafe( `option delete ${ SETTINGS_OPTION }` );
	wpCliSafe( "eval 'beehiiv_e2e_reset_all();'" );
} );

test.describe( 'OAuth Connection Actions', () => {
	test.beforeEach( async ( { page } ) => {
		await loginAsAdmin( page );
	} );

	test( 'AC-001: connect action initiates OAuth authorization flow when the connect button is clicked', async ( { page } ) => {
		clearConnection();
		seedClientId();

		await page.route( '**/oauth/authorize**', ( route ) => route.abort() );
		await page.goto( SETTINGS_PATH );

		const [ request ] = await Promise.all( [
			page.waitForRequest( ( req ) => req.url().includes( '/oauth/authorize' ) ),
			page.getByRole( 'link', { name: 'Connect to beehiiv' } ).click(),
		] );

		expect( new URL( request.url() ).origin ).toBe( 'https://app.beehiiv.com' );

		clearConnection();
	} );

	test( 'AC-002: authorization URL is fetched before redirecting to beehiiv', async ( { page } ) => {
		clearConnection();
		seedClientId();

		// Server-side: hitting the connect endpoint directly must respond
		// with a real 302 Location header pointing at the authorize URL --
		// proving the URL is built (fetched) server-side as part of the
		// redirect response itself, not client-side after landing somewhere
		// else first.
		const nonce = await getConnectNonce( page );
		const response = await page.request.get(
			`${ CONNECT_URL }&_wpnonce=${ nonce }`,
			{ maxRedirects: 0 }
		);

		expect( response.status() ).toBe( 302 );
		expect( response.headers().location ).toContain( 'https://app.beehiiv.com/oauth/authorize' );

		clearConnection();
	} );

	test( 'AC-003: if authorization URL generation fails, an error message is displayed instead of a broken redirect', async ( { page } ) => {
		clearConnection(); // No client_id -> ClientRegistrar::register() fails (no real registration token here).

		await page.goto( SETTINGS_PATH );
		await page.getByRole( 'link', { name: 'Connect to beehiiv' } ).click();
		await page.waitForURL( SETTINGS_URL_RE );

		await expect( page.locator( '.notice-error' ) ).toContainText( /not configured for this plugin build/i );
		expect( page.url() ).toMatch( SETTINGS_URL_RE );

		clearConnection();
	} );

	test( 'AC-004: after successful OAuth callback, user returns to the settings page with a success message', async ( { page } ) => {
		const state = await seedRealAuthorizationState( page );
		wpCli(
			'eval \'beehiiv_e2e_mock_http( "/oauth/token", [ "body" => [ "access_token" => "qa-e2e-ca-ac4-access", "refresh_token" => "qa-e2e-ca-ac4-refresh", "expires_in" => 3600 ] ] ); beehiiv_e2e_mock_http( "/users/identify", [ "body" => [] ] );\''
		);

		await page.goto(
			`/wp-admin/admin.php?page=beehiiv-oauth-callback&code=qa-e2e-real-code&state=${ state }`
		);

		await expect( page ).toHaveURL( SETTINGS_URL_RE );
		await expect( page.locator( '.notice-success' ) ).toContainText( /successfully connected/i );

		clearConnection();
		wpCliSafe( "eval 'beehiiv_e2e_reset_all();'" );
	} );

	test( 'AC-005: error messages are displayed in the admin interface', async ( { page } ) => {
		const state = await seedRealAuthorizationState( page );

		await page.goto(
			`/wp-admin/admin.php?page=beehiiv-oauth-callback&state=${ state }` // No `code` param.
		);
		await page.waitForURL( SETTINGS_URL_RE );

		await expect( page.locator( '.notice-error' ) ).toBeVisible();
	} );

	test( 'AC-006: error messages provide sufficient information to troubleshoot the issue', async ( { page } ) => {
		const state = await seedRealAuthorizationState( page );

		await page.goto( `/wp-admin/admin.php?page=beehiiv-oauth-callback&state=${ state }` );
		await page.waitForURL( SETTINGS_URL_RE );

		// Not just "an error occurred" -- names the specific, actionable
		// problem (invalid response) and invites retrying.
		await expect( page.locator( '.notice-error' ) ).toContainText( /invalid beehiiv connection response/i );
		await expect( page.locator( '.notice-error' ) ).toContainText( /please try again/i );
	} );

	test( "AC-007: disconnect action removes the site's stored connection and credentials", async ( { page } ) => {
		seedConnected();
		expect( wpCli( "eval 'echo \\Beehiiv\\Connection\\Manager::is_connected() ? \"yes\" : \"no\";'" ).trim() ).toBe(
			'yes'
		);

		await page.goto( SETTINGS_PATH );
		await page.getByRole( 'link', { name: 'Disconnect' } ).click();
		await page.waitForURL( SETTINGS_URL_RE );

		expect( wpCli( "eval 'echo \\Beehiiv\\Connection\\Manager::is_connected() ? \"yes\" : \"no\";'" ).trim() ).toBe(
			'no'
		);
	} );

	test( 'AC-008: after disconnect, a success message confirms the action', async ( { page } ) => {
		seedConnected();

		await page.goto( SETTINGS_PATH );
		await page.getByRole( 'link', { name: 'Disconnect' } ).click();
		await page.waitForURL( SETTINGS_URL_RE );

		await expect( page.locator( '.notice-success' ) ).toContainText( 'Disconnected from beehiiv.' );
	} );

	test( 'AC-009: admin notice messages appear on the settings page after redirect', async ( { page } ) => {
		// The notice is a one-time transient rendered on admin_notices, keyed
		// per-user and deleted on read -- confirm it survives exactly one
		// redirect+render, then is gone on a subsequent load.
		seedConnected();

		await page.goto( SETTINGS_PATH );
		await page.getByRole( 'link', { name: 'Disconnect' } ).click();
		await page.waitForURL( SETTINGS_URL_RE );
		await expect( page.locator( '.notice-success' ) ).toBeVisible();

		await page.reload();
		await expect( page.locator( '.notice-success' ) ).toHaveCount( 0 );
	} );

	test( 'Security (BR-001/BR-002): connect and disconnect actions require a valid capability and a valid nonce', async ( { page } ) => {
		// BR-002: a missing/invalid nonce is rejected by WordPress core's own
		// check_admin_referer() -- a "confirm this action" die page, not the
		// plugin's own redirect-with-notice flow.
		const badNonceConnect = await page.request.get( `${ CONNECT_URL }&_wpnonce=not-a-real-nonce`, {
			maxRedirects: 0,
		} );
		expect( badNonceConnect.status() ).toBe( 403 );

		const badNonceDisconnect = await page.request.get( `${ DISCONNECT_URL }&_wpnonce=not-a-real-nonce`, {
			maxRedirects: 0,
		} );
		expect( badNonceDisconnect.status() ).toBe( 403 );

		// BR-001: a non-admin is rejected by the plugin's own
		// current_user_can('manage_options') check inside verify_request()
		// -- which runs BEFORE the nonce check, so this fires even with an
		// invalid nonce. wp_die() with no explicit response code returns 500
		// in this environment (verified directly via curl, not assumed).
		await loginAs( page, NON_ADMIN_USERNAME, NON_ADMIN_PASSWORD );
		const nonAdminConnect = await page.request.get( `${ CONNECT_URL }&_wpnonce=not-a-real-nonce`, {
			maxRedirects: 0,
		} );
		expect( nonAdminConnect.status() ).toBe( 500 );
		await expect( nonAdminConnect.text() ).resolves.toContain(
			'You do not have permission to manage beehiiv settings.'
		);

		const connectedAfter = wpCli(
			"eval 'echo \\Beehiiv\\Connection\\Manager::is_connected() ? \"yes\" : \"no\";'"
		);
		expect( connectedAfter.trim() ).toBe( 'no' );
	} );
} );

/** Reads the real nonce for the connect action out of the live rendered settings page. */
async function getConnectNonce( page ) {
	await page.goto( SETTINGS_PATH );
	const href = await page.getByRole( 'link', { name: 'Connect to beehiiv' } ).getAttribute( 'href' );
	return new URL( href, page.url() ).searchParams.get( '_wpnonce' );
}

/**
 * Drives the real "Connect to beehiiv" button and captures the real `state`
 * WordPress issued, aborting the external navigation before any real
 * request reaches beehiiv.
 *
 * @param {import('@playwright/test').Page} page
 * @return {Promise<string>}
 */
async function seedRealAuthorizationState( page ) {
	clearConnection();
	seedClientId();

	await page.route( '**/oauth/authorize**', ( route ) => route.abort() );
	await page.goto( SETTINGS_PATH );

	const [ request ] = await Promise.all( [
		page.waitForRequest( ( req ) => req.url().includes( '/oauth/authorize' ) ),
		page.getByRole( 'link', { name: 'Connect to beehiiv' } ).click(),
	] );

	return new URL( request.url() ).searchParams.get( 'state' );
}
