<?php
/**
 * Maps a core/html block to a beehiiv HTML block.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter\Converters;

defined( 'ABSPATH' ) || exit;

/**
 * Builds a beehiiv `html` block (an HTML Snippet) from a Custom HTML block.
 *
 * The HTML is sent as written. Only `<script>` and `<iframe>` elements are removed,
 * because beehiiv HTML Snippets do not accept them. Nothing is added around the HTML and
 * no visibility rule is set, so a snippet follows beehiiv's own default.
 *
 * @since 1.3.0
 */
final class HtmlBlockConverter {

	/**
	 * Remove `<script>` and `<iframe>` elements from HTML.
	 *
	 * Whole elements are removed, together with their content. Any stray opening or
	 * closing tag left behind is removed as well. Everything else is left untouched.
	 *
	 * @param string $html Raw HTML.
	 * @return string
	 * @since 1.3.0
	 */
	public static function strip_unsupported_elements( string $html ): string {
		$html = (string) preg_replace( '#<\s*(script|iframe)\b[^>]*>.*?<\s*/\s*\1\s*>#is', '', $html );

		return (string) preg_replace( '#<\s*/?\s*(?:script|iframe)\b[^>]*>#i', '', $html );
	}

	/**
	 * Whether HTML holds a `<script>` or `<iframe>` element.
	 *
	 * @param string $html Raw HTML.
	 * @return bool
	 * @since 1.3.0
	 */
	public static function has_unsupported_elements( string $html ): bool {
		return 1 === preg_match( '#<\s*(?:script|iframe)\b#i', $html );
	}

	/**
	 * Convert a core/html block to a beehiiv `html` block.
	 *
	 * Returns an empty array when nothing is left to send: an empty block, a block with
	 * only whitespace, or a block that held only script or iframe elements.
	 *
	 * @param array<string, mixed> $wp_block Parsed core/html block.
	 * @return array<string, mixed>
	 * @since 1.3.0
	 */
	public static function convert( array $wp_block ): array {
		$html = trim( self::strip_unsupported_elements( (string) ( $wp_block['innerHTML'] ?? '' ) ) );

		if ( '' === $html ) {
			return [];
		}

		return [
			'type' => 'html',
			'html' => $html,
		];
	}
}
