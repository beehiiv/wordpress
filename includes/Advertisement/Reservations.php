<?php
/**
 * Tracks which advertisement opportunity each post has reserved.
 *
 * @package beehiiv
 */

namespace Beehiiv\Advertisement;

defined( 'ABSPATH' ) || exit;

/**
 * Persists a map of reserved advertisement opportunities in a single option.
 *
 * An advertisement opportunity may only be used by one post at a time. The map
 * is keyed by ad ID so reservations resolve to at most one owning post:
 * `[ ad_id => post_id ]`.
 *
 * @since 1.0.0
 */
final class Reservations {

	/**
	 * Option name storing the `[ ad_id => post_id ]` reservation map.
	 *
	 * @since 1.0.0
	 */
	private const OPTION_NAME = 'beehiiv_ad_reservations';

	/**
	 * Reserve an advertisement opportunity for a post.
	 *
	 * Drops any reservation currently owned by the post, then records the new
	 * selection. An empty `$ad_id` releases the post's reservation.
	 *
	 * @since 1.0.0
	 *
	 * @param int    $post_id Post ID.
	 * @param string $ad_id   Advertisement opportunity ID, or empty to release.
	 *
	 * @return void
	 */
	public static function reconcile_for_post( int $post_id, string $ad_id ): void {

		$ad_id = trim( $ad_id );
		$map   = self::get_map();

		// Remove any ad currently owned by this post.
		$map = array_filter(
			$map,
			static function ( $owner_post_id ) use ( $post_id ) {
				return (int) $owner_post_id !== $post_id;
			}
		);

		if ( '' !== $ad_id ) {
			$map[ $ad_id ] = $post_id;
		}

		self::save_map( $map );
	}

	/**
	 * Release every reservation owned by a post.
	 *
	 * @since 1.0.0
	 *
	 * @param int $post_id Post ID.
	 *
	 * @return void
	 */
	public static function release_for_post( int $post_id ): void {

		$map = self::get_map();

		$filtered = array_filter(
			$map,
			static function ( $owner_post_id ) use ( $post_id ) {
				return (int) $owner_post_id !== $post_id;
			}
		);

		if ( count( $filtered ) !== count( $map ) ) {
			self::save_map( $filtered );
		}
	}

	/**
	 * Advertisement IDs reserved by posts other than the given one.
	 *
	 * @since 1.0.0
	 *
	 * @param int $post_id Post ID to exclude (keeps that post's own selection available).
	 *
	 * @return array<int, string>
	 */
	public static function reserved_ad_ids_excluding_post( int $post_id ): array {

		$reserved = [];

		foreach ( self::get_map() as $ad_id => $owner_post_id ) {
			if ( (int) $owner_post_id !== $post_id ) {
				$reserved[] = (string) $ad_id;
			}
		}

		return $reserved;
	}

	/**
	 * Drop reservations for ads no longer offered by the API.
	 *
	 * When beehiiv stops returning an ad (used or expired) its reservation is
	 * released so the slot frees up for other posts.
	 *
	 * @since 1.0.0
	 *
	 * @param array<int, string> $available_ad_ids Advertisement IDs still offered by the API.
	 *
	 * @return void
	 */
	public static function prune_missing( array $available_ad_ids ): void {

		$map = self::get_map();

		$filtered = array_filter(
			$map,
			static function ( $owner_post_id, $ad_id ) use ( $available_ad_ids ) {
				unset( $owner_post_id );

				return in_array( (string) $ad_id, $available_ad_ids, true );
			},
			ARRAY_FILTER_USE_BOTH
		);

		if ( count( $filtered ) !== count( $map ) ) {
			self::save_map( $filtered );
		}
	}

	/**
	 * Read the reservation map.
	 *
	 * @since 1.0.0
	 *
	 * @return array<string, int>
	 */
	private static function get_map(): array {

		$map = get_option( self::OPTION_NAME, [] );

		return is_array( $map ) ? $map : [];
	}

	/**
	 * Persist the reservation map.
	 *
	 * @since 1.0.0
	 *
	 * @param array<string, int> $map Reservation map.
	 *
	 * @return void
	 */
	private static function save_map( array $map ): void {

		update_option( self::OPTION_NAME, $map, false );
	}
}
