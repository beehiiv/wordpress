const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin } = require( '../utils/auth' );
const { wpCli, wpCliSafe, ensurePluginActive } = require( '../utils/wp-cli' );

/**
 * PRD: requirements/03-authentication/2-token-management/secure-token-persistence.prd.md
 * (brownfield-mapped -- no PLAN/EXECUTION artifacts exist for this feature;
 * the real files below were located by direct code search, not a plan/
 * execution trail. Verified by reading: includes/OAuth/TokenStore.php (unit
 * under test), includes/Security/DataEncryption.php (AES-256-CTR using
 * WordPress's own LOGGED_IN_KEY/LOGGED_IN_SALT), includes/Connection/Manager.php
 * (get_connected_user_label(), consumed by AC-002's UI-display half),
 * includes/Admin/Views/connection.php.
 *
 * TokenStore is a pure persistence/encryption class with no UI of its own
 * beyond the connected-user display it feeds into the settings page's
 * connection status card. Its real consumers (Authorization, CallbackHandler,
 * AdminActions) all call it directly, so this spec exercises it the same
 * way -- directly via wp-cli against the real running site -- plus one real
 * page load for AC-002's UI-display half.
 */

const OAUTH_OPTION = 'beehiiv_oauth';
const SETTINGS_PATH = '/wp-admin/admin.php?page=beehiiv';

test.beforeAll( () => {
	ensurePluginActive();

	// Known clean baseline for every test in this file. This is wp-env's
	// dedicated *tests* environment (never dev/production), so there is no
	// real state worth preserving here.
	wpCliSafe( `option delete ${ OAUTH_OPTION }` );
} );

test.afterAll( () => {
	wpCliSafe( `option delete ${ OAUTH_OPTION }` );
} );

test.describe( 'Secure Token Persistence', () => {
	test.beforeEach( async ( { page } ) => {
		await loginAsAdmin( page );
	} );

	test( 'AC-001: all credential fields are stored encrypted, not in plaintext', async () => {
		wpCli(
			'eval \'\\Beehiiv\\OAuth\\TokenStore::save_tokens( "qa-e2e-ac1-client", [ "access_token" => "qa-e2e-ac1-plaintext-access", "refresh_token" => "qa-e2e-ac1-plaintext-refresh", "expires_in" => 3600 ] );\''
		);

		const raw = wpCli( `option get ${ OAUTH_OPTION } --format=json` );
		expect( raw ).not.toContain( 'qa-e2e-ac1-plaintext-access' );
		expect( raw ).not.toContain( 'qa-e2e-ac1-plaintext-refresh' );
		expect( raw ).not.toContain( 'qa-e2e-ac1-client' );

		// Sanity: the encrypted blob still round-trips to the real value via
		// the class's own decrypt path -- proves this is genuine encryption,
		// not just garbled/corrupted data that happens not to contain the
		// substring.
		const accessToken = wpCli(
			"eval 'echo \\Beehiiv\\OAuth\\TokenStore::get_access_token();'"
		);
		expect( accessToken.trim() ).toBe( 'qa-e2e-ac1-plaintext-access' );

		wpCliSafe( `option delete ${ OAUTH_OPTION }` );
	} );

	test( 'AC-002: connected user information is stored and retrievable for display in the admin UI', async ( {
		page,
	} ) => {
		wpCli(
			'eval \'\\Beehiiv\\OAuth\\TokenStore::save_tokens( "qa-e2e-ac2-client", [ "access_token" => "qa-e2e-ac2-access", "refresh_token" => "qa-e2e-ac2-refresh", "expires_in" => 3600 ], [ "first_name" => "QA", "last_name" => "Tester", "email" => "qa-e2e-ac2@example.test" ] );\''
		);

		const label = wpCli(
			"eval 'echo \\Beehiiv\\Connection\\Manager::get_connected_user_label();'"
		);
		expect( label.trim() ).toBe( 'QA Tester (qa-e2e-ac2@example.test)' );

		await page.goto( SETTINGS_PATH );
		await expect(
			page.locator( '.beehiiv-connection-status__account' )
		).toContainText( 'QA Tester (qa-e2e-ac2@example.test)' );

		wpCliSafe( `option delete ${ OAUTH_OPTION }` );
	} );

	test( 'AC-003: methods to retrieve tokens return decrypted values transparently to callers', async () => {
		wpCli(
			'eval \'\\Beehiiv\\OAuth\\TokenStore::save_tokens( "qa-e2e-ac3-client", [ "access_token" => "qa-e2e-ac3-access", "refresh_token" => "qa-e2e-ac3-refresh", "expires_in" => 3600 ] );\''
		);

		const clientId = wpCli(
			"eval 'echo \\Beehiiv\\OAuth\\TokenStore::get_client_id();'"
		);
		const accessToken = wpCli(
			"eval 'echo \\Beehiiv\\OAuth\\TokenStore::get_access_token();'"
		);
		const refreshToken = wpCli(
			"eval 'echo \\Beehiiv\\OAuth\\TokenStore::get_refresh_token();'"
		);

		expect( clientId.trim() ).toBe( 'qa-e2e-ac3-client' );
		expect( accessToken.trim() ).toBe( 'qa-e2e-ac3-access' );
		expect( refreshToken.trim() ).toBe( 'qa-e2e-ac3-refresh' );

		wpCliSafe( `option delete ${ OAUTH_OPTION }` );
	} );

	test( 'AC-004: expiry metadata is stored and accessible to refresh logic for staleness checks', async () => {
		wpCli(
			'eval \'\\Beehiiv\\OAuth\\TokenStore::save_tokens( "qa-e2e-ac4-client", [ "access_token" => "qa-e2e-ac4-access", "refresh_token" => "qa-e2e-ac4-refresh", "expires_in" => 1800 ] );\''
		);

		const expiresAt = parseInt(
			wpCli(
				"eval 'echo \\Beehiiv\\OAuth\\TokenStore::get_expires_at();'"
			).trim(),
			10
		);
		const expectedExpiry = Math.floor( Date.now() / 1000 ) + 1800;

		expect( expiresAt ).toBeGreaterThan( expectedExpiry - 10 );
		expect( expiresAt ).toBeLessThanOrEqual( expectedExpiry );

		wpCliSafe( `option delete ${ OAUTH_OPTION }` );
	} );

	test( 'AC-005: the system supports partial credential updates (e.g. refreshing only the access token) without requiring re-authorization', async () => {
		wpCli(
			'eval \'\\Beehiiv\\OAuth\\TokenStore::save_tokens( "qa-e2e-ac5-client", [ "access_token" => "qa-e2e-ac5-original-access", "refresh_token" => "qa-e2e-ac5-original-refresh", "expires_in" => 3600 ] );\''
		);

		// BR-002: a token response with NO refresh_token key must preserve
		// the existing stored refresh token, not blank it out.
		wpCli(
			'eval \'\\Beehiiv\\OAuth\\TokenStore::save_tokens( "qa-e2e-ac5-client", [ "access_token" => "qa-e2e-ac5-new-access", "expires_in" => 3600 ] );\''
		);

		const accessToken = wpCli(
			"eval 'echo \\Beehiiv\\OAuth\\TokenStore::get_access_token();'"
		);
		const refreshToken = wpCli(
			"eval 'echo \\Beehiiv\\OAuth\\TokenStore::get_refresh_token();'"
		);

		expect( accessToken.trim() ).toBe( 'qa-e2e-ac5-new-access' );
		expect( refreshToken.trim() ).toBe( 'qa-e2e-ac5-original-refresh' );

		wpCliSafe( `option delete ${ OAUTH_OPTION }` );
	} );

	test( 'AC-006: the system provides a way to verify whether valid credentials are available before attempting API calls', async () => {
		wpCliSafe( `option delete ${ OAUTH_OPTION }` );
		const beforeAny = wpCli(
			'eval \'echo \\Beehiiv\\OAuth\\TokenStore::has_credentials() ? "yes" : "no";\''
		);
		expect( beforeAny.trim() ).toBe( 'no' );

		// BR-001: client_id alone (no access_token) is still incomplete.
		wpCli(
			'eval \'\\Beehiiv\\OAuth\\TokenStore::save_client_id( "qa-e2e-ac6-client" );\''
		);
		const clientOnly = wpCli(
			'eval \'echo \\Beehiiv\\OAuth\\TokenStore::has_credentials() ? "yes" : "no";\''
		);
		expect( clientOnly.trim() ).toBe( 'no' );

		wpCli(
			'eval \'\\Beehiiv\\OAuth\\TokenStore::save_tokens( "qa-e2e-ac6-client", [ "access_token" => "qa-e2e-ac6-access", "refresh_token" => "qa-e2e-ac6-refresh", "expires_in" => 3600 ] );\''
		);
		const full = wpCli(
			'eval \'echo \\Beehiiv\\OAuth\\TokenStore::has_credentials() ? "yes" : "no";\''
		);
		expect( full.trim() ).toBe( 'yes' );

		wpCliSafe( `option delete ${ OAUTH_OPTION }` );
	} );

	test( 'AC-007: all credentials can be deleted in a single operation when the site disconnects', async () => {
		wpCli(
			'eval \'\\Beehiiv\\OAuth\\TokenStore::save_tokens( "qa-e2e-ac7-client", [ "access_token" => "qa-e2e-ac7-access", "refresh_token" => "qa-e2e-ac7-refresh", "expires_in" => 3600 ], [ "first_name" => "QA" ] );\''
		);

		wpCli( "eval '\\Beehiiv\\OAuth\\TokenStore::delete_all();'" );

		const optionValue = wpCliSafe( `option get ${ OAUTH_OPTION }` );
		expect( optionValue ).toBeNull();

		const hasCredentials = wpCli(
			'eval \'echo \\Beehiiv\\OAuth\\TokenStore::has_credentials() ? "yes" : "no";\''
		);
		expect( hasCredentials.trim() ).toBe( 'no' );
	} );
} );
