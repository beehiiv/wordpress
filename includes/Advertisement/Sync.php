<?php
/**
 * Keeps advertisement reservations in sync with post content.
 *
 * @package beehiiv
 */

namespace Beehiiv\Advertisement;

use WP_Post;

defined( 'ABSPATH' ) || exit;

/**
 * Reconciles the reservation map whenever a post is saved or deleted.
 *
 * @since 1.0.0
 */
final class Sync {

	/**
	 * Advertisement block name.
	 *
	 * @since 1.0.0
	 */
	private const BLOCK_NAME = 'beehiiv/advertisement';

	/**
	 * Register hooks.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public static function init(): void {

		add_action( 'save_post', [ self::class, 'on_save_post' ], 10, 2 );
		add_action( 'before_delete_post', [ self::class, 'on_delete_post' ] );
	}

	/**
	 * Reconcile the post's reservation from its current block content.
	 *
	 * @since 1.0.0
	 *
	 * @param int     $post_id Post ID.
	 * @param WP_Post $post    Post object.
	 *
	 * @return void
	 */
	public static function on_save_post( int $post_id, WP_Post $post ): void {

		if ( wp_is_post_autosave( $post_id ) || wp_is_post_revision( $post_id ) ) {
			return;
		}

		Reservations::reconcile_for_post( $post_id, self::find_selected_ad_id( $post->post_content ) );
	}

	/**
	 * Release the post's reservation when it is deleted.
	 *
	 * @since 1.0.0
	 *
	 * @param int $post_id Post ID.
	 *
	 * @return void
	 */
	public static function on_delete_post( int $post_id ): void {

		Reservations::release_for_post( $post_id );
	}

	/**
	 * Find the advertisement ID selected in a post's content.
	 *
	 * The block is limited to one instance per post, so the first match wins.
	 *
	 * @since 1.0.0
	 *
	 * @param string $content Post content.
	 *
	 * @return string Selected ad ID, or empty string when none.
	 */
	private static function find_selected_ad_id( string $content ): string {

		if ( false === strpos( $content, self::BLOCK_NAME ) ) {
			return '';
		}

		foreach ( parse_blocks( $content ) as $block ) {
			if ( isset( $block['blockName'] ) && self::BLOCK_NAME === $block['blockName'] ) {
				return isset( $block['attrs']['adId'] ) ? trim( (string) $block['attrs']['adId'] ) : '';
			}
		}

		return '';
	}
}
