<?php
/**
 * Converts WordPress block content to Beehiiv newsletter blocks.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter;

use Beehiiv\Editor\Meta;
use WP_Post;

defined( 'ABSPATH' ) || exit;

/**
 * Walks parsed block editor content and builds the Beehiiv `blocks` array.
 *
 * Supported WordPress blocks (mapped in `convert()`):
 *
 * - Featured image (post thumbnail) — `convert_post_thumbnail()` (stub)
 * - `core/heading` — `convert_heading_block()` (stub)
 * - `core/paragraph` — `convert_paragraph_block()` (stub)
 * - `core/image` — `convert_image_block()` (stub)
 * - `core/list` — `convert_list_block()` (stub)
 * - `core/table` — `convert_table_block()` (stub)
 * - `core/quote` — `convert_quote_block()` (stub)
 * - `core/pullquote` — `convert_pullquote_block()` (stub)
 * - `core/embed` — `convert_embed_block()` (stub)
 * - `core/media-text` — `convert_media_text_block()` (stub)
 * - `core/buttons` / inner `core/button` — `convert_buttons_block()`, `convert_button_block()` (stub)
 * - `core/separator` — Beehiiv `content_break` (implemented)
 * - `core/more` — snippet newsletters only; Beehiiv Read More `button` via `convert_more_block()` (implemented)
 *
 * All other block types are skipped. Snippet mode stops at `core/more`.
 *
 * @since 1.0.0
 */
final class BlockConverter {

	/**
	 * Convert a WordPress post's blocks to Beehiiv blocks.
	 *
	 * @param WP_Post $post_object Post object.
	 * @return array<int, array<string, mixed>>
	 * @since 1.0.0
	 */
	public static function convert( WP_Post $post_object ): array {
		$beehiiv_blocks = [];
		$wp_blocks      = parse_blocks( $post_object->post_content );

		if ( has_post_thumbnail( $post_object ) ) {
			$thumbnail_block = self::convert_post_thumbnail( (int) get_post_thumbnail_id( $post_object ) );
			if ( ! empty( $thumbnail_block ) ) {
				$beehiiv_blocks[] = $thumbnail_block;
			}
		}

		$is_send_newsletter_snippet = (bool) get_post_meta(
			$post_object->ID,
			Meta::SEND_TO_NEWSLETTER_SNIPPET,
			true
		);

		foreach ( $wp_blocks as $wp_block ) {
			if ( empty( $wp_block['blockName'] ) ) {
				continue;
			}

			if ( $is_send_newsletter_snippet && 'core/more' === $wp_block['blockName'] ) {
				$beehiiv_blocks[] = self::convert_more_block( (string) get_permalink( $post_object ) );
				break;
			}

			// Handle buttons block separately as it returns multiple blocks.
			if ( 'core/buttons' === $wp_block['blockName'] ) {
				$button_blocks  = self::convert_buttons_block( $wp_block );
				$beehiiv_blocks = array_merge( $beehiiv_blocks, $button_blocks );
				continue;
			}

			$beehiiv_block = [];

			// Loop through all other blocks and convert them to Beehiiv blocks.
			switch ( $wp_block['blockName'] ) {
				case 'core/heading':
					$beehiiv_block = self::convert_heading_block( $wp_block );
					break;
				case 'core/separator':
					$beehiiv_block = [
						'type' => 'content_break',
					];
					break;
				case 'core/paragraph':
					$beehiiv_block = self::convert_paragraph_block( $wp_block );
					break;
				case 'core/image':
					$beehiiv_block = self::convert_image_block( $wp_block );
					break;
				case 'core/list':
					$beehiiv_block = self::convert_list_block( $wp_block );
					break;
				case 'core/table':
					$beehiiv_block = self::convert_table_block( $wp_block );
					break;
				case 'core/quote':
					$beehiiv_block = self::convert_quote_block( $wp_block );
					break;
				case 'core/pullquote':
					$beehiiv_block = self::convert_pullquote_block( $wp_block );
					break;
				case 'core/embed':
					$beehiiv_block = self::convert_embed_block( $wp_block );
					break;
				case 'core/media-text':
					$beehiiv_block = self::convert_media_text_block( $wp_block );
					break;
			}

			if ( ! empty( $beehiiv_block ) ) {
				$beehiiv_blocks[] = $beehiiv_block;
			}
		}

		return array_values( array_filter( $beehiiv_blocks ) );
	}

	/**
	 * Convert post thumbnail to a Beehiiv image block.
	 *
	 * @param int $thumbnail_id Attachment ID.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function convert_post_thumbnail( int $thumbnail_id ): array {
		unset( $thumbnail_id );

		return [];
	}

	/**
	 * Convert a core/heading block.
	 *
	 * @param array<string, mixed> $wp_block Parsed block.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function convert_heading_block( array $wp_block ): array {
		unset( $wp_block );

		return [];
	}

	/**
	 * Convert a core/paragraph block.
	 *
	 * @param array<string, mixed> $wp_block Parsed block.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function convert_paragraph_block( array $wp_block ): array {
		unset( $wp_block );

		return [];
	}

	/**
	 * Convert a core/image block.
	 *
	 * @param array<string, mixed> $wp_block Parsed block.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function convert_image_block( array $wp_block ): array {
		unset( $wp_block );

		return [];
	}

	/**
	 * Convert a core/list block.
	 *
	 * @param array<string, mixed> $wp_block Parsed block.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function convert_list_block( array $wp_block ): array {
		unset( $wp_block );

		return [];
	}

	/**
	 * Convert a core/table block.
	 *
	 * @param array<string, mixed> $wp_block Parsed block.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function convert_table_block( array $wp_block ): array {
		unset( $wp_block );

		return [];
	}

	/**
	 * Convert a core/buttons block (may yield multiple Beehiiv blocks).
	 *
	 * @param array<string, mixed> $wp_block Parsed block.
	 * @return array<int, array<string, mixed>>
	 * @since 1.0.0
	 */
	public static function convert_buttons_block( array $wp_block ): array {
		unset( $wp_block );

		return [];
	}

	/**
	 * Convert a single button inner block.
	 *
	 * @param array<string, mixed> $wp_block   Parsed block.
	 * @param string               $alignment Button alignment.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function convert_button_block( array $wp_block, string $alignment = 'left' ): array {
		unset( $wp_block, $alignment );

		return [];
	}

	/**
	 * Convert a core/quote block.
	 *
	 * @param array<string, mixed> $wp_block Parsed block.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function convert_quote_block( array $wp_block ): array {
		unset( $wp_block );

		return [];
	}

	/**
	 * Convert a core/pullquote block.
	 *
	 * @param array<string, mixed> $wp_block Parsed block.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function convert_pullquote_block( array $wp_block ): array {
		unset( $wp_block );

		return [];
	}

	/**
	 * Convert a core/embed block.
	 *
	 * @param array<string, mixed> $wp_block Parsed block.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function convert_embed_block( array $wp_block ): array {
		unset( $wp_block );

		return [];
	}

	/**
	 * Convert a core/media-text block.
	 *
	 * @param array<string, mixed> $wp_block Parsed block.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function convert_media_text_block( array $wp_block ): array {
		unset( $wp_block );

		return [];
	}

	/**
	 * Convert the WordPress more block to a Read More button (snippet newsletters).
	 *
	 * @param string $post_permalink Post permalink.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function convert_more_block( string $post_permalink ): array {
		return [
			'type'      => 'button',
			'href'      => $post_permalink,
			'text'      => 'Read More',
			'alignment' => 'center',
			'size'      => 'large',
			'target'    => '_blank',
		];
	}
}
