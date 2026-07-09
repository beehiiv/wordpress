<?php
/**
 * Converts WordPress block content to beehiiv newsletter blocks.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter;

use Beehiiv\Admin\Options;
use Beehiiv\API\Resources\AdvertisementOpportunities;
use Beehiiv\Editor\Meta;
use Beehiiv\Newsletter\Converters\ColumnsBlockConverter;
use Beehiiv\Newsletter\Converters\MediaTextBlockConverter;
use Beehiiv\Newsletter\Converters\TableBlockConverter;
use Beehiiv\Newsletter\Converters\ListBlockConverter;
use WP_Post;

defined( 'ABSPATH' ) || exit;

/**
 * Walks parsed block editor content and builds the beehiiv `blocks` array.
 *
 * Supported WordPress blocks (mapped in `convert_supported_blocks()`):
 *
 * - Featured image (post thumbnail) — `convert_post_thumbnail()`
 * - `core/heading` — `convert_heading_block()`
 * - `core/paragraph` — `convert_paragraph_block()`
 * - `core/image` — `convert_image_block()`
 * - `core/list` — `convert_list_block()` (nested items are flattened into one list with `  - ` indentation)
 * - `core/table` — `convert_table_block()`
 * - `core/quote` — `convert_quote_block()`
 * - `core/pullquote` — `convert_pullquote_block()`
 * - `core/embed` — `convert_embed_block()`
 * - `core/media-text` — `convert_media_text_block()` (beehiiv `columns` block)
 * - `core/buttons` / inner `core/button` — `convert_buttons_block()`, `convert_button_block()`
 * - `core/separator` — beehiiv `content_break`
 * - `core/more` — snippet newsletters only; beehiiv Read More `button` via `convert_more_block()`
 * - `beehiiv/advertisement` — beehiiv `advertisement` block via `convert_advertisement_block()`
 *
 * Layout blocks (`core/group`, `core/columns`, etc.) are skipped at the top level.
 * `convert_columns_block()` exists for internal reuse (e.g. `core/media-text`) and is
 * not wired into the main block walk yet. Snippet mode stops at `core/more`.
 *
 * @since 1.0.0
 */
final class BlockConverter {

	/**
	 * Convert a WordPress post's blocks to beehiiv blocks.
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
	 * Recursively convert parsed WordPress blocks to beehiiv blocks.
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

			if ( 'core/list' === $block_name ) {
				$list_blocks    = self::convert_list_block( $wp_block );
				$beehiiv_blocks = array_merge( $beehiiv_blocks, $list_blocks );
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
			case 'beehiiv/advertisement':
				return self::convert_advertisement_block( $wp_block );
		}

		return [];
	}

	/**
	 * Convert the beehiiv advertisement block to a beehiiv advertisement block.
	 *
	 * The block is omitted (returns an empty array) when no ad is selected or the
	 * selected ad is no longer an active offer, so the newsletter still sends.
	 *
	 * @since 1.0.0
	 *
	 * @param array<string, mixed> $wp_block Parsed block.
	 *
	 * @return array<string, mixed>
	 */
	public static function convert_advertisement_block( array $wp_block ): array {

		$ad_id = isset( $wp_block['attrs']['adId'] ) ? trim( (string) $wp_block['attrs']['adId'] ) : '';

		if ( '' === $ad_id ) {
			return [];
		}

		$settings       = Options::get();
		$publication_id = isset( $settings['publication_id'] ) ? trim( (string) $settings['publication_id'] ) : '';

		if ( '' === $publication_id ) {
			return [];
		}

		// Verify the selected ad is still an active offer; omit it otherwise.
		if ( ! in_array( $ad_id, AdvertisementOpportunities::get_active_ad_ids( $publication_id, false ), true ) ) {
			return [];
		}

		return [
			'type'            => 'advertisement',
			'opportunity_id'  => $ad_id,
			'visual_settings' => [
				'inner_spacing_top'    => 15,
				'inner_spacing_bottom' => 15,
				'inner_spacing_left'   => 0,
				'inner_spacing_right'  => 0,
			],
		];
	}

	/**
	 * Convert post thumbnail to beehiiv image block.
	 *
	 * @param int $thumbnail_id Thumbnail ID.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function convert_post_thumbnail( int $thumbnail_id ): array {

		if ( empty( $thumbnail_id ) ) {
			return [];
		}

		$thumbnail_url = wp_get_attachment_image_url( $thumbnail_id, 'super-feature' );

		if ( empty( $thumbnail_url ) ) {
			return [];
		}

		$alt_text = trim( wp_strip_all_tags( get_post_meta( $thumbnail_id, '_wp_attachment_image_alt', true ) ) );
		$caption  = wp_get_attachment_caption( $thumbnail_id );

		// Build beehiiv image block.
		$beehiiv_block = [
			'type'                => 'image',
			'imageUrl'            => $thumbnail_url,
			'visibility_settings' => [
				'show_on_email' => true,
				'show_on_web'   => false,
			],
			'visual_settings'     => [
				'outer_spacing_bottom' => 18,
			],
		];

		if ( ! empty( $alt_text ) ) {
			$beehiiv_block['alt_text'] = $alt_text;
		}

		if ( ! empty( $caption ) ) {
			$beehiiv_block['caption'] = $caption;
		}

		return $beehiiv_block;
	}

	/**
	 * Convert WordPress heading block to beehiiv heading block.
	 *
	 * Beehiiv heading block supports H1 to H6 heading tags.
	 *
	 * @param array<string, mixed> $wp_block WordPress heading block data.
	 * @return array<string, mixed> beehiiv heading block data.
	 * @since 1.0.0
	 */
	public static function convert_heading_block( array $wp_block ): array {

		$attrs      = $wp_block['attrs'] ?? [];
		$inner_html = $wp_block['innerHTML'] ?? '';

		// Extract heading level (default to 2 if not specified).
		$level = (int) ( $attrs['level'] ?? 2 );

		// Extract text content by stripping HTML tags.
		$text = wp_strip_all_tags( $inner_html );
		$text = trim( $text );

		if ( empty( $text ) ) {
			return [];
		}

		// Build beehiiv heading block.
		$beehiiv_block = [
			'type'         => 'heading',
			'level'        => (string) $level,
			'text'         => $text,
			'anchorHeader' => true,
		];

		// Include anchorIncludeInToc only for H1 to H3.
		if ( $level >= 1 && $level <= 3 ) {
			$beehiiv_block['anchorIncludeInToc'] = true;
		}

		// Include text alignment if specified.
		$alignment = self::get_text_align_from_attrs( $attrs );

		if ( null !== $alignment ) {
			$beehiiv_block['textAlignment'] = $alignment;
		}

		return $beehiiv_block;
	}

	/**
	 * Convert a core/paragraph block.
	 *
	 * Maps innerHTML to beehiiv plaintext/formattedText plus optional textAlignment,
	 * block-level text colour, and block-level background colour from the `<p>` tag.
	 * Inline formatting is parsed by FormattedTextParser (shared with list/table blocks).
	 *
	 * @param array<string, mixed> $wp_block Parsed block.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function convert_paragraph_block( array $wp_block ): array {
		$attrs      = $wp_block['attrs'] ?? [];
		$inner_html = $wp_block['innerHTML'] ?? '';

		if ( '' === trim( $inner_html ) ) {
			return [];
		}

		$inline_html            = FormattedTextParser::extract_element_inner_html( $inner_html, 'p' );
		$block_text_color       = FormattedTextParser::resolve_paragraph_block_text_color( $inner_html, $attrs );
		$block_background_color = FormattedTextParser::resolve_paragraph_block_background_color( $inner_html, $attrs );
		$parsed                 = FormattedTextParser::parse( $inline_html, $block_text_color );

		if ( '' === trim( $parsed['plaintext'] ) ) {
			return [];
		}

		$beehiiv_block = [
			'type' => 'paragraph',
		];

		if ( FormattedTextParser::has_rich_formatting( $parsed['formattedText'] ) ) {
			$beehiiv_block['formattedText'] = $parsed['formattedText'];
		} else {
			$beehiiv_block['plaintext'] = $parsed['plaintext'];
		}

		$alignment = self::get_text_align_from_attrs( $attrs );

		if ( null === $alignment ) {
			$alignment = self::get_text_align_from_html( $inner_html );
		}

		if ( null !== $alignment ) {
			$beehiiv_block['textAlignment'] = $alignment;
		}

		if ( null !== $block_background_color && '' !== $block_background_color ) {
			$beehiiv_block['visual_settings'] = [
				'background_color' => $block_background_color,
			];
		}

		return $beehiiv_block;
	}

	/**
	 * Convert WordPress image block to beehiiv image block.
	 *
	 * Extracts image URL, alt text, caption, link URL and alignment from the HTML.
	 * WordPress Image block stores these in img tag attributes, not block attributes.
	 *
	 * @param array<string, mixed> $wp_block WordPress image block data.
	 * @return array<string, mixed> beehiiv image block data.
	 * @since 1.0.0
	 */
	public static function convert_image_block( array $wp_block ): array {

		$attrs      = $wp_block['attrs'] ?? [];
		$inner_html = $wp_block['innerHTML'] ?? '';

		if ( empty( $inner_html ) ) {
			return [];
		}

		// Use WordPress HTML Processor to extract image data.
		$processor = \WP_HTML_Processor::create_fragment( $inner_html );

		if ( null === $processor ) {
			return [];
		}

		$image_url      = '';
		$alt_text       = '';
		$caption        = '';
		$link_url       = '';
		$img_has_anchor = false;

		// Extract data from tags.
		while ( $processor->next_tag() ) {
			$tag_name = strtolower( $processor->get_tag() );

			if ( 'img' === $tag_name ) {
				$image_url = $processor->get_attribute( 'src' ) ?? '';
				$alt_text  = $processor->get_attribute( 'alt' ) ?? '';

				// Check if image is wrapped in anchor tag using breadcrumbs.
				$breadcrumbs = $processor->get_breadcrumbs();

				foreach ( $breadcrumbs as $parent ) {
					if ( 'A' === strtoupper( $parent ) ) {
						$img_has_anchor = true;
						break;
					}
				}
			} elseif ( 'a' === $tag_name ) {
				// Store anchor href - we'll use it only if image is inside this anchor.
				$link_url = $processor->get_attribute( 'href' ) ?? '';
			} elseif ( 'figcaption' === $tag_name ) {
				// Get caption text by extracting inner HTML and stripping tags.
				$bookmark_name = 'figcaption_start';
				$processor->set_bookmark( $bookmark_name );

				// Move to closing tag to capture full content.
				$figcaption_html = '';
				$depth           = 1;

				while ( $depth > 0 && $processor->next_tag() ) {
					if ( $processor->is_tag_closer() && 'figcaption' === strtolower( $processor->get_tag() ) ) {
						--$depth;
					} elseif ( ! $processor->is_tag_closer() && 'figcaption' === strtolower( $processor->get_tag() ) ) {
						++$depth;
					}
				}

				// Get content between figcaption tags using regex on innerHTML.
				if ( preg_match( '/<figcaption[^>]*>(.*?)<\/figcaption>/is', $inner_html, $matches ) ) {
					$caption = wp_strip_all_tags( $matches[1] );
					$caption = trim( $caption );
				}
			}
		}

		if ( empty( $image_url ) ) {
			return [];
		}

		// Build beehiiv image block.
		$beehiiv_block = [
			'type'     => 'image',
			'imageUrl' => $image_url,
		];

		if ( ! empty( $alt_text ) ) {
			$beehiiv_block['alt_text'] = $alt_text;
		}

		if ( ! empty( $caption ) ) {
			$beehiiv_block['caption'] = $caption;
		}

		// Only add link URL if image was inside anchor tag.
		if ( $img_has_anchor && ! empty( $link_url ) ) {
			$beehiiv_block['url'] = $link_url;
		}

		// Add image alignment if specified in block attributes.
		if ( ! empty( $attrs['align'] ) ) {
			$beehiiv_block['imageAlignment'] = $attrs['align'];
		}

		return $beehiiv_block;
	}

	/**
	 * Convert a core/list block to a beehiiv list block.
	 *
	 * Structure is read from parsed innerBlocks (`core/list-item`). Nested lists
	 * are flattened into the same list; each nesting level prefixes items with
	 * `  - `. List wrapper and item attributes are read with the WordPress HTML
	 * Tag Processor; item inline HTML is extracted with the same Tag Processor +
	 * regex pattern used by button blocks.
	 *
	 * @param array<string, mixed> $wp_block Parsed block.
	 * @return array<int, array<string, mixed>>
	 * @since 1.0.0
	 */
	public static function convert_list_block( array $wp_block ): array {
		$attrs                 = $wp_block['attrs'] ?? [];
		$inner_html            = (string) ( $wp_block['innerHTML'] ?? '' );
		$inner_blocks          = $wp_block['innerBlocks'] ?? [];
		$list_type             = ! empty( $attrs['ordered'] ) ? 'ordered' : 'unordered';
		$start_number          = ListBlockConverter::resolve_list_start_number( $attrs, $inner_html );
		$list_background_color = FormattedTextParser::resolve_list_block_background_color( $inner_html, $attrs );

		if ( empty( $inner_blocks ) ) {
			return [];
		}

		$items = ListBlockConverter::collect_flat_list_items( $wp_block );

		if ( empty( $items ) ) {
			return [];
		}

		return [
			ListBlockConverter::build_beehiiv_list_block(
				$items,
				$list_type,
				$start_number,
				$list_background_color
			),
		];
	}

	/**
	 * Convert a core/columns block to a beehiiv columns block.
	 *
	 * Not included in the top-level newsletter block walk yet. Intended for
	 * internal reuse by `convert_media_text_block()` and future direct columns support.
	 *
	 * @param array<string, mixed> $wp_block Parsed block.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function convert_columns_block( array $wp_block ): array {
		if ( 'core/columns' !== ( $wp_block['blockName'] ?? '' ) ) {
			return [];
		}

		$attrs                 = $wp_block['attrs'] ?? [];
		$inner_html            = (string) ( $wp_block['innerHTML'] ?? '' );
		$inner_blocks          = $wp_block['innerBlocks'] ?? [];
		$stack_on_mobile       = ColumnsBlockConverter::resolve_stack_on_mobile( $attrs, $inner_html );
		$parent_vertical_align = isset( $attrs['verticalAlignment'] ) && is_string( $attrs['verticalAlignment'] )
			? $attrs['verticalAlignment']
			: null;
		$beehiiv_columns       = [];

		foreach ( $inner_blocks as $column_block ) {
			if ( 'core/column' !== ( $column_block['blockName'] ?? '' ) ) {
				continue;
			}

			$column_inner_blocks = $column_block['innerBlocks'] ?? [];
			$column_blocks       = self::convert_layout_block_inner_blocks( $column_inner_blocks );

			if ( empty( $column_blocks ) ) {
				continue;
			}

			$beehiiv_column = ColumnsBlockConverter::build_beehiiv_column(
				$column_blocks,
				$column_block,
				$parent_vertical_align
			);

			if ( ! empty( $beehiiv_column ) ) {
				$beehiiv_columns[] = $beehiiv_column;
			}
		}

		return ColumnsBlockConverter::build_beehiiv_columns_block( $beehiiv_columns, $stack_on_mobile );
	}

	/**
	 * Convert nested inner blocks inside a layout block to beehiiv blocks.
	 *
	 * Used by layout blocks such as columns and media-text. Unsupported blocks are
	 * skipped; snippet-only blocks are omitted.
	 *
	 * @param array<int, array<string, mixed>> $wp_blocks Parsed inner blocks.
	 * @return array<int, array<string, mixed>>
	 * @since 1.0.0
	 */
	private static function convert_layout_block_inner_blocks( array $wp_blocks ): array {
		$beehiiv_blocks = [];

		foreach ( $wp_blocks as $wp_block ) {
			if ( empty( $wp_block['blockName'] ) ) {
				continue;
			}

			$block_name = (string) $wp_block['blockName'];

			if ( 'core/buttons' === $block_name ) {
				$beehiiv_blocks = array_merge( $beehiiv_blocks, self::convert_buttons_block( $wp_block ) );
				continue;
			}

			if ( 'core/list' === $block_name ) {
				$beehiiv_blocks = array_merge( $beehiiv_blocks, self::convert_list_block( $wp_block ) );
				continue;
			}

			if ( ! SupportedBlocks::is_supported( $block_name, false ) ) {
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
	 * Convert a core/table block to a beehiiv table block.
	 *
	 * Maps attrs.head into rows[0] with headerRow when the Header section is enabled
	 * in the block editor. attrs.body supplies remaining rows. When attrs are empty
	 * (common for query-sourced table attributes in PHP parse_blocks), rows are read
	 * from innerHTML instead. The table is omitted when every cell is empty.
	 * Footer rows are omitted; beehiiv has no table footer support.
	 *
	 * @param array<string, mixed> $wp_block Parsed block.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function convert_table_block( array $wp_block ): array {
		$attrs      = $wp_block['attrs'] ?? [];
		$inner_html = (string) ( $wp_block['innerHTML'] ?? '' );
		$rows       = [];
		$header_row = false;

		$header_explicitly_off = array_key_exists( 'head', $attrs )
			&& ! TableBlockConverter::table_has_header_section( $attrs );

		$head_rows = TableBlockConverter::table_has_header_section( $attrs )
			? TableBlockConverter::convert_table_section_rows( $attrs['head'] ?? [] )
			: [];
		$body_rows = TableBlockConverter::convert_table_section_rows( $attrs['body'] ?? [] );

		if ( ! $header_explicitly_off && empty( $head_rows ) && '' !== $inner_html ) {
			$head_rows = TableBlockConverter::parse_thead_rows_from_inner_html( $inner_html );
		}

		if ( empty( $body_rows ) && '' !== $inner_html ) {
			$body_rows = TableBlockConverter::parse_tbody_rows_from_inner_html( $inner_html );
		}

		if ( ! empty( $head_rows ) ) {
			$rows = $head_rows;
		}

		if ( ! empty( $body_rows ) ) {
			$rows = array_merge( $rows, $body_rows );
		}

		if ( empty( $rows ) && '' !== $inner_html ) {
			$header_from_html = $header_explicitly_off ? false : null;
			$parsed           = TableBlockConverter::parse_table_rows_from_inner_html( $inner_html, $header_from_html );
			$rows             = $parsed['rows'];
			$header_row       = $parsed['header_row'];
		} elseif ( ! empty( $head_rows ) ) {
			$header_row = true;
		}

		if ( ! TableBlockConverter::table_rows_have_content( $rows ) && '' !== $inner_html ) {
			$header_from_html = $header_explicitly_off ? false : null;
			$parsed           = TableBlockConverter::parse_table_rows_from_inner_html( $inner_html, $header_from_html );
			$rows             = $parsed['rows'];
			$header_row       = $parsed['header_row'];
		}

		if ( empty( $rows ) || ! TableBlockConverter::table_rows_have_content( $rows ) ) {
			return [];
		}

		return [
			'type'      => 'table',
			'rows'      => $rows,
			'headerRow' => $header_row,
		];
	}

	/**
	 * Convert WordPress buttons block to beehiiv button blocks.
	 *
	 * WordPress buttons block is a parent block with core/button as child blocks.
	 * Each child button is converted to a separate beehiiv button block.
	 * Parent's justifyContent attribute is applied as alignment to each button.
	 *
	 * @param array<string, mixed> $wp_block WordPress buttons block data.
	 * @return array<int, array<string, mixed>> Array of beehiiv button blocks.
	 * @since 1.0.0
	 */
	public static function convert_buttons_block( array $wp_block ): array {

		$inner_blocks = $wp_block['innerBlocks'] ?? [];

		if ( empty( $inner_blocks ) ) {
			return [];
		}

		$attrs     = $wp_block['attrs'] ?? [];
		$alignment = $attrs['layout']['justifyContent'] ?? 'left';

		$beehiiv_blocks = [];

		foreach ( $inner_blocks as $button_block ) {

			if ( 'core/button' !== $button_block['blockName'] ) {
				continue;
			}

			$beehiiv_block = self::convert_button_block( $button_block, $alignment );

			if ( ! empty( $beehiiv_block ) ) {
				$beehiiv_blocks[] = $beehiiv_block;
			}
		}

		return $beehiiv_blocks;
	}

	/**
	 * Convert WordPress button block to beehiiv button block.
	 *
	 * Extracts href, text, and target from the anchor tag in innerHTML.
	 * WordPress button block always uses anchor tag even for plain text buttons.
	 *
	 * @param array<string, mixed> $wp_block  WordPress button block data.
	 * @param string               $alignment Button alignment from parent buttons block.
	 * @return array<string, mixed> beehiiv button block data.
	 * @since 1.0.0
	 */
	public static function convert_button_block( array $wp_block, string $alignment = 'left' ): array {

		$inner_html = $wp_block['innerHTML'] ?? '';

		if ( empty( $inner_html ) ) {
			return [];
		}

		// Use WordPress HTML Tag Processor to extract button data from anchor tag.
		$processor = new \WP_HTML_Tag_Processor( $inner_html );

		if ( ! $processor->next_tag( 'a' ) ) {
			return [];
		}

		$href   = $processor->get_attribute( 'href' ) ?? '';
		$target = $processor->get_attribute( 'target' ) ?? '';

		// Extract text content from anchor tag using regex.
		$text = '';

		if ( preg_match( '/<a[^>]*>(.*?)<\/a>/is', $inner_html, $matches ) ) {
			$text = wp_strip_all_tags( $matches[1] );
			$text = trim( $text );
		}

		if ( empty( $text ) ) {
			return [];
		}

		// Build beehiiv button block.
		$beehiiv_block = [
			'type'      => 'button',
			'href'      => ! empty( $href ) ? $href : '#',
			'text'      => $text,
			'alignment' => $alignment,
			'size'      => 'large',
			'target'    => ! empty( $target ) ? $target : '_self',
		];

		return $beehiiv_block;
	}

	/**
	 * Convert WordPress quote block to beehiiv quote block.
	 *
	 * WordPress quote block uses paragraph block for quote text (first child)
	 * and optionally has citation. A quote transformed to a pullquote nests
	 * `core/pullquote` as the first inner block instead.
	 *
	 * @param array<string, mixed> $wp_block WordPress quote block data.
	 * @return array<string, mixed> beehiiv quote block data.
	 * @since 1.0.0
	 */
	public static function convert_quote_block( array $wp_block ): array {

		$attrs        = $wp_block['attrs'] ?? [];
		$inner_blocks = $wp_block['innerBlocks'] ?? [];

		// Transforming a quote to a pullquote nests core/pullquote inside core/quote.
		if ( ! empty( $inner_blocks[0] ) && 'core/pullquote' === $inner_blocks[0]['blockName'] ) {
			return self::convert_pullquote_block( $inner_blocks[0] );
		}

		// Get quote text from first paragraph block.
		$quote_text = '';

		if ( ! empty( $inner_blocks[0] ) && 'core/paragraph' === $inner_blocks[0]['blockName'] ) {
			$quote_html = $inner_blocks[0]['innerHTML'] ?? '';
			$quote_text = wp_strip_all_tags( $quote_html );
			$quote_text = trim( $quote_text );
		}

		if ( empty( $quote_text ) ) {
			return [];
		}

		// Get citation/author if available (usually second paragraph or cite element).
		$citation = '';

		if ( ! empty( $inner_blocks[1] ) && 'core/paragraph' === $inner_blocks[1]['blockName'] ) {
			$citation_html = $inner_blocks[1]['innerHTML'] ?? '';
			$citation      = wp_strip_all_tags( $citation_html );
			$citation      = trim( $citation );
		}

		$alignment = self::get_text_align_from_attrs( $attrs );

		if ( null === $alignment && ! empty( $inner_blocks[0]['attrs'] ) ) {
			$alignment = self::get_text_align_from_attrs( $inner_blocks[0]['attrs'] );
		}

		$alignment = $alignment ?? 'left';

		// Build beehiiv quote block.
		$beehiiv_block = [
			'type'      => 'quote',
			'quote'     => $quote_text,
			'variant'   => 'inline',
			'alignment' => $alignment,
		];

		if ( ! empty( $citation ) ) {
			$beehiiv_block['author'] = $citation;
		}

		return $beehiiv_block;
	}

	/**
	 * Convert WordPress pullquote block to beehiiv quote block.
	 *
	 * WordPress pullquote block stores quote HTML in innerHTML attribute.
	 * Quote text is extracted from p tag inside blockquote, citation from cite tag.
	 * Text formatting is stripped from both.
	 *
	 * @param array<string, mixed> $wp_block WordPress pullquote block data.
	 * @return array<string, mixed> beehiiv quote block data.
	 * @since 1.0.0
	 */
	public static function convert_pullquote_block( array $wp_block ): array {

		$attrs      = $wp_block['attrs'] ?? [];
		$inner_html = $wp_block['innerHTML'] ?? '';

		if ( empty( $inner_html ) ) {
			return [];
		}

		// Use WordPress HTML Processor to extract quote and citation.
		$processor = \WP_HTML_Processor::create_fragment( $inner_html );

		if ( null === $processor ) {
			return [];
		}

		$quote_text    = '';
		$citation      = '';
		$in_blockquote = false;
		$found_quote   = false;

		// Extract data from tags using breadcrumbs to check parent elements.
		while ( $processor->next_tag() ) {
			$tag_name    = strtolower( $processor->get_tag() );
			$breadcrumbs = $processor->get_breadcrumbs();

			// Check if we're inside a blockquote.
			$in_blockquote = in_array( 'BLOCKQUOTE', array_map( 'strtoupper', $breadcrumbs ), true );

			if ( ! $in_blockquote ) {
				continue;
			}

			// Get quote text from first p tag inside blockquote.
			if ( 'p' === $tag_name && ! $found_quote ) {
				if ( preg_match( '/<blockquote[^>]*>.*?<p[^>]*>(.*?)<\/p>/is', $inner_html, $matches ) ) {
					$quote_text  = wp_strip_all_tags( $matches[1] );
					$quote_text  = trim( $quote_text );
					$found_quote = true;
				}
			}

			// Get citation from cite tag inside blockquote.
			if ( 'cite' === $tag_name && empty( $citation ) ) {
				if ( preg_match( '/<cite[^>]*>(.*?)<\/cite>/is', $inner_html, $matches ) ) {
					$citation = wp_strip_all_tags( $matches[1] );
					$citation = trim( $citation );
				}
			}
		}

		if ( empty( $quote_text ) ) {
			return [];
		}

		$alignment = self::get_text_align_from_attrs( $attrs );

		if ( null === $alignment && preg_match( '/has-text-align-(left|center|right)/', $inner_html, $matches ) ) {
			$alignment = $matches[1];
		}

		$alignment = $alignment ?? 'center';

		// Build beehiiv quote block.
		$beehiiv_block = [
			'type'      => 'quote',
			'quote'     => $quote_text,
			'variant'   => 'quotation',
			'alignment' => $alignment,
		];

		if ( ! empty( $citation ) ) {
			$beehiiv_block['author'] = $citation;
		}

		return $beehiiv_block;
	}

	/**
	 * Convert WordPress embed block to beehiiv embed_link block.
	 *
	 * WordPress embed block stores the embed URL in the url attribute.
	 *
	 * @param array<string, mixed> $wp_block WordPress embed block data.
	 * @return array<string, mixed> beehiiv embed_link block data.
	 * @since 1.0.0
	 */
	public static function convert_embed_block( array $wp_block ): array {

		$attrs = $wp_block['attrs'] ?? [];
		$url   = $attrs['url'] ?? '';

		if ( empty( $url ) ) {
			return [];
		}

		return [
			'type' => 'embed_link',
			'url'  => $url,
		];
	}

	/**
	 * Convert a core/media-text block to a beehiiv columns block.
	 *
	 * Maps the media side to an image column and the content side to converted
	 * inner blocks. Blocks with video media are omitted entirely. Respects media
	 * position, column widths, vertical alignment, and mobile stacking.
	 *
	 * @param array<string, mixed> $wp_block Parsed block.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function convert_media_text_block( array $wp_block ): array {
		$attrs        = $wp_block['attrs'] ?? [];
		$inner_html   = (string) ( $wp_block['innerHTML'] ?? '' );
		$inner_blocks = $wp_block['innerBlocks'] ?? [];

		if ( MediaTextBlockConverter::is_video_media_type( $attrs, $inner_html ) ) {
			return [];
		}

		$stack_on_mobile = ColumnsBlockConverter::resolve_stack_on_mobile( $attrs, $inner_html );
		$vertical_align  = MediaTextBlockConverter::resolve_vertical_alignment( $attrs, $inner_html );
		$media_width     = MediaTextBlockConverter::resolve_media_width( $attrs, $inner_html );
		$content_width   = max( 1, min( 100, 100 - $media_width ) );

		$media_blocks   = self::convert_media_text_media_blocks( $attrs, $inner_html );
		$content_blocks = self::convert_layout_block_inner_blocks( $inner_blocks );

		if ( empty( $content_blocks ) && '' !== $inner_html ) {
			$content_html = MediaTextBlockConverter::extract_content_inner_html( $inner_html );

			if ( '' !== $content_html ) {
				$content_blocks = self::convert_layout_block_inner_blocks( parse_blocks( $content_html ) );
			}
		}

		$media_column   = [];
		$content_column = [];

		if ( ! empty( $media_blocks ) ) {
			$media_column = ColumnsBlockConverter::build_beehiiv_column_from_definition(
				$media_blocks,
				$media_width,
				$vertical_align
			);
		}

		if ( ! empty( $content_blocks ) ) {
			$content_column = ColumnsBlockConverter::build_beehiiv_column_from_definition(
				$content_blocks,
				$content_width,
				$vertical_align
			);
		}

		$columns = MediaTextBlockConverter::order_columns(
			$media_column,
			$content_column,
			$attrs,
			$inner_html
		);

		if ( empty( $columns ) ) {
			return [];
		}

		return ColumnsBlockConverter::build_beehiiv_columns_block( $columns, $stack_on_mobile );
	}

	/**
	 * Convert the media side of a core/media-text block to beehiiv blocks.
	 *
	 * @param array<string, mixed> $attrs      Parsed media-text attrs.
	 * @param string               $inner_html Saved media-text HTML.
	 * @return array<int, array<string, mixed>>
	 * @since 1.0.0
	 */
	private static function convert_media_text_media_blocks( array $attrs, string $inner_html ): array {
		$synthetic_image_block = MediaTextBlockConverter::build_synthetic_image_block( $attrs, $inner_html );

		if ( empty( $synthetic_image_block ) ) {
			return [];
		}

		$image_block = self::convert_image_block( $synthetic_image_block );

		if ( empty( $image_block ) ) {
			return [];
		}

		unset( $image_block['imageAlignment'] );

		return [ $image_block ];
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

	/**
	 * Resolve text alignment from WordPress block attributes.
	 *
	 * @param array<string, mixed> $attrs Block attributes.
	 * @return string|null left, center, or right; null when not set.
	 * @since 1.0.0
	 */
	private static function get_text_align_from_attrs( array $attrs ): ?string {
		if ( ! empty( $attrs['textAlign'] ) && is_string( $attrs['textAlign'] ) ) {
			return $attrs['textAlign'];
		}

		if ( ! empty( $attrs['align'] ) && is_string( $attrs['align'] ) ) {
			return $attrs['align'];
		}

		if (
			isset( $attrs['style']['typography']['textAlign'] )
			&& is_string( $attrs['style']['typography']['textAlign'] )
			&& '' !== $attrs['style']['typography']['textAlign']
		) {
			return $attrs['style']['typography']['textAlign'];
		}

		return null;
	}

	/**
	 * Resolve text alignment from saved block HTML classes.
	 *
	 * @param string $html Saved block HTML.
	 * @return string|null left, center, or right; null when not set.
	 * @since 1.0.0
	 */
	private static function get_text_align_from_html( string $html ): ?string {
		if ( preg_match( '/has-text-align-(left|center|right)/', $html, $matches ) ) {
			return $matches[1];
		}

		return null;
	}
}
