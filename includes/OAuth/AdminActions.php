<?php
/**
 * Admin actions for OAuth connect and disconnect.
 *
 * @package beehiiv
 */

namespace Beehiiv\OAuth;

use Beehiiv\Config as PluginConfig;

defined( 'ABSPATH' ) || exit;

/**
 * Handles admin_post connect/disconnect actions.
 *
 * @since 1.0.0
 */
final class AdminActions {

	/**
	 * Connect action name.
	 *
	 * @since 1.0.0
	 */
	public const ACTION_CONNECT = 'beehiiv_oauth_connect';

	/**
	 * Disconnect action name.
	 *
	 * @since 1.0.0
	 */
	public const ACTION_DISCONNECT = 'beehiiv_oauth_disconnect';

	/**
	 * Register admin_post handlers and admin notices.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public static function init(): void {

		add_action( 'admin_post_' . self::ACTION_CONNECT, [ self::class, 'handle_connect' ] );
		add_action( 'admin_post_' . self::ACTION_DISCONNECT, [ self::class, 'handle_disconnect' ] );
		add_action( 'admin_notices', [ self::class, 'render_notice' ] );
	}

	/**
	 * Start the OAuth authorization flow.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public static function handle_connect(): void {

		self::verify_request();

		$authorize_url = Authorization::get_authorize_url();

		if ( is_wp_error( $authorize_url ) ) {
			self::redirect_with_notice(
				admin_url( 'admin.php?page=' . PluginConfig::PLUGIN_SLUG ),
				'beehiiv_oauth_connect_failed',
				$authorize_url->get_error_message(),
				'error'
			);
		}

		wp_safe_redirect( $authorize_url );
		exit;
	}

	/**
	 * Disconnect the Beehiiv account.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public static function handle_disconnect(): void {

		self::verify_request();

		Revoker::disconnect();

		self::redirect_with_notice(
			admin_url( 'admin.php?page=' . PluginConfig::PLUGIN_SLUG ),
			'beehiiv_oauth_disconnected',
			__( 'Disconnected from Beehiiv.', 'beehiiv' ),
			'success'
		);
	}

	/**
	 * Render a one-time admin notice after OAuth redirect.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public static function render_notice(): void {

		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$key    = 'beehiiv_admin_notice_' . get_current_user_id();
		$notice = get_transient( $key );

		if ( ! is_array( $notice ) || empty( $notice['message'] ) ) {
			return;
		}

		delete_transient( $key );

		$type    = isset( $notice['type'] ) && 'error' === $notice['type'] ? 'error' : 'success';
		$classes = 'notice notice-' . $type . ' is-dismissible';

		printf(
			'<div class="%1$s"><p>%2$s</p></div>',
			esc_attr( $classes ),
			esc_html( (string) $notice['message'] )
		);
	}

	/**
	 * Verify capability and nonce for admin actions.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	private static function verify_request(): void {

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You do not have permission to manage Beehiiv settings.', 'beehiiv' ) );
		}

		check_admin_referer( 'beehiiv_oauth_action' );
	}

	/**
	 * Redirect with a transient admin notice.
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
