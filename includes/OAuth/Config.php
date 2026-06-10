<?php
/**
 * OAuth URLs and shared configuration.
 *
 * @package beehiiv
 */

namespace Beehiiv\OAuth;

defined( 'ABSPATH' ) || exit;

/**
 * Beehiiv OAuth endpoints and scopes.
 *
 * @since 1.0.0
 */
final class Config {

	/**
	 * Admin page slug for the OAuth callback.
	 *
	 * @since 1.0.0
	 */
	public const CALLBACK_PAGE = 'beehiiv-oauth-callback';

	/**
	 * OAuth scopes for WordPress clients.
	 *
	 * @since 1.0.0
	 */
	public const SCOPES = 'identify:read publications:read posts:write';

	/**
	 * Placeholder replaced at plugin release build time.
	 *
	 * @since 1.0.0
	 */
	public const REGISTRATION_TOKEN_PLACEHOLDER = 'BEEHIIV_REGISTRATION_TOKEN_PLACEHOLDER';

	/**
	 * WP-config.php constant for registration token override.
	 *
	 * @since 1.0.0
	 */
	private const REGISTRATION_TOKEN_CONST = 'BEEHIIV_REGISTRATION_TOKEN';

	/**
	 * Seconds before access token expiry to refresh proactively.
	 *
	 * @since 1.0.0
	 */
	public const REFRESH_BUFFER_SECONDS = 300;

	/**
	 * PKCE/state transient TTL in seconds.
	 *
	 * @since 1.0.0
	 */
	public const PKCE_TRANSIENT_TTL = 600;

	/**
	 * OAuth app base URL.
	 *
	 * @since 1.0.0
	 *
	 * @return string
	 */
	public static function get_oauth_base_url(): string {

		return 'https://app.beehiiv.com';
	}

	/**
	 * Beehiiv public API base URL.
	 *
	 * @since 1.0.0
	 *
	 * @return string
	 */
	public static function get_api_base_url(): string {

		return 'https://api.beehiiv.com/v2';
	}

	/**
	 * Registration token for dynamic client registration.
	 *
	 * @since 1.0.0
	 *
	 * @return string
	 */
	public static function get_registration_token(): string {

		if ( defined( self::REGISTRATION_TOKEN_CONST ) ) {
			// phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedConstantFound -- Consumed from wp-config.php.
			$token = (string) constant( self::REGISTRATION_TOKEN_CONST );
			if ( '' !== trim( $token ) ) {
				return trim( $token );
			}
		}

		return self::REGISTRATION_TOKEN_PLACEHOLDER;
	}

	/**
	 * Whether the registration token is configured for connect.
	 *
	 * @since 1.0.0
	 *
	 * @return bool
	 */
	public static function has_registration_token(): bool {

		$token = self::get_registration_token();

		return '' !== $token && self::REGISTRATION_TOKEN_PLACEHOLDER !== $token;
	}

	/**
	 * OAuth redirect URI for this WordPress install.
	 *
	 * @since 1.0.0
	 *
	 * @return string
	 */
	public static function get_redirect_uri(): string {

		return admin_url( 'admin.php?page=' . self::CALLBACK_PAGE );
	}

	/**
	 * Register hooks for OAuth-related WordPress integration.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public static function register_hooks(): void {

		add_filter( 'allowed_redirect_hosts', [ self::class, 'add_allowed_redirect_hosts' ] );
	}

	/**
	 * Whitelist Beehiiv OAuth hosts for wp_safe_redirect().
	 *
	 * @since 1.0.0
	 *
	 * @param string[] $hosts Allowed redirect hosts.
	 *
	 * @return string[]
	 */
	public static function add_allowed_redirect_hosts( array $hosts ): array {

		return array_merge( $hosts, self::get_oauth_redirect_hosts() );
	}

	/**
	 * Known Beehiiv OAuth app hostnames.
	 *
	 * @since 1.0.0
	 *
	 * @return string[]
	 */
	public static function get_oauth_redirect_hosts(): array {

		return [
			'app.beehiiv.com',
		];
	}
}
