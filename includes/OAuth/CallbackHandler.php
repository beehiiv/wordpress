<?php
/**
 * OAuth authorization callback handler.
 *
 * @package beehiiv
 */

namespace Beehiiv\OAuth;

use Beehiiv\API\Cache;
use Beehiiv\API\Client;
use Beehiiv\Config as PluginConfig;

defined( 'ABSPATH' ) || exit;

/**
 * Handles the OAuth redirect callback in wp-admin.
 *
 * @since 1.0.0
 */
final class CallbackHandler {

	/**
	 * Register callback hooks.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public static function init(): void {

		add_action( 'admin_init', [ self::class, 'maybe_handle' ], 1 );
	}

	/**
	 * Register the hidden callback admin page.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public static function register_page(): void {

		add_submenu_page(
			null,
			__( 'beehiiv OAuth Callback', 'beehiiv' ),
			__( 'beehiiv OAuth Callback', 'beehiiv' ),
			'manage_options',
			Config::CALLBACK_PAGE,
			'__return_null'
		);
	}

	/**
	 * Process the OAuth callback before admin output is sent.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public static function maybe_handle(): void {

		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- OAuth callback route check.
		if (
			! isset( $_GET['page'] ) ||
			Config::CALLBACK_PAGE !== sanitize_text_field( wp_unslash( (string) $_GET['page'] ) ) ) {
			return;
		}
		// phpcs:enable WordPress.Security.NonceVerification.Recommended

		self::process();
	}

	/**
	 * Process the OAuth callback and redirect to settings.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	private static function process(): void {

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You do not have permission to connect beehiiv.', 'beehiiv' ) );
		}

		$settings_url = admin_url( 'admin.php?page=' . PluginConfig::PLUGIN_SLUG );

		// OAuth callback is validated via the state transient (CSRF), not a WP nonce.
		// OAuth state validation.
		// phpcs:disable WordPress.Security.NonceVerification.Recommended
		$error             = isset( $_GET['error'] ) ?
			sanitize_text_field( wp_unslash( (string) $_GET['error'] ) ) : '';
		$error_description = isset( $_GET['error_description'] )
			? sanitize_text_field( wp_unslash( (string) $_GET['error_description'] ) )
			: '';
		// phpcs:enable WordPress.Security.NonceVerification.Recommended

		if ( '' !== $error || '' !== $error_description ) {
			if ( self::is_scope_error( $error, $error_description ) ) {
				TokenStore::clear_client_registration();
			}

			$message = '' !== $error_description
				? $error_description
				: __( 'beehiiv connection was cancelled or denied.', 'beehiiv' );

			self::redirect_with_notice(
				$settings_url,
				'beehiiv_oauth_denied',
				$message,
				'error'
			);
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- OAuth state validation.
		$code = isset( $_GET['code'] ) ? sanitize_text_field( wp_unslash( (string) $_GET['code'] ) ) : '';
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- OAuth state validation.
		$state = isset( $_GET['state'] ) ? sanitize_text_field( wp_unslash( (string) $_GET['state'] ) ) : '';

		if ( '' === $code || ! Authorization::validate_state( $state ) ) {
			self::redirect_with_notice(
				$settings_url,
				'beehiiv_oauth_invalid',
				__( 'Invalid beehiiv connection response. Please try again.', 'beehiiv' ),
				'error'
			);
		}

		$code_verifier = Authorization::consume_code_verifier();

		if ( '' === $code_verifier ) {
			self::redirect_with_notice(
				$settings_url,
				'beehiiv_oauth_expired',
				__( 'The beehiiv connection session expired. Please try again.', 'beehiiv' ),
				'error'
			);
		}

		$client_id = TokenStore::get_client_id();

		if ( '' === $client_id ) {
			self::redirect_with_notice(
				$settings_url,
				'beehiiv_oauth_client_missing',
				__( 'beehiiv client credentials are missing. Please try again.', 'beehiiv' ),
				'error'
			);
		}

		$response = HttpClient::post_form(
			'/oauth/token',
			[
				'grant_type'    => 'authorization_code',
				'code'          => $code,
				'redirect_uri'  => Config::get_redirect_uri(),
				'client_id'     => $client_id,
				'code_verifier' => $code_verifier,
			]
		);

		if ( null !== $response['error'] || 200 !== $response['status'] || ! is_array( $response['body'] ) ) {
			self::redirect_with_notice(
				$settings_url,
				'beehiiv_oauth_token_failed',
				__( 'Could not complete the beehiiv connection. Please try again.', 'beehiiv' ),
				'error'
			);
		}

		if ( ! TokenStore::save_tokens( $client_id, $response['body'] ) ) {
			self::redirect_with_notice(
				$settings_url,
				'beehiiv_oauth_storage_failed',
				__( 'Could not save beehiiv credentials on this site.', 'beehiiv' ),
				'error'
			);
		}

		$connected_user = Client::request( '/users/identify' );

		if ( is_array( $connected_user ) && ! empty( $connected_user ) ) {
			TokenStore::save_connected_user( $connected_user );
		}

		Cache::flush_all();

		self::redirect_with_notice(
			$settings_url,
			'beehiiv_oauth_connected',
			__( 'Successfully connected to beehiiv.', 'beehiiv' ),
			'success'
		);
	}

	/**
	 * Whether the OAuth error relates to invalid scopes.
	 *
	 * @since 1.0.0
	 *
	 * @param string $error             OAuth error code.
	 * @param string $error_description OAuth error description.
	 *
	 * @return bool
	 */
	private static function is_scope_error( string $error, string $error_description ): bool {

		if ( 'invalid_scope' === $error ) {
			return true;
		}

		return false !== stripos( $error_description, 'scope' );
	}

	/**
	 * Redirect to settings with an admin notice.
	 *
	 * @since 1.0.0
	 *
	 * @param string $url     Redirect URL.
	 * @param string $code    Notice code.
	 * @param string $message Notice message.
	 * @param string $type    Notice type.
	 *
	 * @return void
	 */
	private static function redirect_with_notice( string $url, string $code, string $message, string $type ): void {

		set_transient(
			'beehiiv_admin_notice_' . get_current_user_id(),
			[
				'code'    => $code,
				'message' => $message,
				'type'    => $type,
			],
			30
		);

		wp_safe_redirect( $url );
		exit;
	}
}
