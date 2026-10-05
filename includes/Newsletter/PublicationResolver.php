<?php
/**
 * Per-post beehiiv publication resolution.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter;

use Beehiiv\Admin\Options;
use Beehiiv\API\Resources\Publications;
use Beehiiv\Editor\Meta;

defined( 'ABSPATH' ) || exit;

/**
 * Decides which beehiiv publication a post's newsletter uses.
 *
 * The site-wide publication setting is the default. A post may choose its own
 * publication; once its beehiiv post exists, every later action targets the
 * publication that beehiiv post was created in.
 *
 * @since x.x.x
 */
final class PublicationResolver {

	/**
	 * Site-wide default publication ID from the plugin settings.
	 *
	 * @return string
	 * @since x.x.x
	 */
	public static function get_default_publication_id(): string {
		$settings = Options::get();

		return trim( (string) ( $settings['publication_id'] ?? '' ) );
	}

	/**
	 * Publications connected to the beehiiv account (cached list).
	 *
	 * @return array<int, array{id: string, name: string}>
	 * @since x.x.x
	 */
	public static function get_connected_publications(): array {
		return Publications::get_publications();
	}

	/**
	 * Publications offered in the editor's selector.
	 *
	 * Falls back to the default publication alone when the connected list is
	 * unavailable, so a beehiiv outage does not block sending.
	 *
	 * @return array<int, array{id: string, name: string}>
	 * @since x.x.x
	 */
	public static function get_editor_publications(): array {
		$publications = self::get_connected_publications();

		if ( ! empty( $publications ) ) {
			return array_values( $publications );
		}

		$default_id = self::get_default_publication_id();

		if ( '' === $default_id ) {
			return [];
		}

		return [
			[
				'id'   => $default_id,
				'name' => $default_id,
			],
		];
	}

	/**
	 * Whether a publication is still connected to the beehiiv account.
	 *
	 * @param string $publication_id Publication ID.
	 * @return bool|null Null when the connected list is unavailable.
	 * @since x.x.x
	 */
	public static function is_connected_publication( string $publication_id ): ?bool {
		$publications = self::get_connected_publications();

		if ( empty( $publications ) ) {
			return null;
		}

		foreach ( $publications as $publication ) {
			if ( isset( $publication['id'] ) && $publication_id === (string) $publication['id'] ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Display name of a publication, or its ID when the name is unknown.
	 *
	 * @param string $publication_id Publication ID.
	 * @return string
	 * @since x.x.x
	 */
	public static function get_publication_name( string $publication_id ): string {
		foreach ( self::get_connected_publications() as $publication ) {
			if ( isset( $publication['id'] ) && $publication_id === (string) $publication['id'] ) {
				$name = trim( (string) ( $publication['name'] ?? '' ) );

				return '' !== $name ? $name : $publication_id;
			}
		}

		return $publication_id;
	}

	/**
	 * Publication the post's newsletter should be created in.
	 *
	 * - No stored publication: the site-wide default.
	 * - Stored and connected (or the connected list is unavailable): the stored one.
	 * - Stored but no longer connected: the site-wide default, with `fallback_from`
	 *   set to the stored publication.
	 *
	 * @param int $post_id Post ID.
	 * @return array{publication_id: string, is_default: bool, fallback_from: string}
	 * @since x.x.x
	 */
	public static function resolve_target( int $post_id ): array {
		$default_id = self::get_default_publication_id();
		$stored_id  = trim( (string) get_post_meta( $post_id, Meta::BEEHIIV_PUBLICATION_ID, true ) );

		if ( '' === $stored_id || $stored_id === $default_id ) {
			return [
				'publication_id' => $default_id,
				'is_default'     => true,
				'fallback_from'  => '',
			];
		}

		if ( false === self::is_connected_publication( $stored_id ) && '' !== $default_id ) {
			return [
				'publication_id' => $default_id,
				'is_default'     => true,
				'fallback_from'  => $stored_id,
			];
		}

		return [
			'publication_id' => $stored_id,
			'is_default'     => false,
			'fallback_from'  => '',
		];
	}

	/**
	 * Publication the post's linked beehiiv post lives in.
	 *
	 * Posts linked before per-post publications existed have no record and use
	 * the site-wide default.
	 *
	 * @param int $post_id Post ID.
	 * @return string
	 * @since x.x.x
	 */
	public static function get_linked_publication_id( int $post_id ): string {
		$linked_id = trim( (string) get_post_meta( $post_id, Meta::BEEHIIV_LINKED_PUBLICATION_ID, true ) );

		return '' !== $linked_id ? $linked_id : self::get_default_publication_id();
	}

	/**
	 * Publication to use for any beehiiv action on the post.
	 *
	 * The linked publication when the post has a beehiiv post, otherwise the
	 * resolved target.
	 *
	 * @param int $post_id Post ID.
	 * @return string
	 * @since x.x.x
	 */
	public static function resolve_for_post( int $post_id ): string {
		$beehiiv_post_id = trim( (string) get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true ) );

		if ( '' !== $beehiiv_post_id ) {
			return self::get_linked_publication_id( $post_id );
		}

		return self::resolve_target( $post_id )['publication_id'];
	}
}
