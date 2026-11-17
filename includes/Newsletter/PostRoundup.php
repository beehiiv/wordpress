<?php
/**
 * The Post Roundup block: post resolver, editor availability and send-time expansion.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter;

use Beehiiv\Newsletter\Converters\ColumnsBlockConverter;
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

	public const LAYOUT_FULL = 'full';

	/**
	 * Card layouts and the share of the card width the image takes.
	 *
	 * The ratio is image to text, so 30-70 gives the image 30 percent.
	 *
	 * @since x.x.x
	 */
	public const LAYOUT_IMAGE_WIDTH = [
		'50-50' => 50,
		'30-70' => 30,
		'70-30' => 70,
	];

	/**
	 * Card items the author can show or hide.
	 *
	 * @since x.x.x
	 */
	public const DISPLAY_ITEMS = [ 'image', 'title', 'excerpt', 'button' ];

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
	 * Snapshot key of a roundup block: its stored id, else its position among the
	 * top-level roundups. A roundup inside a layout block has no stable position, so
	 * without a stored id it is keyed by its own settings.
	 *
	 * @param array<string, mixed> $attrs   Block attributes.
	 * @param int|null             $ordinal Position among the top-level roundups, null when nested.
	 * @return string
	 * @since x.x.x
	 */
	public static function block_key( array $attrs, ?int $ordinal ): string {
		$uid = isset( $attrs['uid'] ) ? sanitize_key( (string) $attrs['uid'] ) : '';

		if ( '' !== $uid ) {
			return $uid;
		}

		return null === $ordinal ? 'x' . substr( md5( (string) wp_json_encode( $attrs ) ), 0, 8 ) : 'n' . $ordinal;
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
				'id'           => $post->ID,
				'title'        => self::plain_text( get_the_title( $post ) ),
				'url'          => (string) get_permalink( $post ),
				'excerpt'      => trim(
					html_entity_decode( wp_strip_all_tags( get_the_excerpt( $post ) ), ENT_QUOTES, 'UTF-8' )
				),
				'image_url'    => $image_url ? (string) $image_url : '',
				'image_alt'    => is_string( $alt ) ? trim( wp_strip_all_tags( $alt ) ) : '',
				'button_label' => __( 'Read more', 'beehiiv' ),
			];
		}

		return $cards;
	}

	/**
	 * Which card items a block shows. Every item is shown unless turned off.
	 *
	 * @param array<string, mixed> $attrs Block attributes.
	 * @return array<string, bool>
	 * @since x.x.x
	 */
	public static function display( array $attrs ): array {
		$stored  = isset( $attrs['display'] ) && is_array( $attrs['display'] ) ? $attrs['display'] : [];
		$display = [];

		foreach ( self::DISPLAY_ITEMS as $item ) {
			$is_set           = array_key_exists( $item, $stored );
			$display[ $item ] = ! $is_set || filter_var( $stored[ $item ], FILTER_VALIDATE_BOOLEAN );
		}

		return $display;
	}

	/**
	 * Card layout of a block: full width, or image beside the text at a ratio.
	 *
	 * @param array<string, mixed> $attrs Block attributes.
	 * @return string `full` or a key of {@see LAYOUT_IMAGE_WIDTH}.
	 * @since x.x.x
	 */
	public static function layout( array $attrs ): string {
		$layout = $attrs['layout'] ?? self::LAYOUT_FULL;

		return is_string( $layout ) && isset( self::LAYOUT_IMAGE_WIDTH[ $layout ] ) ? $layout : self::LAYOUT_FULL;
	}

	/**
	 * Side the image sits on when a card is split. Defaults to left.
	 *
	 * @param array<string, mixed> $attrs Block attributes.
	 * @return string `left` or `right`.
	 * @since x.x.x
	 */
	public static function image_placement( array $attrs ): string {
		return isset( $attrs['imagePlacement'] ) && 'right' === $attrs['imagePlacement'] ? 'right' : 'left';
	}

	/**
	 * Plain-text card edits stored on the block, keyed by post ID.
	 *
	 * Text is stripped of markup. An image must be an image attachment. An empty
	 * value means "use the post's own value".
	 *
	 * @param array<string, mixed> $attrs Block attributes.
	 * @return array<int, array{title: string, excerpt: string, button_label: string, image_id: int}>
	 * @since x.x.x
	 */
	public static function overrides( array $attrs ): array {
		$overrides = [];

		foreach ( (array) ( $attrs['overrides'] ?? [] ) as $id => $values ) {
			if ( ! is_numeric( $id ) || (int) $id <= 0 || ! is_array( $values ) ) {
				continue;
			}

			$image_id = isset( $values['imageId'] ) ? absint( $values['imageId'] ) : 0;

			$overrides[ (int) $id ] = [
				'title'        => self::plain_text( $values['title'] ?? '' ),
				'excerpt'      => self::plain_text( $values['excerpt'] ?? '' ),
				'button_label' => self::plain_text( $values['buttonLabel'] ?? '' ),
				'image_id'     => $image_id && wp_attachment_is_image( $image_id ) ? $image_id : 0,
			];
		}

		return $overrides;
	}

	/**
	 * Strip markup from an edited value and decode entities.
	 *
	 * @param mixed $value Stored value.
	 * @return string
	 * @since x.x.x
	 */
	private static function plain_text( $value ): string {
		if ( ! is_string( $value ) ) {
			return '';
		}

		return trim( html_entity_decode( wp_strip_all_tags( $value ), ENT_QUOTES, 'UTF-8' ) );
	}

	/**
	 * Apply a block's card edits and display choices to the cards of its posts.
	 *
	 * A hidden item is blanked. An edit replaces the post's value only when it is
	 * not empty. The link always stays the post's own permalink.
	 *
	 * @param array<int, array<string, mixed>> $cards Cards from {@see cards()}.
	 * @param array<string, mixed>             $attrs Block attributes.
	 * @return array<int, array<string, mixed>>
	 * @since x.x.x
	 */
	public static function apply_settings( array $cards, array $attrs ): array {
		$display   = self::display( $attrs );
		$overrides = self::overrides( $attrs );
		$result    = [];

		foreach ( $cards as $card ) {
			$edit = $overrides[ (int) $card['id'] ] ?? null;

			if ( null !== $edit ) {
				foreach ( [ 'title', 'excerpt', 'button_label' ] as $field ) {
					if ( '' !== $edit[ $field ] ) {
						$card[ $field ] = $edit[ $field ];
					}
				}

				if ( $edit['image_id'] ) {
					$image_url = wp_get_attachment_image_url( $edit['image_id'], self::IMAGE_SIZE );
					$alt       = get_post_meta( $edit['image_id'], '_wp_attachment_image_alt', true );

					if ( $image_url ) {
						$card['image_url'] = (string) $image_url;
						$card['image_alt'] = is_string( $alt ) ? trim( wp_strip_all_tags( $alt ) ) : '';
					}
				}
			}

			if ( ! $display['image'] ) {
				$card['image_url'] = '';
			}

			if ( ! $display['title'] ) {
				$card['title'] = '';
			}

			if ( ! $display['excerpt'] ) {
				$card['excerpt'] = '';
			}

			if ( ! $display['button'] ) {
				$card['button_label'] = '';
			}

			$result[] = $card;
		}

		return $result;
	}

	/**
	 * Expand a roundup block into beehiiv blocks.
	 *
	 * Per post: an image (when there is one), a bold linked title paragraph (a
	 * heading cannot carry a link), an excerpt paragraph and a button, with a
	 * separator between posts. Items the author turned off are left out, and the
	 * author's card edits replace the post's own values.
	 *
	 * @param array<string, mixed> $attrs   Block attributes.
	 * @param int                  $post_id Newsletter post ID.
	 * @param string               $key     Snapshot key of the block.
	 * @param bool                 $separate Whether to put a separator between cards. Off inside a column.
	 * @return array<int, array<string, mixed>>
	 * @since x.x.x
	 */
	public static function expand( array $attrs, int $post_id, string $key, bool $separate = true ): array {
		$blocks = [];

		$cards = self::apply_settings( self::cards( self::resolve_ids( $attrs, $post_id, $key ) ), $attrs );

		foreach ( $cards as $card ) {
			$card_blocks = self::card_blocks( $card, self::layout( $attrs ), self::image_placement( $attrs ) );

			// A card with every item turned off adds nothing, not even a separator.
			if ( empty( $card_blocks ) ) {
				continue;
			}

			if ( $separate && ! empty( $blocks ) ) {
				$blocks[] = [ 'type' => 'content_break' ];
			}

			$blocks = array_merge( $blocks, $card_blocks );
		}

		return $blocks;
	}

	/**
	 * Beehiiv blocks for one card, through the existing converters.
	 *
	 * With a split layout and an image, the image is one column and the text is the
	 * other, so beehiiv shows them side by side. A card with no image stays full width.
	 *
	 * @param array<string, mixed> $card      Card data from {@see cards()}.
	 * @param string               $layout    Card layout.
	 * @param string               $placement Image side for a split layout.
	 * @return array<int, array<string, mixed>>
	 * @since x.x.x
	 */
	private static function card_blocks(
		array $card,
		string $layout = self::LAYOUT_FULL,
		string $placement = 'left'
	): array {
		$url    = esc_url( $card['url'] );
		$blocks = [];
		$image  = [];

		if ( '' !== $card['image_url'] ) {
			$image = BlockConverter::convert_image_block(
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

		if ( '' !== $card['title'] ) {
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
		}

		if ( '' !== $card['excerpt'] ) {
			$blocks[] = BlockConverter::convert_paragraph_block(
				[
					'blockName' => 'core/paragraph',
					'attrs'     => [],
					'innerHTML' => '<p>' . esc_html( $card['excerpt'] ) . '</p>',
				]
			);
		}

		if ( '' !== $card['button_label'] ) {
			$blocks[] = BlockConverter::convert_button_block(
				[
					'blockName' => 'core/button',
					'attrs'     => [],
					'innerHTML' => sprintf(
						'<div class="wp-block-button"><a class="wp-block-button__link" href="%1$s">%2$s</a></div>',
						$url,
						esc_html( $card['button_label'] )
					),
				]
			);
		}

		$text  = array_values( array_filter( $blocks ) );
		$image = array_filter( $image );

		if ( empty( $image ) ) {
			return $text;
		}

		if ( self::LAYOUT_FULL === $layout || empty( $text ) ) {
			return array_merge( [ $image ], $text );
		}

		return [ self::split_blocks( $image, $text, $layout, $placement ) ];
	}

	/**
	 * Image and text as two beehiiv columns, widths following the layout ratio.
	 *
	 * @param array<string, mixed>             $image     Converted image block.
	 * @param array<int, array<string, mixed>> $text      Converted text blocks.
	 * @param string                           $layout    A key of {@see LAYOUT_IMAGE_WIDTH}.
	 * @param string                           $placement `left` or `right`.
	 * @return array<string, mixed>
	 * @since x.x.x
	 */
	private static function split_blocks( array $image, array $text, string $layout, string $placement ): array {
		unset( $image['imageAlignment'] );

		$image_width = self::LAYOUT_IMAGE_WIDTH[ $layout ];

		$image_column = ColumnsBlockConverter::build_beehiiv_column_from_definition(
			[ $image ],
			$image_width,
			'top'
		);
		$text_column  = ColumnsBlockConverter::build_beehiiv_column_from_definition(
			$text,
			100 - $image_width,
			'top'
		);

		return ColumnsBlockConverter::build_beehiiv_columns_block(
			'right' === $placement ? [ $text_column, $image_column ] : [ $image_column, $text_column ],
			true
		);
	}
}
