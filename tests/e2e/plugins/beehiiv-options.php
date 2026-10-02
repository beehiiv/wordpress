<?php
/**
 * Plugin Name: beehiiv E2E Test Options
 * Description: Test-only seams for Playwright specs under tests/e2e. Loaded
 * as an mu-plugin in wp-env's dedicated *tests* environment only (see
 * .wp-env.json's env.tests.mappings) -- never present in dev or production.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Short-circuits any outbound wp_remote_request() whose URL contains a
 * registered substring, so specs can exercise code gated behind a live
 * beehiiv API/OAuth call (permissions checks, token exchange, user
 * identity) without a real OAuth connection or beehiiv account. Both
 * Beehiiv\API\Client (api.beehiiv.com) and Beehiiv\OAuth\HttpClient
 * (app.beehiiv.com/oauth/*) route through wp_remote_request(), so this one
 * filter covers every beehiiv-bound call in the plugin.
 *
 * Opt-in per URL substring via the `beehiiv_e2e_http_mocks` option: a URL
 * with no matching registered substring passes through to the real network
 * unchanged, so specs relying on genuine "not connected" / genuine error
 * responses (e.g. connection-status-card) are unaffected.
 */
add_filter(
	'pre_http_request',
	static function ( $preempt, $parsed_args, $url ) {
		$mocks = get_option( 'beehiiv_e2e_http_mocks', [] );

		if ( ! is_array( $mocks ) ) {
			return $preempt;
		}

		foreach ( $mocks as $needle => $mock ) {
			if ( ! is_string( $needle ) || '' === $needle || ! is_array( $mock ) ) {
				continue;
			}

			// Optional `pattern` (regex) replaces the plain substring match, and
			// optional `method` restricts the mock to one HTTP verb -- needed when
			// several endpoints share a URL prefix (e.g. beehiiv post create,
			// delete, and test_sends all live under /publications/{id}/posts).
			if ( isset( $mock['pattern'] ) && is_string( $mock['pattern'] ) ) {
				if ( ! preg_match( $mock['pattern'], $url ) ) {
					continue;
				}
			} elseif ( false === strpos( $url, $needle ) ) {
				continue;
			}

			$method = strtoupper( (string) ( $parsed_args['method'] ?? 'GET' ) );

			if ( isset( $mock['method'] ) && strtoupper( (string) $mock['method'] ) !== $method ) {
				continue;
			}

			beehiiv_e2e_log_http( $method, $url, $parsed_args['body'] ?? null, $needle );

			if ( ! empty( $mock['delay_ms'] ) ) {
				usleep( (int) $mock['delay_ms'] * 1000 );
			}

			$body = $mock['body'] ?? [];

			return [
				'headers'  => [],
				'body'     => is_string( $body ) ? $body : wp_json_encode( $body ),
				'response' => [
					'code'    => $mock['status'] ?? 200,
					'message' => $mock['message'] ?? 'OK',
				],
				'cookies'  => [],
				'filename' => null,
			];
		}

		return $preempt;
	},
	10,
	3
);

/**
 * Registers a mocked HTTP response for any outbound wp_remote_request()
 * whose URL contains $url_substring.
 *
 * Call via `wp eval`, e.g. from a spec's wp-cli helper:
 *   wp eval 'beehiiv_e2e_mock_http( "/workspaces/permissions", [ "body" => [ "data" => [ "posts" => [ "read", "write" ] ] ] ] );'
 *   wp eval 'beehiiv_e2e_mock_http( "/oauth/token", [ "body" => [ "access_token" => "qa-tok", "refresh_token" => "qa-refresh", "expires_in" => 3600 ] ] );'
 *   wp eval 'beehiiv_e2e_mock_http( "/users/identify", [ "body" => [ "first_name" => "QA" ] ] );'
 *
 * @param string $url_substring Substring matched against the outbound request URL.
 * @param array{status?: int, message?: string, body?: array<string,mixed>|string} $response Response to return.
 */
function beehiiv_e2e_mock_http( string $url_substring, array $response ): void {
	$mocks                    = get_option( 'beehiiv_e2e_http_mocks', [] );
	$mocks                    = is_array( $mocks ) ? $mocks : [];
	$mocks[ $url_substring ]  = $response;
	update_option( 'beehiiv_e2e_http_mocks', $mocks, false );
}

/** Clears one HTTP mock by its substring, or every mock if omitted. */
function beehiiv_e2e_clear_http_mocks( string $url_substring = '' ): void {
	if ( '' === $url_substring ) {
		delete_option( 'beehiiv_e2e_http_mocks' );
		return;
	}

	$mocks = get_option( 'beehiiv_e2e_http_mocks', [] );

	if ( is_array( $mocks ) ) {
		unset( $mocks[ $url_substring ] );
		update_option( 'beehiiv_e2e_http_mocks', $mocks, false );
	}
}

/**
 * Sets the mocked /workspaces/permissions response for the current test.
 * Thin convenience wrapper over beehiiv_e2e_mock_http() -- kept for the
 * specs already written against this exact signature.
 *
 *   wp eval 'beehiiv_e2e_mock_permissions( [ "posts" => [ "read", "write" ] ] );'
 *   wp eval 'beehiiv_e2e_mock_permissions( [ "posts" => [ "read" ] ] );' // connected, read-only
 *
 * @param array<string,array<int,string>> $permissions Resource => granted actions.
 */
function beehiiv_e2e_mock_permissions( array $permissions ): void {
	beehiiv_e2e_mock_http( '/workspaces/permissions', [ 'body' => [ 'data' => $permissions ] ] );
}

/** Clears the permissions mock, restoring real network behavior. */
function beehiiv_e2e_clear_permissions_mock(): void {
	beehiiv_e2e_clear_http_mocks( '/workspaces/permissions' );
}

/**
 * Seeds a fake OAuth connection. TokenStore encrypts its option at rest, so
 * a raw `wp option update beehiiv_oauth` won't work -- this goes through
 * the real class the same way a genuine OAuth callback would.
 *
 * @param array{
 *     client_id?: string,
 *     access_token?: string,
 *     refresh_token?: string,
 *     expires_in?: int,
 *     connected_user?: array<string,mixed>,
 * } $args Overrides for the seeded token; every key has a fake default.
 */
function beehiiv_e2e_seed_connection( array $args = [] ): void {
	\Beehiiv\OAuth\TokenStore::save_tokens(
		(string) ( $args['client_id'] ?? 'qa-e2e-client' ),
		[
			'access_token'  => (string) ( $args['access_token'] ?? 'qa-e2e-access-token' ),
			'refresh_token' => (string) ( $args['refresh_token'] ?? 'qa-e2e-refresh-token' ),
			'expires_in'    => (int) ( $args['expires_in'] ?? 3600 ),
		],
		is_array( $args['connected_user'] ?? null ) ? $args['connected_user'] : []
	);
}

/** Removes the seeded OAuth connection. */
function beehiiv_e2e_clear_connection(): void {
	\Beehiiv\OAuth\TokenStore::delete_all();
}

/**
 * Seeds the publications list cache, skipping the real GET /publications call.
 *
 * @param array<int, array{id: string, name: string}> $publications
 */
function beehiiv_e2e_seed_publications( array $publications ): void {
	\Beehiiv\API\Cache::set_publications( $publications );
}

/**
 * Seeds the post-templates cache for one publication, skipping the real
 * GET /publications/{id}/post_templates call.
 *
 * @param string                                       $publication_id
 * @param array<int, array{id: string, name: string}>  $templates
 */
function beehiiv_e2e_seed_post_templates( string $publication_id, array $templates ): void {
	\Beehiiv\API\Cache::set_post_templates( $publication_id, $templates );
}

/**
 * Resets every seam this file installs: all HTTP mocks, OAuth connection,
 * and all beehiiv transient caches. Call in afterAll() so one spec's
 * mocked "connected" state never leaks into the next sequential
 * qa-e2e-author run against this shared environment.
 */
function beehiiv_e2e_reset_all(): void {
	beehiiv_e2e_clear_http_mocks();
	beehiiv_e2e_clear_http_log();
	delete_option( 'beehiiv_e2e_force_settings_status' );
	beehiiv_e2e_clear_connection();
	\Beehiiv\API\Cache::flush_all();
}

/**
 * Records one mocked outbound request (method, URL, decoded JSON body, and
 * the mock key that answered it) so specs can assert what the plugin
 * actually sent to beehiiv. Only mocked requests are logged.
 *
 * @param string     $method HTTP method.
 * @param string     $url    Request URL.
 * @param mixed      $body   Raw request body.
 * @param string     $mock   Key of the mock that answered.
 */
function beehiiv_e2e_log_http( string $method, string $url, $body, string $mock ): void {
	$log     = get_option( 'beehiiv_e2e_http_log', [] );
	$log     = is_array( $log ) ? $log : [];
	$decoded = is_string( $body ) ? json_decode( $body, true ) : $body;
	$log[]   = [
		'method' => $method,
		'url'    => $url,
		'body'   => null === $decoded ? $body : $decoded,
		'mock'   => $mock,
	];
	update_option( 'beehiiv_e2e_http_log', $log, false );
}

/** Clears the mocked-request log. */
function beehiiv_e2e_clear_http_log(): void {
	delete_option( 'beehiiv_e2e_http_log' );
}

/**
 * Third-party filter stand-in for BR-005: when the
 * `beehiiv_e2e_force_settings_status` option is set, the public
 * `beehiiv_newsletter_post_settings` filter rewrites the payload to that
 * status and adds a `scheduled_at`, the way a hostile/careless third-party
 * filter could -- so specs can check the plugin forces test drafts back to
 * draft *after* this filter runs.
 */
add_filter(
	'beehiiv_newsletter_post_settings',
	static function ( $settings ) {
		$status = get_option( 'beehiiv_e2e_force_settings_status', '' );

		if ( ! is_array( $settings ) || ! is_string( $status ) || '' === $status ) {
			return $settings;
		}

		$settings['status']       = $status;
		$settings['scheduled_at'] = gmdate( 'c', time() + DAY_IN_SECONDS );

		return $settings;
	},
	999
);
