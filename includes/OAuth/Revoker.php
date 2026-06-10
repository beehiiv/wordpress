<?php
/**
 * OAuth disconnect and credential cleanup.
 *
 * @package beehiiv
 */

namespace Beehiiv\OAuth;

use Beehiiv\API\Cache;
use Beehiiv\Config as PluginConfig;

defined( 'ABSPATH' ) || exit;

/**
 * Revokes tokens and clears plugin connection data.
 *
 * @since 1.0.0
 */
final class Revoker {

	/**
	 * Revoke OAuth tokens and clear stored credentials.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public static function disconnect(): void {

		$client_id     = TokenStore::get_client_id();
		$access_token  = TokenStore::get_access_token();
		$refresh_token = TokenStore::get_refresh_token();
		$token         = '' !== $refresh_token ? $refresh_token : $access_token;

		if ( '' !== $client_id && '' !== $token ) {
			HttpClient::post_form(
				'/oauth/revoke',
				[
					'token'     => $token,
					'client_id' => $client_id,
				]
			);
		}

		TokenStore::delete_all();
		Cache::flush_all();
		self::delete_settings();
	}

	/**
	 * Delete plugin settings after disconnect.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	private static function delete_settings(): void {

		delete_option( PluginConfig::OPTION_NAME );
	}
}
