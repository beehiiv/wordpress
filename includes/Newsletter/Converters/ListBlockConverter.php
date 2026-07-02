<?php
/**
 * Converts WordPress core/list blocks to beehiiv list blocks.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter\Converters;

use Beehiiv\Newsletter\FormattedTextParser;

defined( 'ABSPATH' ) || exit;

/**
 * Helpers for mapping core/list and core/list-item blocks to beehiiv list blocks.
 *
 * @since 1.0.0
 */
final class ListBlockConverter {

	/**
	 * Build a beehiiv list block from converted items.
	 *
	 * @param array<int, string|array<string, mixed>> $items             List items.
	 * @param string                                  $list_type         `ordered` or `unordered`.
	 * @param int|null                                $start_number      Ordered-list start value.
	 * @param string|null                             $background_color  Block background colour.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function build_beehiiv_list_block(
		array $items,
		string $list_type,
		?int $start_number,
		?string $background_color = null
	): array {
		$beehiiv_block = [
			'type'     => 'list',
			'items'    => $items,
			'listType' => $list_type,
		];

		if ( 'ordered' === $list_type && null !== $start_number && $start_number > 1 ) {
			$beehiiv_block['startNumber'] = $start_number;
		}

		if ( null !== $background_color && '' !== $background_color ) {
			$beehiiv_block['visual_settings'] = [
				'background_color' => $background_color,
			];
		}

		return $beehiiv_block;
	}

	/**
	 * Convert a core/list-item block to a beehiiv list item.
	 *
	 * @param array<string, mixed> $list_item_block        Parsed list-item block.
	 * @param string|null          $parent_list_text_color Text colour from the parent core/list block.
	 * @return string|array<string, mixed>|null
	 * @since 1.0.0
	 */
	public static function convert_list_item_to_beehiiv_item(
		array $list_item_block,
		?string $parent_list_text_color = null
	) {
		$attrs      = $list_item_block['attrs'] ?? [];
		$inner_html = (string) ( $list_item_block['innerHTML'] ?? '' );

		if ( '' === trim( $inner_html ) ) {
			return null;
		}

		if ( ! self::html_contains_tag( $inner_html, 'li' ) ) {
			return null;
		}

		$inline_html = self::extract_tag_inner_html( $inner_html, 'li' );
		$inline_html = self::strip_nested_list_markup( $inline_html );
		$inline_html = trim( $inline_html );

		if ( '' === $inline_html ) {
			return null;
		}

		$item_text_color = FormattedTextParser::resolve_list_item_block_text_color( $inner_html, $attrs );
		$default_color   = null !== $item_text_color ? $item_text_color : $parent_list_text_color;
		$parsed          = FormattedTextParser::parse( $inline_html, $default_color );

		if ( '' === trim( $parsed['plaintext'] ) ) {
			return null;
		}

		if ( FormattedTextParser::has_rich_formatting( $parsed['formattedText'] ) ) {
			return [
				'formattedText' => $parsed['formattedText'],
			];
		}

		return $parsed['plaintext'];
	}

	/**
	 * Collect list items from a core/list block, flattening nested lists in place.
	 *
	 * Nested items are prefixed with `  - ` for each nesting level so they read
	 * as indented sub-items within the parent list. List text colour cascades to
	 * nested lists and items unless a closer ancestor sets its own colour.
	 *
	 * @param array<string, mixed> $list_block                 Parsed core/list block.
	 * @param int                  $depth                      Current nesting depth (0 = top level).
	 * @param string|null          $inherited_list_text_color  Text colour from an ancestor list block.
	 * @return array<int, string|array<string, mixed>>
	 * @since 1.0.0
	 */
	public static function collect_flat_list_items(
		array $list_block,
		int $depth = 0,
		?string $inherited_list_text_color = null
	): array {
		$attrs        = $list_block['attrs'] ?? [];
		$inner_html   = (string) ( $list_block['innerHTML'] ?? '' );
		$inner_blocks = $list_block['innerBlocks'] ?? [];
		$list_color   = FormattedTextParser::resolve_list_block_text_color( $inner_html, $attrs );
		$list_color   = null !== $list_color ? $list_color : $inherited_list_text_color;
		$items        = [];

		foreach ( $inner_blocks as $list_item_block ) {
			if ( 'core/list-item' !== ( $list_item_block['blockName'] ?? '' ) ) {
				continue;
			}

			$beehiiv_item = self::convert_list_item_to_beehiiv_item( $list_item_block, $list_color );

			if ( null !== $beehiiv_item ) {
				$items[] = self::apply_nesting_prefix( $beehiiv_item, $depth );
			}

			foreach ( self::get_nested_list_blocks( $list_item_block ) as $nested_list_block ) {
				$items = array_merge(
					$items,
					self::collect_flat_list_items( $nested_list_block, $depth + 1, $list_color )
				);
			}
		}

		return $items;
	}

	/**
	 * Prefix a list item to reflect nesting depth.
	 *
	 * @param string|array<string, mixed> $item  Converted list item.
	 * @param int                         $depth Nesting depth (0 = no prefix).
	 * @return string|array<string, mixed>
	 * @since 1.0.0
	 */
	private static function apply_nesting_prefix( $item, int $depth ) {
		if ( $depth <= 0 ) {
			return $item;
		}

		$prefix = str_repeat( '  - ', $depth );

		if ( is_string( $item ) ) {
			return $prefix . $item;
		}

		if ( ! is_array( $item ) || empty( $item['formattedText'] ) || ! is_array( $item['formattedText'] ) ) {
			return $item;
		}

		$formatted_text = $item['formattedText'];

		if ( ! empty( $formatted_text[0]['text'] ) && is_string( $formatted_text[0]['text'] ) ) {
			$formatted_text[0]['text'] = $prefix . $formatted_text[0]['text'];
		} else {
			$prefix_segment = [
				'text' => $prefix,
			];

			if ( ! empty( $formatted_text[0]['text_color'] ) && is_string( $formatted_text[0]['text_color'] ) ) {
				$prefix_segment['text_color'] = $formatted_text[0]['text_color'];
			}

			array_unshift( $formatted_text, $prefix_segment );
		}

		return [
			'formattedText' => $formatted_text,
		];
	}

	/**
	 * Resolve the ordered-list start number from block attrs or saved markup.
	 *
	 * @param array<string, mixed> $attrs      Parsed list block attributes.
	 * @param string               $inner_html Saved list HTML.
	 * @return int|null
	 * @since 1.0.0
	 */
	public static function resolve_list_start_number( array $attrs, string $inner_html ): ?int {
		if ( empty( $attrs['ordered'] ) ) {
			return null;
		}

		if ( isset( $attrs['start'] ) && is_numeric( $attrs['start'] ) ) {
			$start = (int) $attrs['start'];

			return $start > 0 ? $start : null;
		}

		$processor = new \WP_HTML_Tag_Processor( $inner_html );

		if ( $processor->next_tag( 'OL' ) ) {
			$start_attr = $processor->get_attribute( 'start' );

			if ( null !== $start_attr && is_numeric( $start_attr ) ) {
				$start = (int) $start_attr;

				return $start > 0 ? $start : null;
			}
		}

		return null;
	}

	/**
	 * Extract nested core/list blocks from a list-item block.
	 *
	 * @param array<string, mixed> $list_item_block Parsed list-item block.
	 * @return array<int, array<string, mixed>>
	 * @since 1.0.0
	 */
	public static function get_nested_list_blocks( array $list_item_block ): array {
		$inner_blocks = $list_item_block['innerBlocks'] ?? [];
		$nested_lists = [];

		foreach ( $inner_blocks as $inner_block ) {
			if ( 'core/list' === ( $inner_block['blockName'] ?? '' ) ) {
				$nested_lists[] = $inner_block;
			}
		}

		return $nested_lists;
	}

	/**
	 * Whether saved HTML contains an opening tag.
	 *
	 * @param string $html Saved HTML.
	 * @param string $tag  Tag name.
	 * @return bool
	 * @since 1.0.0
	 */
	private static function html_contains_tag( string $html, string $tag ): bool {
		$processor = new \WP_HTML_Tag_Processor( $html );

		return $processor->next_tag( strtoupper( $tag ) );
	}

	/**
	 * Extract inner HTML from the first matching tag.
	 *
	 * Uses the WordPress HTML Tag Processor to locate the tag, then regex for
	 * inner content — the same pattern as button label extraction.
	 *
	 * @param string $html Saved element HTML.
	 * @param string $tag  Wrapper tag name.
	 * @return string
	 * @since 1.0.0
	 */
	private static function extract_tag_inner_html( string $html, string $tag ): string {
		if ( ! self::html_contains_tag( $html, $tag ) ) {
			return $html;
		}

		$pattern = sprintf(
			'/<%1$s[^>]*>(.*?)<\/%1$s>/is',
			preg_quote( $tag, '/' )
		);

		if ( preg_match( $pattern, $html, $matches ) ) {
			return $matches[1];
		}

		return $html;
	}

	/**
	 * Remove nested list markup from list-item inline HTML.
	 *
	 * @param string $html Inline HTML extracted from a list item.
	 * @return string
	 * @since 1.0.0
	 */
	private static function strip_nested_list_markup( string $html ): string {
		$previous = null;

		while ( $previous !== $html ) {
			$previous = $html;
			$html     = (string) preg_replace( '/<(ul|ol)\b[^>]*>[\s\S]*?<\/\1>/i', '', $html );
		}

		return $html;
	}
}
