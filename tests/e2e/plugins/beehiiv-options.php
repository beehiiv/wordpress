<?php
/**
 * Plugin Name: beehiiv E2E Test Options
 * Description: Test-only seams for Playwright specs under tests/e2e. Loaded
 * as an mu-plugin in wp-env's dedicated *tests* environment only (see
 * .wp-env.json's env.tests.mappings) -- never present in dev or production.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Short-circuits beehiiv's live GET /workspaces/permissions call so specs
 * can exercise the Workspace::can_write_posts()-gated settings UI (the
 * publication/template dropdowns, plan-gating notices) without a real
 * OAuth connection or beehiiv account -- the one live network call in that
 * flow with no other seam (publications/templates are already cacheable
 * via the seed helpers below).
 *
 * Opt-in via the `beehiiv_e2e_permissions_mock` option: when unset, this
 * filter is a no-op and every request passes through to the real beehiiv
 * API unchanged, so specs relying on genuine "not connected" / genuine 401
 * behavior (e.g. connection-status-card) are unaffected.
 */
add_filter(
	'pre_http_request',
	static function ( $preempt, $parsed_args, $url ) {
		if ( false === strpos( $url, '/workspaces/permissions' ) ) {
			return $preempt;
		}

		$mock = get_option( 'beehiiv_e2e_permissions_mock', null );

		if ( ! is_array( $mock ) ) {
			return $preempt;
		}

		return [
			'headers'  => [],
			'body'     => wp_json_encode( [ 'data' => $mock ] ),
			'response' => [
				'code'    => 200,
				'message' => 'OK',
			],
			'cookies'  => [],
			'filename' => null,
		];
	},
	10,
	3
);

/**
 * Sets the mocked /workspaces/permissions response for the current test.
 *
 * Call via `wp eval`, e.g. from a spec's wp-cli helper:
 *   wp eval 'beehiiv_e2e_mock_permissions( [ "posts" => [ "read", "write" ] ] );'
 *   wp eval 'beehiiv_e2e_mock_permissions( [ "posts" => [ "read" ] ] );' // connected, read-only
 *
 * @param array<string,array<int,string>> $permissions Resource => granted actions.
 */
function beehiiv_e2e_mock_permissions( array $permissions ): void {
	update_option( 'beehiiv_e2e_permissions_mock', $permissions, false );
}

/** Clears the permissions mock, restoring real network behavior. */
function beehiiv_e2e_clear_permissions_mock(): void {
	delete_option( 'beehiiv_e2e_permissions_mock' );
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
 * Resets every seam this file installs: permissions mock, OAuth connection,
 * and all beehiiv transient caches. Call in afterAll() so one spec's
 * mocked "connected" state never leaks into the next sequential
 * qa-e2e-author run against this shared environment.
 */
function beehiiv_e2e_reset_all(): void {
	beehiiv_e2e_clear_permissions_mock();
	beehiiv_e2e_clear_connection();
	\Beehiiv\API\Cache::flush_all();
}
