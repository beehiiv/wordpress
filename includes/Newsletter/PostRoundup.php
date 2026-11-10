<?php
/**
 * The Post Roundup block: post resolver, editor availability and send-time expansion.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter;

use WP_Block_Editor_Context;
use WP_Block_Type_Registry;
use WP_Post;
use WP_Query;

defined( 'ABSPATH' ) || exit;

/**
 * Resolves which posts a Post Roundup block lists and turns the block into content
 * beehiiv already accepts.
 *
 * The editor preview (REST) and the send step both call {@see resolve_ids()}, so
 * what the author sees is what is sent.
 *
 * @since x.x.x
 */
final class PostRoundup {

	/**
	 * Block name.
	 *
	 * @since x.x.x
	 */
	public const BLOCK = 'beehiiv/post-roundup';

	public const MODE_AUTO   = 'auto';
	public const MODE_MANUAL = 'manual';

	public const DEFAULT_COUNT = 3;
	public const MIN_COUNT     = 1;
	public const MAX_COUNT     = 10;

	/**
	 * Registered image size used for card images.
	 *
	 * @since x.x.x
	 */
	public const IMAGE_SIZE = 'large';

	/**
	 * Register hooks.
	 *
	 * @return void
	 * @since x.x.x
	 */
	public static function init(): void {
		add_filter( 'allowed_block_types_all', [ self::class, 'filter_allowed_blocks' ], 10, 2 );
	}

	/**
	 * Offer the roundup only while writing a newsletter.
	 *
	 * @param bool|string[]           $allowed Allowed block names, or true for all.
	 * @param WP_Block_Editor_Context $context Editor context.
	 * @return bool|string[]
	 * @since x.x.x
	 */
	public static function filter_allowed_blocks( $allowed, $context ) {
		$post = $context instanceof WP_Block_Editor_Context ? $context->post : null;

		if ( $post instanceof WP_Post && ContentTypes::is_newsletter( $post->post_type ) ) {
			return $allowed;
		}

		if ( true === $allowed ) {
			$allowed = array_keys( WP_Block_Type_Registry::get_instance()->get_all_registered() );
		}

		if ( ! is_array( $allowed ) ) {
			return $allowed;
		}

		return array_values( array_diff( $allowed, [ self::BLOCK ] ) );
	}

	/**
	 * Clamp the automatic post count to the allowed range.
	 *
	 * @param mixed $count Requested count.
	 * @return int
	 * @since x.x.x
	 */
	public static function clamp_count( $count ): int {
		if ( ! is_numeric( $count ) ) {
			return self::DEFAULT_COUNT;
		}

		return max( self::MIN_COUNT, min( self::MAX_COUNT, (int) $count ) );
	}

	/**
	 * Mode of a block, defaulting to automatic.
	 *
	 * @param array<string, mixed> $attrs Block attributes.
	 * @return string
	 * @since x.x.x
	 */
	public static function mode( array $attrs ): string {
		return isset( $attrs['mode'] ) && self::MODE_MANUAL === $attrs['mode'] ? self::MODE_MANUAL : self::MODE_AUTO;
	}

	/**
	 * Post IDs picked in manual mode, in the author's order.
	 *
	 * @param array<string, mixed> $attrs Block attributes.
	 * @return int[]
	 * @since x.x.x
	 */
	public static function picked_ids( array $attrs ): array {
		$ids = [];

		foreach ( (array) ( $attrs['posts'] ?? [] ) as $item ) {
			$id = is_array( $item ) ? ( $item['id'] ?? 0 ) : $item;

			if ( is_numeric( $id ) && (int) $id > 0 ) {
				$ids[] = (int) $id;
			}
		}

		return $ids;
	}

	/**
	 * Latest published regular posts, newest first.
	 *
	 * Password-protected posts and the newsletter itself are left out.
	 *
	 * @param int $count      Number of posts.
	 * @param int $exclude_id Newsletter post ID.
	 * @return int[]
	 * @since x.x.x
	 */
	public static function latest_ids( int $count, int $exclude_id ): array {
		$query = new WP_Query(
			[
				'post_type'           => ContentTypes::POST,
				'post_status'         => 'publish',
				'has_password'        => false,
				'posts_per_page'      => self::clamp_count( $count ),
				'orderby'             => 'date',
				'order'               => 'DESC',
				'post__not_in'        => $exclude_id > 0 ? [ $exclude_id ] : [],
				'ignore_sticky_posts' => true,
				'no_found_rows'       => true,
				'fields'              => 'ids',
			]
		);

		return array_map( 'intval', $query->posts );
	}

	/**
	 * Keep only posts a roundup may list, in the given order.
	 *
	 * Drafts, trashed, deleted, password-protected and non-regular posts are skipped.
	 *
	 * @param int[] $ids        Candidate post IDs.
	 * @param int   $exclude_id Newsletter post ID.
	 * @return int[]
	 * @since x.x.x
	 */
	public static function available_ids( array $ids, int $exclude_id ): array {
		$available = [];

		foreach ( array_unique( array_map( 'intval', $ids ) ) as $id ) {
			$post = $id > 0 && $id !== $exclude_id ? get_post( $id ) : null;

			if ( $post instanceof WP_Post
				&& ContentTypes::POST === $post->post_type
				&& 'publish' === $post->post_status
				&& '' === $post->post_password ) {
				$available[] = $id;
			}
		}

		return $available;
	}

	/**
	 * Post IDs a block lists. Shared by the editor preview and the send step.
	 *
	 * In automatic mode a list frozen at send time is used when one exists for the
	 * block and still matches its count; otherwise the latest posts are queried.
	 *
	 * @param array<string, mixed> $attrs   Block attributes.
	 * @param int                  $post_id Newsletter post ID.
	 * @param string               $key     Snapshot key of the block.
	 * @return int[]
	 * @since x.x.x
	 */
	public static function resolve_ids( array $attrs, int $post_id, string $key ): array {
		if ( self::MODE_MANUAL === self::mode( $attrs ) ) {
			return self::available_ids( self::picked_ids( $attrs ), $post_id );
		}

		$count  = self::clamp_count( $attrs['count'] ?? self::DEFAULT_COUNT );
		$frozen = PostRoundupSnapshot::ids_for( $post_id, $key, $count );

		if ( null !== $frozen ) {
			return self::available_ids( $frozen, $post_id );
		}

		return self::latest_ids( $count, $post_id );
	}

	/**
	 * Snapshot key of a top-level roundup block: its stored id, else its position.
	 *
	 * @param array<string, mixed> $attrs   Block attributes.
	 * @param int                  $ordinal Position among the roundup blocks.
	 * @return string
	 * @since x.x.x
	 */
	public static function block_key( array $attrs, int $ordinal ): string {
		$uid = isset( $attrs['uid'] ) ? sanitize_key( (string) $attrs['uid'] ) : '';

		return '' !== $uid ? $uid : 'n' . $ordinal;
	}

	/**
	 * Card data for posts, for the editor preview and the send step.
	 *
	 * @param int[] $ids Post IDs.
	 * @return array<int, array<string, mixed>>
	 * @since x.x.x
	 */
	public static function cards( array $ids ): array {
		$cards = [];

		foreach ( $ids as $id ) {
			$post = get_post( (int) $id );

			if ( ! $post instanceof WP_Post ) {
				continue;
			}

			$thumbnail_id = (int) get_post_thumbnail_id( $post );
			$image_url    = $thumbnail_id ? wp_get_attachment_image_url( $thumbnail_id, self::IMAGE_SIZE ) : false;
			$alt          = $thumbnail_id ? get_post_meta( $thumbnail_id, '_wp_attachment_image_alt', true ) : '';

			$cards[] = [
				'id'        => $post->ID,
				'title'     => html_entity_decode( wp_strip_all_tags( get_the_title( $post ) ), ENT_QUOTES, 'UTF-8' ),
				'url'       => (string) get_permalink( $post ),
				'excerpt'   => trim(
					html_entity_decode( wp_strip_all_tags( get_the_excerpt( $post ) ), ENT_QUOTES, 'UTF-8' )
				),
				'image_url' => $image_url ? (string) $image_url : '',
				'image_alt' => is_string( $alt ) ? trim( wp_strip_all_tags( $alt ) ) : '',
			];
		}

		return $cards;
	}

	/**
	 * Expand a roundup block into beehiiv blocks.
	 *
	 * Per post: an image (when there is a featured image), a bold linked title
	 * paragraph (a heading cannot carry a link), an excerpt paragraph and a Read more
	 * button, with a separator between posts.
	 *
	 * @param array<string, mixed> $attrs   Block attributes.
	 * @param int                  $post_id Newsletter post ID.
	 * @param string               $key     Snapshot key of the block.
	 * @return array<int, array<string, mixed>>
	 * @since x.x.x
	 */
	public static function expand( array $attrs, int $post_id, string $key ): array {
		$blocks = [];

		foreach ( self::cards( self::resolve_ids( $attrs, $post_id, $key ) ) as $card ) {
			if ( ! empty( $blocks ) ) {
				$blocks[] = [ 'type' => 'content_break' ];
			}

			$blocks = array_merge( $blocks, self::card_blocks( $card ) );
		}

		return $blocks;
	}

	/**
	 * Beehiiv blocks for one card, through the existing converters.
	 *
	 * @param array<string, mixed> $card Card data from {@see cards()}.
	 * @return array<int, array<string, mixed>>
	 * @since x.x.x
	 */
	private static function card_blocks( array $card ): array {
		$url    = esc_url( $card['url'] );
		$blocks = [];

		if ( '' !== $card['image_url'] ) {
			$blocks[] = BlockConverter::convert_image_block(
				[
					'blockName' => 'core/image',
					'attrs'     => [],
					'innerHTML' => sprintf(
						'<figure class="wp-block-image"><a href="%1$s"><img src="%2$s" alt="%3$s"/></a></figure>',
						$url,
						esc_url( $card['image_url'] ),
						esc_attr( $card['image_alt'] )
					),
				]
			);
		}

		$blocks[] = BlockConverter::convert_paragraph_block(
			[
				'blockName' => 'core/paragraph',
				'attrs'     => [],
				'innerHTML' => sprintf(
					'<p><strong><a href="%1$s">%2$s</a></strong></p>',
					$url,
					esc_html( $card['title'] )
				),
			]
		);

		if ( '' !== $card['excerpt'] ) {
			$blocks[] = BlockConverter::convert_paragraph_block(
				[
					'blockName' => 'core/paragraph',
					'attrs'     => [],
					'innerHTML' => '<p>' . esc_html( $card['excerpt'] ) . '</p>',
				]
			);
		}

		$blocks[] = BlockConverter::convert_button_block(
			[
				'blockName' => 'core/button',
				'attrs'     => [],
				'innerHTML' => sprintf(
					'<div class="wp-block-button"><a class="wp-block-button__link" href="%1$s">%2$s</a></div>',
					$url,
					esc_html__( 'Read more', 'beehiiv' )
				),
			]
		);

		return array_values( array_filter( $blocks ) );
	}
}
