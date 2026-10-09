const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin } = require( '../utils/auth' );
const { wpCli, wpCliSafe, ensurePluginActive } = require( '../utils/wp-cli' );

/**
 * PRD: requirements/03-authentication/4-oauth-revocation/token-revocation.prd.md
 * (brownfield-mapped -- no PLAN/EXECUTION artifacts exist for this feature;
 * the real files below were located by direct code search, not a plan/
 * execution trail. Verified by reading: includes/OAuth/Revoker.php (unit
 * under test), includes/OAuth/TokenStore.php, includes/API/Cache.php,
 * includes/Config.php (OPTION_NAME = 'beehiiv_settings').
 *
 * Revoker::disconnect() is a pure backend orchestrator with no UI of its
 * own (AdminActions::handle_disconnect() is what wires it to a button --
 * covered by oauth-connection-actions.spec.js AC-007/AC-008) -- exercised
 * directly via wp-cli. AC-001/AC-002 (a revocation request is actually
 * sent, with the right fields) use WordPress core's own `http_api_debug`
 * action, fired after every wp_remote_request() call, to observe the real
 * outbound request rather than just trusting the code path was reached.
 */

const OAUTH_OPTION = 'beehiiv_oauth';
const SETTINGS_OPTION = 'beehiiv_settings';
const DEBUG_OPTION = 'qa_e2e_revoke_debug';

/**
 * Registers a one-off http_api_debug logger and returns what it captured for /oauth/revoke.
 * @param {Function} fn
 */
function captureRevokeRequest( fn ) {
	wpCliSafe( `option delete ${ DEBUG_OPTION }` );
	wpCli(
		"eval '" +
			'add_action( "http_api_debug", function( $r, $c, $cl, $args, $url ) {' +
			'if ( false !== strpos( $url, "/oauth/revoke" ) ) {' +
			'update_option( "' +
			DEBUG_OPTION +
			'", $args["body"] ?? [] );' +
			'}' +
			'}, 10, 5 );' +
			fn +
			"'"
	);
	const raw = wpCliSafe( `option get ${ DEBUG_OPTION } --format=json` );
	return raw ? JSON.parse( raw ) : null;
}

test.beforeAll( () => {
	ensurePluginActive();

	// Known clean baseline for every test in this file. This is wp-env's
	// dedicated *tests* environment (never dev/production), so there is no
	// real state worth preserving here.
	wpCliSafe( `option delete ${ OAUTH_OPTION }` );
	wpCliSafe( `option delete ${ SETTINGS_OPTION }` );
	wpCliSafe( `option delete ${ DEBUG_OPTION }` );
	wpCliSafe( "eval 'beehiiv_e2e_reset_all();'" );
} );

test.afterAll( () => {
	wpCliSafe( `option delete ${ OAUTH_OPTION }` );
	wpCliSafe( `option delete ${ SETTINGS_OPTION }` );
	wpCliSafe( `option delete ${ DEBUG_OPTION }` );
	wpCliSafe( "eval 'beehiiv_e2e_reset_all();'" );
} );

test.describe( 'OAuth Token Revocation', () => {
	test.beforeEach( async ( { page } ) => {
		await loginAsAdmin( page );
	} );

	test.afterEach( () => {
		wpCliSafe( `option delete ${ OAUTH_OPTION }` );
		wpCliSafe( `option delete ${ SETTINGS_OPTION }` );
		wpCliSafe( `option delete ${ DEBUG_OPTION }` );
		wpCliSafe( "eval 'beehiiv_e2e_reset_all();'" );
	} );

	test( "AC-001: when disconnect is triggered, a revocation request is sent to beehiiv's OAuth endpoint", async () => {
		const body = captureRevokeRequest(
			'\\Beehiiv\\OAuth\\TokenStore::save_tokens( "qa-e2e-ac1-client", [ "access_token" => "qa-e2e-ac1-access", "refresh_token" => "qa-e2e-ac1-refresh", "expires_in" => 3600 ] ); \\Beehiiv\\OAuth\\Revoker::disconnect();'
		);

		expect( body ).not.toBeNull();
	} );

	test( 'AC-002: the revocation request includes the stored client ID and the token (refresh token preferred)', async () => {
		const body = captureRevokeRequest(
			'\\Beehiiv\\OAuth\\TokenStore::save_tokens( "qa-e2e-ac2-client", [ "access_token" => "qa-e2e-ac2-access", "refresh_token" => "qa-e2e-ac2-refresh", "expires_in" => 3600 ] ); \\Beehiiv\\OAuth\\Revoker::disconnect();'
		);

		expect( body.client_id ).toBe( 'qa-e2e-ac2-client' );
		// BR-001: refresh token is preferred over access token when both exist.
		expect( body.token ).toBe( 'qa-e2e-ac2-refresh' );
	} );

	test( 'AC-003: the disconnect completes even if the revocation request fails', async () => {
		wpCli(
			'eval \'\\Beehiiv\\OAuth\\TokenStore::save_tokens( "qa-e2e-ac3-client", [ "access_token" => "qa-e2e-ac3-access", "refresh_token" => "qa-e2e-ac3-refresh", "expires_in" => 3600 ] );\''
		);

		// No mock registered for /oauth/revoke -- this is a genuine,
		// un-mocked attempt to reach the real (unreachable-in-this-env)
		// beehiiv revocation endpoint. Revoker::disconnect() never inspects
		// the response, so local cleanup must proceed regardless of whether
		// that request succeeds, times out, or errors.
		wpCli( "eval '\\Beehiiv\\OAuth\\Revoker::disconnect();'" );

		const hasCredentials = wpCli(
			'eval \'echo \\Beehiiv\\OAuth\\TokenStore::has_credentials() ? "yes" : "no";\''
		);
		expect( hasCredentials.trim() ).toBe( 'no' );
	} );

	test( 'AC-004: all stored OAuth tokens (access and refresh) are deleted from the site', async () => {
		wpCli(
			'eval \'\\Beehiiv\\OAuth\\TokenStore::save_tokens( "qa-e2e-ac4-client", [ "access_token" => "qa-e2e-ac4-access", "refresh_token" => "qa-e2e-ac4-refresh", "expires_in" => 3600 ] );\''
		);

		wpCli( "eval '\\Beehiiv\\OAuth\\Revoker::disconnect();'" );

		const optionValue = wpCliSafe( `option get ${ OAUTH_OPTION }` );
		expect( optionValue ).toBeNull();

		const accessToken = wpCli(
			"eval 'echo \\Beehiiv\\OAuth\\TokenStore::get_access_token();'"
		);
		const refreshToken = wpCli(
			"eval 'echo \\Beehiiv\\OAuth\\TokenStore::get_refresh_token();'"
		);
		expect( accessToken.trim() ).toBe( '' );
		expect( refreshToken.trim() ).toBe( '' );
	} );

	test( 'AC-005: all API cache entries are flushed', async () => {
		wpCli(
			'eval \'\\Beehiiv\\OAuth\\TokenStore::save_tokens( "qa-e2e-ac5-client", [ "access_token" => "qa-e2e-ac5-access", "refresh_token" => "qa-e2e-ac5-refresh", "expires_in" => 3600 ] );\''
		);
		wpCli(
			'eval \'beehiiv_e2e_seed_publications( [ [ "id" => "qa-e2e-ac5-pub", "name" => "QA AC5" ] ] ); beehiiv_e2e_seed_post_templates( "qa-e2e-ac5-pub", [ [ "id" => "qa-e2e-ac5-tpl", "name" => "QA AC5 Template" ] ] );\''
		);

		const beforeDisconnect = wpCli(
			"eval 'echo wp_json_encode( \\Beehiiv\\API\\Cache::get_publications() );'"
		);
		expect( beforeDisconnect.trim() ).not.toBe( 'null' );

		wpCli( "eval '\\Beehiiv\\OAuth\\Revoker::disconnect();'" );

		const publications = wpCli(
			"eval 'echo wp_json_encode( \\Beehiiv\\API\\Cache::get_publications() );'"
		);
		const templates = wpCli(
			'eval \'echo wp_json_encode( \\Beehiiv\\API\\Cache::get_post_templates( "qa-e2e-ac5-pub" ) );\''
		);
		expect( publications.trim() ).toBe( 'null' );
		expect( templates.trim() ).toBe( 'null' );
	} );

	test( 'AC-006: plugin settings and configuration are cleared', async () => {
		wpCli(
			'eval \'\\Beehiiv\\OAuth\\TokenStore::save_tokens( "qa-e2e-ac6-client", [ "access_token" => "qa-e2e-ac6-access", "refresh_token" => "qa-e2e-ac6-refresh", "expires_in" => 3600 ] );\''
		);
		wpCli(
			`option update ${ SETTINGS_OPTION } '{"publication_id":"qa-e2e-ac6-pub","post_template_id":"qa-e2e-ac6-tpl"}' --format=json`
		);

		wpCli( "eval '\\Beehiiv\\OAuth\\Revoker::disconnect();'" );

		const settingsValue = wpCliSafe( `option get ${ SETTINGS_OPTION }` );
		expect( settingsValue ).toBeNull();
	} );
} );
