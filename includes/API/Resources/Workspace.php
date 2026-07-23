<?php
/**
 * Beehiiv API: Workspace resource.
 *
 * @package beehiiv
 */

namespace Beehiiv\API\Resources;

use Beehiiv\API\Client;

defined( 'ABSPATH' ) || exit;

/**
 * Workspace endpoints.
 *
 * @link https://developers.beehiiv.com/api-reference/workspaces/permissions
 * @since 1.0.0
 */
final class Workspace {

	/**
	 * Retrieve the permissions granted to the connected OAuth token.
	 *
	 * Keys are resource names (e.g. `posts`); values are granted actions
	 * (`read` and/or `write`). `posts` write is only present when Send API
	 * is enabled for the workspace.
	 *
	 * @since 1.0.0
	 *
	 * @return array<string, array<int, string>>|null
	 */
	public static function get_permissions(): ?array {

		$response = Client::request( '/workspaces/permissions' );
		$data     = isset( $response['data'] ) && is_array( $response['data'] ) ? $response['data'] : null;

		if ( null === $data ) {
			return null;
		}

		$out = [];

		foreach ( $data as $resource => $actions ) {
			if ( ! is_string( $resource ) || ! is_array( $actions ) ) {
				continue;
			}

			$normalized = [];

			foreach ( $actions as $action ) {
				if ( is_string( $action ) && '' !== $action ) {
					$normalized[] = $action;
				}
			}

			$out[ $resource ] = $normalized;
		}

		return $out;
	}

	/**
	 * Whether the connected token can write posts (Send API enabled).
	 *
	 * @since 1.0.0
	 */
	public static function can_write_posts(): bool {

		$permissions = self::get_permissions();

		if ( null === $permissions ) {
			return false;
		}

		$posts = $permissions['posts'] ?? [];

		return in_array( 'write', $posts, true );
	}
}
