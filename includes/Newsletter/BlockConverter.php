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
 * - Featured image (post thumbnail) — `convert_post_thumbnail()`
 * - `core/heading` — `convert_heading_block()`
 * - `core/paragraph` — `convert_paragraph_block()` -------------------------------------------------> (NOT IMPLEMENTED YET)
 * - `core/image` — `convert_image_block()`
 * - `core/list` — `convert_list_block()` -----------------------------------------------------------> (NOT IMPLEMENTED YET)
 * - `core/table` — `convert_table_block()` ---------------------------------------------------------> (NOT IMPLEMENTED YET)
 * - `core/quote` — `convert_quote_block()`
 * - `core/pullquote` — `convert_pullquote_block()`
 * - `core/embed` — `convert_embed_block()`
 * - `core/media-text` — `convert_media_text_block()` -----------------------------------------------> (NOT IMPLEMENTED YET)
 * - `core/buttons` / inner `core/button` — `convert_buttons_block()`, `convert_button_block()`
 * - `core/separator` — Beehiiv `content_break`
 * - `core/more` — snippet newsletters only; Beehiiv Read More `button` via `convert_more_block()`
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
	 * Convert post thumbnail to Beehiiv image block.
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

		// Build Beehiiv image block.
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
	 * Convert WordPress heading block to Beehiiv heading block.
	 *
	 * Beehiiv heading block supports H1 to H6 heading tags.
	 *
	 * @param array<string, mixed> $wp_block WordPress heading block data.
	 * @return array<string, mixed> Beehiiv heading block data.
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

		// Build Beehiiv heading block.
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
		if ( ! empty( $attrs['textAlign'] ) ) {
			$beehiiv_block['textAlignment'] = $attrs['textAlign'];
		}

		return $beehiiv_block;
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
	 * Convert WordPress image block to Beehiiv image block.
	 *
	 * Extracts image URL, alt text, caption, link URL and alignment from the HTML.
	 * WordPress Image block stores these in img tag attributes, not block attributes.
	 *
	 * @param array<string, mixed> $wp_block WordPress image block data.
	 * @return array<string, mixed> Beehiiv image block data.
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

		// Build Beehiiv image block.
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
	 * Convert WordPress buttons block to Beehiiv button blocks.
	 *
	 * WordPress buttons block is a parent block with core/button as child blocks.
	 * Each child button is converted to a separate Beehiiv button block.
	 * Parent's justifyContent attribute is applied as alignment to each button.
	 *
	 * @param array<string, mixed> $wp_block WordPress buttons block data.
	 * @return array<int, array<string, mixed>> Array of Beehiiv button blocks.
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
	 * Convert WordPress button block to Beehiiv button block.
	 *
	 * Extracts href, text, and target from the anchor tag in innerHTML.
	 * WordPress button block always uses anchor tag even for plain text buttons.
	 *
	 * @param array<string, mixed> $wp_block  WordPress button block data.
	 * @param string               $alignment Button alignment from parent buttons block.
	 * @return array<string, mixed> Beehiiv button block data.
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

		// Build Beehiiv button block.
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
	 * Convert WordPress quote block to Beehiiv quote block.
	 *
	 * WordPress quote block uses paragraph block for quote text (first child)
	 * and optionally has citation. Text formatting is stripped from both.
	 *
	 * @param array<string, mixed> $wp_block WordPress quote block data.
	 * @return array<string, mixed> Beehiiv quote block data.
	 * @since 1.0.0
	 */
	public static function convert_quote_block( array $wp_block ): array {

		$attrs        = $wp_block['attrs'] ?? [];
		$inner_blocks = $wp_block['innerBlocks'] ?? [];

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

		// Get alignment from textAlign attribute.
		$alignment = $attrs['textAlign'] ?? 'left';

		// Build Beehiiv quote block.
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
	 * Convert WordPress pullquote block to Beehiiv quote block.
	 *
	 * WordPress pullquote block stores quote HTML in innerHTML attribute.
	 * Quote text is extracted from p tag inside blockquote, citation from cite tag.
	 * Text formatting is stripped from both.
	 *
	 * @param array<string, mixed> $wp_block WordPress pullquote block data.
	 * @return array<string, mixed> Beehiiv quote block data.
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

		// Get alignment from textAlign attribute.
		$alignment = $attrs['textAlign'] ?? 'left';

		// Build Beehiiv quote block.
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
	 * Convert WordPress embed block to Beehiiv embed_link block.
	 *
	 * WordPress embed block stores the embed URL in the url attribute.
	 *
	 * @param array<string, mixed> $wp_block WordPress embed block data.
	 * @return array<string, mixed> Beehiiv embed_link block data.
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
