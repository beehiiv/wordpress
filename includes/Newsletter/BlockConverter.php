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
 * Supported WordPress blocks (mapped in `convert_supported_blocks()`):
 *
 * - Featured image (post thumbnail) — `convert_post_thumbnail()` (NOT IMPLEMENTED YET)
 * - `core/heading` — `convert_heading_block()` (NOT IMPLEMENTED YET)
 * - `core/paragraph` — `convert_paragraph_block()` (NOT IMPLEMENTED YET)
 * - `core/image` — `convert_image_block()` (NOT IMPLEMENTED YET)
 * - `core/list` — `convert_list_block()` (NOT IMPLEMENTED YET)
 * - `core/table` — `convert_table_block()` (NOT IMPLEMENTED YET)
 * - `core/quote` — `convert_quote_block()` (NOT IMPLEMENTED YET)
 * - `core/pullquote` — `convert_pullquote_block()` (NOT IMPLEMENTED YET)
 * - `core/embed` — `convert_embed_block()` (NOT IMPLEMENTED YET)
 * - `core/media-text` — `convert_media_text_block()` (NOT IMPLEMENTED YET)
 * - `core/buttons` / inner `core/button` — `convert_buttons_block()`, `convert_button_block()` (NOT IMPLEMENTED YET)
 * - `core/separator` — Beehiiv `content_break` (implemented)
 * - `core/more` — snippet newsletters only; Beehiiv Read More `button` via `convert_more_block()` (implemented)
 *
 * Layout blocks (`core/group`, `core/columns`, etc.) and all other unsupported
 * block types are skipped along with their inner blocks. Snippet mode stops at
 * `core/more`.
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
	public static function convert_supported_blocks( WP_Post $post_object ): array {
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

		$converted_blocks = self::convert_blocks(
			$wp_blocks,
			$post_object,
			$is_send_newsletter_snippet
		);

		return array_values(
			array_filter(
				array_merge( $beehiiv_blocks, $converted_blocks )
			)
		);
	}

	/**
	 * Recursively convert parsed WordPress blocks to Beehiiv blocks.
	 *
	 * @param array<int, array<string, mixed>> $wp_blocks                  Parsed blocks.
	 * @param WP_Post                          $post_object                Post object.
	 * @param bool                             $is_send_newsletter_snippet Whether snippet mode is enabled.
	 * @return array<int, array<string, mixed>>
	 * @since 1.0.0
	 */
	private static function convert_blocks(
		array $wp_blocks,
		WP_Post $post_object,
		bool $is_send_newsletter_snippet
	): array {
		$beehiiv_blocks = [];

		foreach ( $wp_blocks as $wp_block ) {
			if ( empty( $wp_block['blockName'] ) ) {
				continue;
			}

			$block_name = (string) $wp_block['blockName'];

			if ( $is_send_newsletter_snippet && 'core/more' === $block_name ) {
				$beehiiv_blocks[] = self::convert_more_block( (string) get_permalink( $post_object ) );
				break;
			}

			if ( ! SupportedBlocks::is_supported( $block_name, $is_send_newsletter_snippet ) ) {
				continue;
			}

			if ( 'core/buttons' === $block_name ) {
				$button_blocks  = self::convert_buttons_block( $wp_block );
				$beehiiv_blocks = array_merge( $beehiiv_blocks, $button_blocks );
				continue;
			}

			$beehiiv_block = self::convert_block( $wp_block );

			if ( ! empty( $beehiiv_block ) ) {
				$beehiiv_blocks[] = $beehiiv_block;
			}
		}

		return $beehiiv_blocks;
	}

	/**
	 * Convert a single supported WordPress block.
	 *
	 * @param array<string, mixed> $wp_block Parsed block.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	private static function convert_block( array $wp_block ): array {
		switch ( $wp_block['blockName'] ) {
			case 'core/heading':
				return self::convert_heading_block( $wp_block );
			case 'core/separator':
				return [
					'type' => 'content_break',
				];
			case 'core/paragraph':
				return self::convert_paragraph_block( $wp_block );
			case 'core/image':
				return self::convert_image_block( $wp_block );
			case 'core/list':
				return self::convert_list_block( $wp_block );
			case 'core/table':
				return self::convert_table_block( $wp_block );
			case 'core/quote':
				return self::convert_quote_block( $wp_block );
			case 'core/pullquote':
				return self::convert_pullquote_block( $wp_block );
			case 'core/embed':
				return self::convert_embed_block( $wp_block );
			case 'core/media-text':
				return self::convert_media_text_block( $wp_block );
		}

		return [];
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
