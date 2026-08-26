const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin } = require( '../utils/auth' );
const { wpCli, wpCliSafe, ensurePluginActive } = require( '../utils/wp-cli' );

/**
 * PRD: requirements/03-authentication/2-token-management/automatic-token-refresh.prd.md
 * (brownfield-mapped -- no PLAN/EXECUTION artifacts exist for this feature;
 * the real files below were located by direct code search, not a plan/
 * execution trail. Verified by reading: includes/OAuth/TokenRefresher.php
 * (unit under test), includes/OAuth/TokenStore.php (storage it reads/writes),
 * includes/OAuth/Config.php (REFRESH_BUFFER_SECONDS), includes/OAuth/HttpClient.php
 * (the /oauth/token transport, mocked here).
 *
 * TokenRefresher is a pure backend service with no UI -- exercised directly
 * via wp-cli against the real running site, the same way its real callers
 * (Beehiiv\API\Client) do. The one live /oauth/token network call is mocked
 * via the test-only mu-plugin seam's beehiiv_e2e_mock_http()
 * (tests/e2e/plugins/beehiiv-options.php).
 *
 * IMPORTANT: Config::REFRESH_BUFFER_SECONDS is actually 300 in this codebase,
 * not the 60 seconds BR-001 states as the default -- confirmed by reading
 * includes/OAuth/Config.php directly. Test values below (100s / 3600s
 * remaining) are chosen specifically to only make sense under the real 300s
 * buffer, which doubles as a check that the real buffer value is what the
 * code claims.
 */

const OAUTH_OPTION = 'beehiiv_oauth';
const CLIENT_ID = 'qa-e2e-refresh-client';

/** Seeds a connection with a controllable remaining lifetime. */
function seedToken( accessToken, refreshToken, expiresIn, clientId = CLIENT_ID ) {
	wpCli(
		`eval '\\Beehiiv\\OAuth\\TokenStore::save_tokens( "${ clientId }", [ "access_token" => "${ accessToken }", "refresh_token" => "${ refreshToken }", "expires_in" => ${ expiresIn } ] );'`
	);
}

function mockTokenEndpointSuccess( newAccessToken, newRefreshToken ) {
	wpCli(
		`eval 'beehiiv_e2e_mock_http( "/oauth/token", [ "body" => [ "access_token" => "${ newAccessToken }", "refresh_token" => "${ newRefreshToken }", "expires_in" => 3600 ] ] );'`
	);
}

function mockTokenEndpointFailure() {
	wpCli( 'eval \'beehiiv_e2e_mock_http( "/oauth/token", [ "status" => 400, "body" => [ "error" => "invalid_grant" ] ] );\'' );
}

test.beforeAll( () => {
	ensurePluginActive();

	// Known clean baseline for every test in this file. This is wp-env's
	// dedicated *tests* environment (never dev/production), so there is no
	// real state worth preserving here.
	wpCliSafe( `option delete ${ OAUTH_OPTION }` );
	wpCliSafe( "eval 'beehiiv_e2e_reset_all();'" );
} );

test.afterAll( () => {
	wpCliSafe( `option delete ${ OAUTH_OPTION }` );
	wpCliSafe( "eval 'beehiiv_e2e_reset_all();'" );
} );

test.describe( 'Automatic Token Refresh', () => {
	test.beforeEach( async ( { page } ) => {
		await loginAsAdmin( page );
	} );

	test.afterEach( () => {
		wpCliSafe( `option delete ${ OAUTH_OPTION }` );
		wpCliSafe( "eval 'beehiiv_e2e_reset_all();'" );
	} );

	test( 'AC-001: a method exists to retrieve a valid access token, automatically refreshing it if approaching expiration', async () => {
		seedToken( 'qa-e2e-ac1-old-access', 'qa-e2e-ac1-refresh', 100 ); // 100s remaining < 300s buffer.
		mockTokenEndpointSuccess( 'qa-e2e-ac1-new-access', 'qa-e2e-ac1-new-refresh' );

		const token = wpCli( "eval 'echo \\Beehiiv\\OAuth\\TokenRefresher::get_valid_access_token();'" );
		expect( token.trim() ).toBe( 'qa-e2e-ac1-new-access' );
	} );

	test( 'AC-002: the refresh buffer time is configurable and prevents unnecessary refreshes of tokens still valid for a reasonable period', async () => {
		seedToken( 'qa-e2e-ac2-original-access', 'qa-e2e-ac2-refresh', 3600 ); // Well beyond the 300s buffer.
		mockTokenEndpointSuccess( 'qa-e2e-ac2-should-not-appear', 'qa-e2e-ac2-should-not-appear' );

		const token = wpCli( "eval 'echo \\Beehiiv\\OAuth\\TokenRefresher::get_valid_access_token();'" );

		// If refresh incorrectly triggered despite being outside the buffer,
		// this would return the mocked NEW token instead of the original.
		expect( token.trim() ).toBe( 'qa-e2e-ac2-original-access' );

		const stillStored = wpCli( "eval 'echo \\Beehiiv\\OAuth\\TokenStore::get_access_token();'" );
		expect( stillStored.trim() ).toBe( 'qa-e2e-ac2-original-access' );
	} );

	test( 'AC-003: when refresh is triggered, the OAuth provider is contacted using the stored refresh token', async () => {
		seedToken( 'qa-e2e-ac3-old-access', 'qa-e2e-ac3-refresh', 100 );
		mockTokenEndpointSuccess( 'qa-e2e-ac3-new-access', 'qa-e2e-ac3-new-refresh' );

		const result = wpCli( "eval 'var_dump( \\Beehiiv\\OAuth\\TokenRefresher::refresh() );'" );
		expect( result.trim() ).toBe( 'bool(true)' );

		// The refresh only succeeds (mocked 200) if the request reached the
		// matched endpoint at all -- refresh() returns a WP_Error before ever
		// building the request if client_id/refresh_token were missing (see
		// AC-008), so a real `true` here proves it read and sent the stored
		// credentials to build that request.
		const newAccess = wpCli( "eval 'echo \\Beehiiv\\OAuth\\TokenStore::get_access_token();'" );
		expect( newAccess.trim() ).toBe( 'qa-e2e-ac3-new-access' );
	} );

	test( 'AC-004: recursive refresh calls during the same request cycle are prevented', async () => {
		// TokenRefresher::$refreshing is a private static flag, reset per PHP
		// process -- it only ever guards re-entrant calls within a single
		// request/process, not genuinely concurrent requests (each gets its
		// own process/statics). Set it directly via Reflection to simulate
		// "a refresh is already in progress" and confirm a second call is
		// rejected without attempting another HTTP request.
		seedToken( 'qa-e2e-ac4-access', 'qa-e2e-ac4-refresh', 100 );

		const result = wpCli(
			'eval \'' +
				'$ref = new ReflectionClass( "\\Beehiiv\\OAuth\\TokenRefresher" );' +
				'$prop = $ref->getProperty( "refreshing" );' +
				'$prop->setAccessible( true );' +
				'$prop->setValue( null, true );' +
				'$result = \\Beehiiv\\OAuth\\TokenRefresher::refresh();' +
				'$prop->setValue( null, false );' +
				'echo is_wp_error( $result ) && "beehiiv_refresh_loop" === $result->get_error_code() ? "yes" : "no";' +
				"'"
		);

		expect( result.trim() ).toBe( 'yes' );

		// The original token must be untouched -- the blocked call never
		// reached the token endpoint or storage layer.
		const unchanged = wpCli( "eval 'echo \\Beehiiv\\OAuth\\TokenStore::get_access_token();'" );
		expect( unchanged.trim() ).toBe( 'qa-e2e-ac4-access' );
	} );

	test( 'AC-005: token refresh happens without requiring the caller to implement refresh logic', async () => {
		seedToken( 'qa-e2e-ac5-old-access', 'qa-e2e-ac5-refresh', 100 );
		mockTokenEndpointSuccess( 'qa-e2e-ac5-new-access', 'qa-e2e-ac5-new-refresh' );

		// A single call to the read-only accessor -- no separate refresh()
		// call, no error handling -- is sufficient for the caller to receive
		// a fresh token transparently.
		const token = wpCli( "eval 'echo \\Beehiiv\\OAuth\\TokenRefresher::get_valid_access_token();'" );
		expect( token.trim() ).toBe( 'qa-e2e-ac5-new-access' );

		// A second call immediately after (now well within the fresh 3600s
		// window) returns the same token again without erroring or needing
		// any special handling -- confirms the caller never has to know a
		// refresh happened at all.
		const secondCall = wpCli( "eval 'echo \\Beehiiv\\OAuth\\TokenRefresher::get_valid_access_token();'" );
		expect( secondCall.trim() ).toBe( 'qa-e2e-ac5-new-access' );
	} );

	test( 'AC-006: after a successful refresh, the new access token is stored and returned to the caller', async () => {
		seedToken( 'qa-e2e-ac6-old-access', 'qa-e2e-ac6-refresh', 100 );
		mockTokenEndpointSuccess( 'qa-e2e-ac6-new-access', 'qa-e2e-ac6-new-refresh' );

		const returned = wpCli( "eval 'echo \\Beehiiv\\OAuth\\TokenRefresher::get_valid_access_token();'" );
		const stored = wpCli( "eval 'echo \\Beehiiv\\OAuth\\TokenStore::get_access_token();'" );
		const storedRefresh = wpCli( "eval 'echo \\Beehiiv\\OAuth\\TokenStore::get_refresh_token();'" );

		expect( returned.trim() ).toBe( 'qa-e2e-ac6-new-access' );
		expect( stored.trim() ).toBe( 'qa-e2e-ac6-new-access' );
		expect( storedRefresh.trim() ).toBe( 'qa-e2e-ac6-new-refresh' );
	} );

	test( 'AC-007: if a refresh call fails (network error, HTTP error, or invalid response), the existing access token is returned to allow the caller to attempt to use it', async () => {
		seedToken( 'qa-e2e-ac7-original-access', 'qa-e2e-ac7-refresh', 100 );
		mockTokenEndpointFailure(); // 400 response.

		const token = wpCli( "eval 'echo \\Beehiiv\\OAuth\\TokenRefresher::get_valid_access_token();'" );
		expect( token.trim() ).toBe( 'qa-e2e-ac7-original-access' );

		// Storage must be untouched by the failed attempt.
		const stillStored = wpCli( "eval 'echo \\Beehiiv\\OAuth\\TokenStore::get_access_token();'" );
		expect( stillStored.trim() ).toBe( 'qa-e2e-ac7-original-access' );
	} );

	test( 'AC-008: if stored credentials (refresh token or client ID) are missing or incomplete, the system indicates that no valid token is available instead of attempting a refresh', async () => {
		// This assertion follows the AC's literal wording. Actual behavior
		// (verified below, not assumed): TokenRefresher::refresh() does
		// correctly detect the missing refresh_token/client_id and returns a
		// WP_Error('beehiiv_refresh_missing') without attempting any HTTP
		// call -- but get_valid_access_token()'s caller-facing fallback for
		// ANY refresh WP_Error (missing-credentials included) is identical to
		// AC-007's generic failure path: it returns the existing (soon truly
		// expired) access token, not an empty-string/"no valid token" signal.
		// So this AC's specific claim -- that missing refresh credentials are
		// surfaced distinctly as "no valid token available" -- does not match
		// the real code, which is indistinguishable from a generic transient
		// failure to the caller. Kept as test.fail() so this stays documented
		// and re-flags if the fallback behavior changes.
		test.fail();

		// save_tokens() itself rejects an empty client_id (returns false,
		// saves nothing), so this precondition can't be seeded through the
		// normal API -- seed a complete, valid token first, then clear just
		// the client_id field directly on the raw stored array to reproduce
		// "access token present, client_id missing" without going through
		// that rejection.
		seedToken( 'qa-e2e-ac8-access', 'qa-e2e-ac8-refresh', 100 );
		wpCli(
			'eval \'$d = get_option( "beehiiv_oauth", [] ); $d["client_id"] = ""; update_option( "beehiiv_oauth", $d, false );\''
		);

		const token = wpCli( "eval 'echo \\Beehiiv\\OAuth\\TokenRefresher::get_valid_access_token();'" );
		expect( token.trim() ).toBe( '' );
	} );
} );
