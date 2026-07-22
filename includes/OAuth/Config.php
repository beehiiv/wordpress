<?php
/**
 * OAuth URLs and shared configuration.
 *
 * @package beehiiv
 */

namespace Beehiiv\OAuth;

defined( 'ABSPATH' ) || exit;

/**
 * OAuth endpoints and scopes for beehiiv.
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
	public const SCOPES = 'identify:read publications:read posts:read posts:write';

	/**
	 * Built-in registration token; replaced at plugin release build time.
	 *
	 * @since 1.0.0
	 */
	private const REGISTRATION_TOKEN = 'BEEHIIV_REGISTRATION_TOKEN_PLACEHOLDER';

	/**
	 * WP-config.php constant for registration token override.
	 *
	 * @since 1.0.0
	 */
	private const REGISTRATION_TOKEN_CONST = 'BEEHIIV_REGISTRATION_TOKEN';

	/**
	 * WP-config.php constant for OAuth app base URL override (local / staging).
	 *
	 * @since 1.0.0
	 */
	private const OAUTH_BASE_URL_CONST = 'BEEHIIV_OAUTH_BASE_URL';

	/**
	 * WP-config.php constant for public API base URL override (local / staging).
	 *
	 * @since 1.0.0
	 */
	private const API_BASE_URL_CONST = 'BEEHIIV_API_BASE_URL';

	/**
	 * Production OAuth app base URL.
	 *
	 * @since 1.0.0
	 */
	private const DEFAULT_OAUTH_BASE_URL = 'https://app.beehiiv.com';

	/**
	 * Production public API base URL.
	 *
	 * @since 1.0.0
	 */
	private const DEFAULT_API_BASE_URL = 'https://api.beehiiv.com/v2';

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

		return self::get_url_constant( self::OAUTH_BASE_URL_CONST, self::DEFAULT_OAUTH_BASE_URL );
	}

	/**
	 * Beehiiv public API base URL.
	 *
	 * @since 1.0.0
	 *
	 * @return string
	 */
	public static function get_api_base_url(): string {

		return self::get_url_constant( self::API_BASE_URL_CONST, self::DEFAULT_API_BASE_URL );
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

		return self::REGISTRATION_TOKEN;
	}

	/**
	 * Whether the registration token is configured for connect.
	 *
	 * @since 1.0.0
	 *
	 * @return bool
	 */
	public static function has_registration_token(): bool {

		$token = trim( self::get_registration_token() );

		return '' !== $token && 'BEEHIIV_REGISTRATION_TOKEN_PLACEHOLDER' !== $token;
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
	 * Whitelist beehiiv OAuth hosts for wp_safe_redirect().
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
	 * Known beehiiv OAuth app hostnames.
	 *
	 * Includes production plus any host from `BEEHIIV_OAUTH_BASE_URL` so local
	 * / staging authorize redirects pass `wp_safe_redirect()`.
	 *
	 * @since 1.0.0
	 *
	 * @return string[]
	 */
	public static function get_oauth_redirect_hosts(): array {

		$hosts = [ 'app.beehiiv.com' ];
		$host  = wp_parse_url( self::get_oauth_base_url(), PHP_URL_HOST );

		if ( is_string( $host ) && '' !== $host && ! in_array( $host, $hosts, true ) ) {
			$hosts[] = $host;
		}

		return $hosts;
	}

	/**
	 * Resolve a URL from an optional wp-config constant.
	 *
	 * @since 1.0.0
	 *
	 * @param string $constant_name Constant name (e.g. BEEHIIV_OAUTH_BASE_URL).
	 * @param string $fallback      Fallback when unset or empty.
	 *
	 * @return string
	 */
	private static function get_url_constant( string $constant_name, string $fallback ): string {

		if ( defined( $constant_name ) ) {
			// phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedConstantFound -- Consumed from wp-config.php.
			$url = trim( (string) constant( $constant_name ) );
			if ( '' !== $url ) {
				return untrailingslashit( $url );
			}
		}

		return $fallback;
	}
}
