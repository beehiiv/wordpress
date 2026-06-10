<?php
/**
 * Encrypted OAuth credential storage.
 *
 * @package beehiiv
 */

namespace Beehiiv\OAuth;

use Beehiiv\Security\DataEncryption;

defined( 'ABSPATH' ) || exit;

/**
 * Persists OAuth tokens in a single WordPress option.
 *
 * @since 1.0.0
 */
final class TokenStore {

	/**
	 * WordPress option name for OAuth credentials.
	 *
	 * @since 1.0.0
	 */
	public const OPTION_NAME = 'beehiiv_oauth';

	/**
	 * Encryption helper.
	 *
	 * @var DataEncryption|null
	 */
	private static $encryption = null;

	/**
	 * Whether valid OAuth credentials exist.
	 *
	 * @since 1.0.0
	 *
	 * @return bool
	 */
	public static function has_credentials(): bool {

		return '' !== self::get_client_id() && '' !== self::get_access_token();
	}

	/**
	 * Stored client ID (decrypted).
	 *
	 * @since 1.0.0
	 *
	 * @return string
	 */
	public static function get_client_id(): string {

		$data = self::get();

		return self::decrypt_field( $data, 'client_id' );
	}

	/**
	 * Stored access token (decrypted).
	 *
	 * @since 1.0.0
	 *
	 * @return string
	 */
	public static function get_access_token(): string {

		$data = self::get();

		return self::decrypt_field( $data, 'access_token' );
	}

	/**
	 * Stored refresh token (decrypted).
	 *
	 * @since 1.0.0
	 *
	 * @return string
	 */
	public static function get_refresh_token(): string {

		$data = self::get();

		return self::decrypt_field( $data, 'refresh_token' );
	}

	/**
	 * Access token expiry timestamp.
	 *
	 * @since 1.0.0
	 *
	 * @return int
	 */
	public static function get_expires_at(): int {

		$data = self::get();

		return isset( $data['expires_at'] ) ? (int) $data['expires_at'] : 0;
	}

	/**
	 * Connected Beehiiv user info for admin UI.
	 *
	 * @since 1.0.0
	 *
	 * @return array<string, mixed>
	 */
	public static function get_connected_user(): array {

		$data = self::get();
		$user = isset( $data['connected_user'] ) && is_array( $data['connected_user'] )
			? $data['connected_user']
			: [];

		return $user;
	}

	/**
	 * Save OAuth token response and optional connected user.
	 *
	 * @param string              $client_id   OAuth client ID.
	 * @param array<string,mixed> $token_body  Token endpoint JSON body.
	 * @param array<string,mixed> $connected_user Optional identify response.
	 *
	 * @since 1.0.0
	 *
	 * @return bool
	 */
	public static function save_tokens( string $client_id, array $token_body, array $connected_user = [] ): bool {

		$access_token  = isset( $token_body['access_token'] ) ? (string) $token_body['access_token'] : '';
		$refresh_token = isset( $token_body['refresh_token'] ) ? (string) $token_body['refresh_token'] : '';
		$expires_in    = isset( $token_body['expires_in'] ) ? (int) $token_body['expires_in'] : 0;
		$scope         = isset( $token_body['scope'] ) ? (string) $token_body['scope'] : Config::SCOPES;

		if ( '' === $client_id || '' === $access_token ) {
			return false;
		}

		if ( '' === $refresh_token ) {
			$refresh_token = self::get_refresh_token();
		}

		$encrypted_client_id = self::encrypt_value( $client_id );
		$encrypted_access    = self::encrypt_value( $access_token );
		$encrypted_refresh   = '' !== $refresh_token ? self::encrypt_value( $refresh_token ) : '';

		if ( false === $encrypted_client_id || false === $encrypted_access ) {
			return false;
		}

		$data = [
			'client_id'     => $encrypted_client_id,
			'access_token'  => $encrypted_access,
			'refresh_token' => $encrypted_refresh,
			'expires_at'    => time() + max( 0, $expires_in ),
			'scope'         => $scope,
		];

		if ( ! empty( $connected_user ) ) {
			$data['connected_user'] = self::sanitize_connected_user( $connected_user );
		} elseif ( ! empty( self::get_connected_user() ) ) {
			$data['connected_user'] = self::get_connected_user();
		}

		return update_option( self::OPTION_NAME, $data, false );
	}

	/**
	 * Save only the client ID after dynamic registration.
	 *
	 * @param string $client_id Registered client ID.
	 *
	 * @since 1.0.0
	 *
	 * @return bool
	 */
	public static function save_client_id( string $client_id ): bool {

		$client_id = trim( $client_id );

		if ( '' === $client_id ) {
			return false;
		}

		$encrypted = self::encrypt_value( $client_id );

		if ( false === $encrypted ) {
			return false;
		}

		$data               = self::get();
		$data['client_id']  = $encrypted;
		$data['expires_at'] = isset( $data['expires_at'] ) ? (int) $data['expires_at'] : 0;

		unset( $data['oauth_scope'] );

		return update_option( self::OPTION_NAME, $data, false );
	}

	/**
	 * Remove stored client registration so the next connect re-registers.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public static function clear_client_registration(): void {

		$data = self::get();

		unset( $data['client_id'], $data['oauth_scope'] );

		if ( empty( $data ) ) {
			delete_option( self::OPTION_NAME );
			return;
		}

		update_option( self::OPTION_NAME, $data, false );
	}

	/**
	 * Update connected user display data.
	 *
	 * @param array<string,mixed> $connected_user Identify endpoint response.
	 *
	 * @since 1.0.0
	 *
	 * @return bool
	 */
	public static function save_connected_user( array $connected_user ): bool {

		$data                   = self::get();
		$data['connected_user'] = self::sanitize_connected_user( $connected_user );

		return update_option( self::OPTION_NAME, $data, false );
	}

	/**
	 * Delete all stored OAuth credentials.
	 *
	 * @since 1.0.0
	 *
	 * @return bool
	 */
	public static function delete_all(): bool {

		return delete_option( self::OPTION_NAME );
	}

	/**
	 * Raw stored option value.
	 *
	 * @since 1.0.0
	 *
	 * @return array<string, mixed>
	 */
	private static function get(): array {

		$saved = get_option( self::OPTION_NAME, [] );

		return is_array( $saved ) ? $saved : [];
	}

	/**
	 * Decrypt a stored credential field.
	 *
	 * @since 1.0.0
	 *
	 * @param array<string,mixed> $data Stored option data.
	 * @param string              $key  Field key.
	 *
	 * @return string
	 */
	private static function decrypt_field( array $data, string $key ): string {

		if ( ! isset( $data[ $key ] ) || ! is_string( $data[ $key ] ) || '' === $data[ $key ] ) {
			return '';
		}

		$decrypted = self::encryption()->decrypt( $data[ $key ] );

		return is_string( $decrypted ) && false !== $decrypted ? $decrypted : '';
	}

	/**
	 * Encrypt a credential value.
	 *
	 * @since 1.0.0
	 *
	 * @param string $value Plaintext value.
	 *
	 * @return string|bool
	 */
	private static function encrypt_value( string $value ): string|bool {

		return self::encryption()->encrypt( $value );
	}

	/**
	 * Shared encryption instance.
	 *
	 * @since 1.0.0
	 *
	 * @return DataEncryption
	 */
	private static function encryption(): DataEncryption {

		if ( null === self::$encryption ) {
			self::$encryption = new DataEncryption();
		}

		return self::$encryption;
	}

	/**
	 * Sanitize connected user fields for storage.
	 *
	 * @since 1.0.0
	 *
	 * @param array<string,mixed> $user Raw identify response.
	 *
	 * @return array<string, string>
	 */
	private static function sanitize_connected_user( array $user ): array {

		return [
			'first_name'      => isset( $user['first_name'] ) ? sanitize_text_field( (string) $user['first_name'] ) : '',
			'last_name'       => isset( $user['last_name'] ) ? sanitize_text_field( (string) $user['last_name'] ) : '',
			'email'           => isset( $user['email'] ) ? sanitize_email( (string) $user['email'] ) : '',
			'profile_picture' => isset( $user['profile_picture'] ) ? esc_url_raw( (string) $user['profile_picture'] ) : '',
		];
	}
}
