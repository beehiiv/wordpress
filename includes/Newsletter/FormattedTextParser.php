<?php
/**
 * Parses WordPress inline HTML into beehiiv formatted text runs.
 *
 * Shared by paragraph, list-item, and table-cell block converters.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter;

defined( 'ABSPATH' ) || exit;

/**
 * Converts rich-text HTML into beehiiv `plaintext` and `formattedText` fields.
 *
 * Beehiiv paragraph mapping (action = Yes):
 * - innerHTML → plaintext + formattedText
 * - strong/b → styling bold
 * - em/i → styling italic
 * - s/del → styling strikethrough
 * - a → link { href, target }
 * - mark → highlight_color
 * - inline text colour → text_color
 *
 * Ignored (action = No): dropCap, code, sup, sub — text kept, tags stripped.
 * Inline images are omitted entirely.
 *
 * Text colour is only set on inline elements with an explicit `style="color:…"`
 * or `has-inline-color` preset class, or when the parent `<p>` sets a block colour
 * via attrs/`has-text-color` (applied to runs without their own inline colour).
 * Normal body text is sent without `text_color`; the theme default is not inferred.
 *
 * To add a new format later: extend STYLING_TAGS or add a case in
 * apply_tag_context() with a dedicated apply_*_context() helper.
 *
 * @since 1.0.0
 */
final class FormattedTextParser {

	/**
	 * WordPress inline tags mapped to beehiiv styling values.
	 *
	 * @var array<string, string>
	 */
	private const STYLING_TAGS = [
		'strong' => 'bold',
		'b'      => 'bold',
		'em'     => 'italic',
		'i'      => 'italic',
		's'      => 'strikethrough',
		'del'    => 'strikethrough',
	];

	/**
	 * Tags dropped entirely from output (no text preserved).
	 *
	 * @var array<string, true>
	 */
	private const SKIP_TAGS = [
		'img' => true,
	];

	/**
	 * Stable styling order for segment comparison and API output.
	 *
	 * @var array<int, string>
	 */
	private const STYLING_ORDER = [
		'bold',
		'italic',
		'strikethrough',
	];

	/**
	 * Cached map of theme color slugs to hex values.
	 *
	 * @var array<string, string>|null
	 */
	private static $color_preset_map = null;

	/**
	 * Parse inline HTML into plaintext and formatted text segments.
	 *
	 * @param string      $html                Inline HTML (no block wrapper).
	 * @param string|null $default_text_color  Block-level text colour from the parent `<p>`.
	 * @return array{plaintext: string, formattedText: array<int, array<string, mixed>>}
	 * @since 1.0.0
	 */
	public static function parse( string $html, ?string $default_text_color = null ): array {
		$html = trim( $html );

		if ( '' === $html ) {
			return [
				'plaintext'     => '',
				'formattedText' => [],
			];
		}

		$segments = self::parse_html_to_segments( $html, $default_text_color );
		$segments = self::merge_segments( $segments );

		$plaintext = '';

		foreach ( $segments as $segment ) {
			$plaintext .= (string) ( $segment['text'] ?? '' );
		}

		return [
			'plaintext'     => $plaintext,
			'formattedText' => $segments,
		];
	}

	/**
	 * Whether formatted text runs include styling beyond a single plain run.
	 *
	 * Beehiiv expects either `plaintext` or `formattedText` on paragraph blocks,
	 * not both. Plain paragraphs use `plaintext`; rich text uses `formattedText`.
	 *
	 * @param array<int, array<string, mixed>> $formatted_text Parsed formatted runs.
	 * @return bool
	 * @since 1.0.0
	 */
	public static function has_rich_formatting( array $formatted_text ): bool {
		if ( count( $formatted_text ) > 1 ) {
			return true;
		}

		if ( empty( $formatted_text ) ) {
			return false;
		}

		$segment = $formatted_text[0];

		return ! empty( $segment['styling'] )
			|| ! empty( $segment['link'] )
			|| ! empty( $segment['highlight_color'] )
			|| ! empty( $segment['text_color'] );
	}

	/**
	 * Parse inline HTML and return plaintext only.
	 *
	 * Convenience helper for list and table converters that only need a string.
	 *
	 * @param string $html Inline HTML (no block wrapper).
	 * @return string
	 * @since 1.0.0
	 */
	public static function parse_plaintext( string $html ): string {
		return self::parse( $html )['plaintext'];
	}

	/**
	 * Extract inner HTML from the first matching wrapper element.
	 *
	 * Used to unwrap saved block markup such as `<p>`, `<li>`, `<td>`, or `<th>`
	 * before parsing inline rich text.
	 *
	 * @param string $html Saved element HTML.
	 * @param string $tag  Wrapper tag name.
	 * @return string
	 * @since 1.0.0
	 */
	public static function extract_element_inner_html( string $html, string $tag ): string {
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
	 * Resolve block-level paragraph text colour from attrs and the `<p>` tag.
	 *
	 * @param string               $inner_html Saved paragraph HTML including the `<p>` wrapper.
	 * @param array<string, mixed> $attrs      Parsed block attributes.
	 * @return string|null
	 * @since 1.0.0
	 */
	public static function resolve_paragraph_block_text_color( string $inner_html, array $attrs ): ?string {
		$from_attrs = self::resolve_block_text_color_from_attrs( $attrs );

		if ( null !== $from_attrs ) {
			return $from_attrs;
		}

		return self::resolve_block_text_color_from_html( $inner_html, 'p' );
	}

	/**
	 * Resolve block-level list-item text colour from attrs and the `<li>` tag.
	 *
	 * @param string               $inner_html Saved list-item HTML including the `<li>` wrapper.
	 * @param array<string, mixed> $attrs      Parsed block attributes.
	 * @return string|null
	 * @since 1.0.0
	 */
	public static function resolve_list_item_block_text_color( string $inner_html, array $attrs ): ?string {
		$from_attrs = self::resolve_block_text_color_from_attrs( $attrs );

		if ( null !== $from_attrs ) {
			return $from_attrs;
		}

		return self::resolve_block_text_color_from_html( $inner_html, 'li' );
	}

	/**
	 * Resolve block-level list text colour from attrs and the `<ul>` / `<ol>` tag.
	 *
	 * Applied as the default colour for all list items unless an item or inline
	 * element sets its own colour.
	 *
	 * @param string               $inner_html Saved list HTML including the wrapper tag.
	 * @param array<string, mixed> $attrs      Parsed list block attributes.
	 * @return string|null
	 * @since 1.0.0
	 */
	public static function resolve_list_block_text_color( string $inner_html, array $attrs ): ?string {
		$from_attrs = self::resolve_block_text_color_from_attrs( $attrs );

		if ( null !== $from_attrs ) {
			return $from_attrs;
		}

		return self::resolve_list_wrapper_color_from_html( $inner_html, $attrs, 'text' );
	}

	/**
	 * Resolve block-level list background colour from attrs and the `<ul>` / `<ol>` tag.
	 *
	 * @param string               $inner_html Saved list HTML including the wrapper tag.
	 * @param array<string, mixed> $attrs      Parsed list block attributes.
	 * @return string|null
	 * @since 1.0.0
	 */
	public static function resolve_list_block_background_color( string $inner_html, array $attrs ): ?string {
		$from_attrs = self::resolve_block_background_color_from_attrs( $attrs );

		if ( null !== $from_attrs ) {
			return $from_attrs;
		}

		return self::resolve_list_wrapper_color_from_html( $inner_html, $attrs, 'background' );
	}

	/**
	 * Walk HTML and collect formatted text segments.
	 *
	 * @param string      $html               Inline HTML.
	 * @param string|null $default_text_color Block-level text colour from the parent `<p>`.
	 * @return array<int, array<string, mixed>>
	 */
	private static function parse_html_to_segments( string $html, ?string $default_text_color = null ): array {
		$document = new \DOMDocument();

		libxml_use_internal_errors( true );

		$loaded = $document->loadHTML(
			'<?xml encoding="utf-8"><div id="beehiiv-formatted-text-root">' . $html . '</div>',
			LIBXML_HTML_NODEFDTD
		);

		libxml_clear_errors();

		if ( ! $loaded ) {
			$plaintext = trim( wp_strip_all_tags( $html ) );

			if ( '' === $plaintext ) {
				return [];
			}

			$segment = [
				'text' => $plaintext,
			];

			if ( null !== $default_text_color && '' !== $default_text_color ) {
				$segment['text_color'] = $default_text_color;
			}

			return [ $segment ];
		}

		$root = $document->getElementById( 'beehiiv-formatted-text-root' );

		if ( ! $root instanceof \DOMElement ) {
			return [];
		}

		$segments = [];

		// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase
		foreach ( $root->childNodes as $child_node ) {
			self::walk_node( $child_node, self::empty_context( $default_text_color ), $segments );
		}

		return $segments;
	}

	/**
	 * Recursively walk a DOM node and append formatted segments.
	 *
	 * @param \DOMNode                         $node     Current node.
	 * @param array<string, mixed>             $context  Active formatting context.
	 * @param array<int, array<string, mixed>> $segments Collected segments.
	 * @return void
	 */
	private static function walk_node( \DOMNode $node, array $context, array &$segments ): void {
		if ( $node instanceof \DOMText ) {
			// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase
			$text = $node->textContent;

			if ( null === $text || '' === $text ) {
				return;
			}

			self::append_segment( $segments, $text, $context );

			return;
		}

		if ( ! $node instanceof \DOMElement ) {
			return;
		}

		// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase
		$tag = strtolower( $node->tagName );

		if ( isset( self::SKIP_TAGS[ $tag ] ) ) {
			return;
		}

		if ( 'br' === $tag ) {
			self::append_segment( $segments, "\n", $context );
			return;
		}

		$child_context = self::apply_tag_context( $context, $node, $tag );

		// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase
		foreach ( $node->childNodes as $child_node ) {
			self::walk_node( $child_node, $child_context, $segments );
		}
	}

	/**
	 * Build child formatting context for an element.
	 *
	 * Mapped tags add formatting metadata. All other tags inherit the parent
	 * context unchanged so their text is kept without the wrapper tag.
	 *
	 * @param array<string, mixed> $context Parent context.
	 * @param \DOMElement          $node    Current element.
	 * @param string               $tag     Lowercase tag name.
	 * @return array<string, mixed>
	 */
	private static function apply_tag_context( array $context, \DOMElement $node, string $tag ): array {
		if ( isset( self::STYLING_TAGS[ $tag ] ) ) {
			return self::with_styling( $context, self::STYLING_TAGS[ $tag ] );
		}

		switch ( $tag ) {
			case 'a':
				return self::apply_link_context( $context, $node );
			case 'mark':
				return self::apply_mark_context( $context, $node );
			case 'span':
				return self::apply_text_color_context( $context, $node );
		}

		return $context;
	}

	/**
	 * Apply link metadata from an anchor element.
	 *
	 * @param array<string, mixed> $context Parent context.
	 * @param \DOMElement          $node    Anchor element.
	 * @return array<string, mixed>
	 */
	private static function apply_link_context( array $context, \DOMElement $node ): array {
		$href = trim( $node->getAttribute( 'href' ) );

		if ( '' === $href ) {
			return $context;
		}

		$target = trim( $node->getAttribute( 'target' ) );

		return self::extend_context(
			$context,
			[
				'link' => [
					'href'   => $href,
					'target' => '' !== $target ? $target : '_self',
				],
			]
		);
	}

	/**
	 * Apply highlight and text colour from a mark element.
	 *
	 * WordPress uses mark for both highlights (background colour) and inline
	 * text colour presets (transparent background + has-{slug}-color class).
	 *
	 * @param array<string, mixed> $context Parent context.
	 * @param \DOMElement          $node    Mark element.
	 * @return array<string, mixed>
	 */
	private static function apply_mark_context( array $context, \DOMElement $node ): array {
		$overrides = [];

		$highlight_color = self::resolve_highlight_color( $node );

		if ( null !== $highlight_color ) {
			$overrides['highlight_color'] = $highlight_color;
		}

		$text_color = self::resolve_text_color( $node );

		if ( null !== $text_color ) {
			$overrides['text_color'] = $text_color;
		}

		if ( empty( $overrides ) ) {
			return $context;
		}

		return self::extend_context( $context, $overrides );
	}

	/**
	 * Apply text colour from a span element.
	 *
	 * @param array<string, mixed> $context Parent context.
	 * @param \DOMElement          $node    Span element.
	 * @return array<string, mixed>
	 */
	private static function apply_text_color_context( array $context, \DOMElement $node ): array {
		$text_color = self::resolve_text_color( $node );

		if ( null === $text_color ) {
			return $context;
		}

		return self::extend_context(
			$context,
			[
				'text_color' => $text_color,
			]
		);
	}

	/**
	 * Copy context and apply styling.
	 *
	 * @param array<string, mixed> $context Parent context.
	 * @param string               $style   Beehiiv styling value.
	 * @return array<string, mixed>
	 */
	private static function with_styling( array $context, string $style ): array {
		return self::extend_context(
			$context,
			[
				'styling' => array_merge(
					$context['styling'],
					[ $style ]
				),
			]
		);
	}

	/**
	 * Copy context and merge overrides.
	 *
	 * @param array<string, mixed> $context   Parent context.
	 * @param array<string, mixed> $overrides Context keys to replace.
	 * @return array<string, mixed>
	 */
	private static function extend_context( array $context, array $overrides ): array {
		$extended = $context;

		foreach ( $overrides as $key => $value ) {
			$extended[ $key ] = $value;
		}

		return $extended;
	}

	/**
	 * Append a formatted segment when text is non-empty.
	 *
	 * @param array<int, array<string, mixed>> $segments Collected segments.
	 * @param string                           $text     Text content.
	 * @param array<string, mixed>             $context  Active formatting context.
	 * @return void
	 */
	private static function append_segment( array &$segments, string $text, array $context ): void {
		if ( '' === $text ) {
			return;
		}

		$segments[] = self::build_segment( $text, $context );
	}

	/**
	 * Build a beehiiv formatted text segment from context.
	 *
	 * @param string               $text    Text content.
	 * @param array<string, mixed> $context Active formatting context.
	 * @return array<string, mixed>
	 */
	private static function build_segment( string $text, array $context ): array {
		$segment = [
			'text' => $text,
		];

		$styling = self::normalize_styling( $context['styling'] );

		if ( ! empty( $styling ) ) {
			$segment['styling'] = $styling;
		}

		if ( ! empty( $context['link'] ) && is_array( $context['link'] ) ) {
			$segment['link'] = $context['link'];
		}

		if ( ! empty( $context['highlight_color'] ) && is_string( $context['highlight_color'] ) ) {
			$segment['highlight_color'] = $context['highlight_color'];
		}

		if ( ! empty( $context['text_color'] ) && is_string( $context['text_color'] ) ) {
			$segment['text_color'] = $context['text_color'];
		}

		return $segment;
	}

	/**
	 * Merge adjacent segments that share identical formatting.
	 *
	 * @param array<int, array<string, mixed>> $segments Parsed segments.
	 * @return array<int, array<string, mixed>>
	 */
	private static function merge_segments( array $segments ): array {
		$merged = [];

		foreach ( $segments as $segment ) {
			if ( empty( $merged ) ) {
				$merged[] = $segment;
				continue;
			}

			$last_index = count( $merged ) - 1;

			if ( self::segments_match( $merged[ $last_index ], $segment ) ) {
				$merged[ $last_index ]['text'] .= $segment['text'];
				continue;
			}

			$merged[] = $segment;
		}

		return $merged;
	}

	/**
	 * Compare two segments for identical formatting metadata.
	 *
	 * @param array<string, mixed> $left  Left segment.
	 * @param array<string, mixed> $right Right segment.
	 * @return bool
	 */
	private static function segments_match( array $left, array $right ): bool {
		return self::normalize_styling( $left['styling'] ?? [] ) === self::normalize_styling( $right['styling'] ?? [] )
			&& ( $left['link'] ?? null ) === ( $right['link'] ?? null )
			&& ( $left['highlight_color'] ?? null ) === ( $right['highlight_color'] ?? null )
			&& ( $left['text_color'] ?? null ) === ( $right['text_color'] ?? null );
	}

	/**
	 * Return a default formatting context.
	 *
	 * @param string|null $default_text_color Block-level text colour from the parent `<p>`.
	 * @return array{styling: array<int, string>, link: null, highlight_color: null, text_color: string|null}
	 */
	private static function empty_context( ?string $default_text_color = null ): array {
		return [
			'styling'         => [],
			'link'            => null,
			'highlight_color' => null,
			'text_color'      => $default_text_color,
		];
	}

	/**
	 * Sort styling values in a stable order.
	 *
	 * @param mixed $styling Styling array.
	 * @return array<int, string>
	 */
	private static function normalize_styling( $styling ): array {
		if ( ! is_array( $styling ) ) {
			return [];
		}

		$styling = array_values(
			array_unique(
				array_filter(
					array_map( 'strval', $styling )
				)
			)
		);

		usort(
			$styling,
			static function ( string $left, string $right ): int {
				$left_index  = array_search( $left, self::STYLING_ORDER, true );
				$right_index = array_search( $right, self::STYLING_ORDER, true );

				$left_index  = false === $left_index ? PHP_INT_MAX : $left_index;
				$right_index = false === $right_index ? PHP_INT_MAX : $right_index;

				return $left_index <=> $right_index;
			}
		);

		return $styling;
	}

	/**
	 * Resolve highlight colour from inline style or explicit preset class.
	 *
	 * @param \DOMElement $node Mark element.
	 * @return string|null
	 */
	private static function resolve_highlight_color( \DOMElement $node ): ?string {
		$inline_color = self::extract_css_color( $node->getAttribute( 'style' ), 'background-color' );

		if ( null !== $inline_color && ! self::is_transparent_color( $inline_color ) ) {
			return $inline_color;
		}

		if ( ! self::has_explicit_inline_color_class( $node->getAttribute( 'class' ) ) ) {
			return null;
		}

		$preset_color = self::resolve_preset_background_color( $node->getAttribute( 'class' ) );

		if ( null === $preset_color || self::is_transparent_color( $preset_color ) ) {
			return null;
		}

		return $preset_color;
	}

	/**
	 * Resolve text colour from inline style or explicit preset class.
	 *
	 * @param \DOMElement $node Span or mark element.
	 * @return string|null
	 */
	private static function resolve_text_color( \DOMElement $node ): ?string {
		$inline_color = self::extract_css_color( $node->getAttribute( 'style' ), 'color' );

		if ( null !== $inline_color && ! self::is_transparent_color( $inline_color ) ) {
			return $inline_color;
		}

		if ( ! self::has_explicit_inline_color_class( $node->getAttribute( 'class' ) ) ) {
			return null;
		}

		return self::resolve_preset_text_color( $node->getAttribute( 'class' ) );
	}

	/**
	 * Read a CSS colour value from an inline style attribute.
	 *
	 * @param string $style Inline style attribute.
	 * @param string $property CSS property name.
	 * @return string|null
	 */
	private static function extract_css_color( string $style, string $property ): ?string {
		$style = trim( $style );

		if ( '' === $style ) {
			return null;
		}

		$pattern = sprintf(
			'/(?:^|;)\s*%s\s*:\s*([^;]+)/i',
			preg_quote( $property, '/' )
		);

		if ( ! preg_match( $pattern, $style, $matches ) ) {
			return null;
		}

		$color = trim( $matches[1] );

		return '' !== $color ? $color : null;
	}

	/**
	 * Whether a CSS colour value is fully transparent.
	 *
	 * @param string $color CSS colour value.
	 * @return bool
	 */
	private static function is_transparent_color( string $color ): bool {
		$color = strtolower( trim( $color ) );

		if ( 'transparent' === $color ) {
			return true;
		}

		if ( preg_match( '/^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/', $color, $matches ) ) {
			return (float) $matches[1] <= 0;
		}

		if ( preg_match( '/^#([0-9a-f]{8})$/', $color, $matches ) ) {
			return 0 === hexdec( substr( $matches[1], 6, 2 ) );
		}

		return false;
	}

	/**
	 * Resolve block-level text colour from paragraph block attributes.
	 *
	 * @param array<string, mixed> $attrs Parsed block attributes.
	 * @return string|null
	 */
	private static function resolve_block_text_color_from_attrs( array $attrs ): ?string {
		if (
			isset( $attrs['style']['color']['text'] )
			&& is_string( $attrs['style']['color']['text'] )
			&& '' !== trim( $attrs['style']['color']['text'] )
		) {
			$color = trim( $attrs['style']['color']['text'] );

			if ( ! self::is_transparent_color( $color ) ) {
				return $color;
			}
		}

		if ( ! empty( $attrs['textColor'] ) && is_string( $attrs['textColor'] ) ) {
			$slug = trim( $attrs['textColor'] );

			if ( '' !== $slug ) {
				return self::get_color_preset_map()[ $slug ] ?? null;
			}
		}

		return null;
	}

	/**
	 * Resolve block-level background colour from block attributes.
	 *
	 * @param array<string, mixed> $attrs Parsed block attributes.
	 * @return string|null
	 */
	private static function resolve_block_background_color_from_attrs( array $attrs ): ?string {
		if (
			isset( $attrs['style']['color']['background'] )
			&& is_string( $attrs['style']['color']['background'] )
			&& '' !== trim( $attrs['style']['color']['background'] )
		) {
			$color = trim( $attrs['style']['color']['background'] );

			if ( ! self::is_transparent_color( $color ) ) {
				return $color;
			}
		}

		if ( ! empty( $attrs['backgroundColor'] ) && is_string( $attrs['backgroundColor'] ) ) {
			$slug = trim( $attrs['backgroundColor'] );

			if ( '' !== $slug ) {
				return self::get_color_preset_map()[ $slug ] ?? null;
			}
		}

		return null;
	}

	/**
	 * Resolve list wrapper colour from saved `<ul>` / `<ol>` markup.
	 *
	 * @param string               $inner_html Saved list HTML.
	 * @param array<string, mixed> $attrs      Parsed list block attributes.
	 * @param string               $color_type Either `text` or `background`.
	 * @return string|null
	 */
	private static function resolve_list_wrapper_color_from_html( string $inner_html, array $attrs, string $color_type ): ?string {
		$primary_tag   = ! empty( $attrs['ordered'] ) ? 'ol' : 'ul';
		$alternate_tag = 'ol' === $primary_tag ? 'ul' : 'ol';

		$from_primary = self::resolve_wrapper_color_from_html_tag( $inner_html, $primary_tag, $color_type );

		if ( null !== $from_primary ) {
			return $from_primary;
		}

		return self::resolve_wrapper_color_from_html_tag( $inner_html, $alternate_tag, $color_type );
	}

	/**
	 * Read class/style from the first matching tag via the HTML Tag Processor.
	 *
	 * @param string $inner_html Saved HTML.
	 * @param string $tag        Tag name.
	 * @return array{class: string, style: string}|null
	 */
	private static function get_first_tag_attributes( string $inner_html, string $tag ): ?array {
		$processor = new \WP_HTML_Tag_Processor( $inner_html );

		if ( ! $processor->next_tag( strtoupper( $tag ) ) ) {
			return null;
		}

		return [
			'class' => (string) ( $processor->get_attribute( 'class' ) ?? '' ),
			'style' => (string) ( $processor->get_attribute( 'style' ) ?? '' ),
		];
	}

	/**
	 * Resolve wrapper text or background colour from tag attributes.
	 *
	 * @param string $inner_html Saved HTML including the wrapper tag.
	 * @param string $tag        Wrapper tag name.
	 * @param string $color_type Either `text` or `background`.
	 * @return string|null
	 */
	private static function resolve_wrapper_color_from_html_tag( string $inner_html, string $tag, string $color_type ): ?string {
		$attributes = self::get_first_tag_attributes( $inner_html, $tag );

		if ( null === $attributes ) {
			return null;
		}

		if ( 'background' === $color_type ) {
			return self::resolve_block_background_color_from_tag_attributes(
				$attributes['class'],
				$attributes['style']
			);
		}

		return self::resolve_block_text_color_from_tag_attributes(
			$attributes['class'],
			$attributes['style']
		);
	}

	/**
	 * Resolve block-level text colour from wrapper class and style attributes.
	 *
	 * @param string $class_names Wrapper class attribute.
	 * @param string $style       Wrapper style attribute.
	 * @return string|null
	 */
	private static function resolve_block_text_color_from_tag_attributes( string $class_names, string $style ): ?string {
		if ( '' !== $style ) {
			$color = self::extract_css_color( html_entity_decode( $style, ENT_QUOTES ), 'color' );

			if ( null !== $color && ! self::is_transparent_color( $color ) ) {
				return $color;
			}
		}

		if ( '' !== $class_names ) {
			return self::resolve_block_preset_text_color( $class_names );
		}

		return null;
	}

	/**
	 * Resolve block-level background colour from wrapper class and style attributes.
	 *
	 * @param string $class_names Wrapper class attribute.
	 * @param string $style       Wrapper style attribute.
	 * @return string|null
	 */
	private static function resolve_block_background_color_from_tag_attributes( string $class_names, string $style ): ?string {
		if ( '' !== $style ) {
			$color = self::extract_css_color( html_entity_decode( $style, ENT_QUOTES ), 'background-color' );

			if ( null !== $color && ! self::is_transparent_color( $color ) ) {
				return $color;
			}
		}

		if ( '' !== $class_names ) {
			return self::resolve_block_preset_background_color( $class_names );
		}

		return null;
	}

	/**
	 * Resolve a block-level preset background colour from wrapper classes.
	 *
	 * @param string $class_names Wrapper class attribute.
	 * @return string|null
	 */
	private static function resolve_block_preset_background_color( string $class_names ): ?string {
		if ( ! preg_match( '/\bhas-background\b/', $class_names ) ) {
			return null;
		}

		$slug = self::extract_preset_slug( $class_names, 'background-color' );

		if ( null === $slug ) {
			return null;
		}

		return self::get_color_preset_map()[ $slug ] ?? null;
	}

	/**
	 * Resolve block-level text colour from saved wrapper tag markup.
	 *
	 * @param string $inner_html Saved element HTML including the wrapper tag.
	 * @param string $tag        Wrapper tag name (e.g. `p`, `li`).
	 * @return string|null
	 */
	private static function resolve_block_text_color_from_html( string $inner_html, string $tag ): ?string {
		return self::resolve_wrapper_color_from_html_tag( $inner_html, $tag, 'text' );
	}

	/**
	 * Resolve a block-level preset text colour from `<p>` classes.
	 *
	 * @param string $class_names Paragraph class attribute.
	 * @return string|null
	 */
	private static function resolve_block_preset_text_color( string $class_names ): ?string {
		if ( ! preg_match( '/\bhas-text-color\b/', $class_names ) ) {
			return null;
		}

		$slug = self::extract_preset_slug( $class_names, 'color' );

		if ( null === $slug ) {
			return null;
		}

		return self::get_color_preset_map()[ $slug ] ?? null;
	}

	/**
	 * Whether an element was explicitly coloured inline in the block editor.
	 *
	 * @param string $class_names Element class attribute.
	 * @return bool
	 */
	private static function has_explicit_inline_color_class( string $class_names ): bool {
		return (bool) preg_match( '/\bhas-inline-color\b/', $class_names );
	}

	/**
	 * Resolve a theme text colour slug from an inline element class list.
	 *
	 * @param string $class_names Element class attribute.
	 * @return string|null
	 */
	private static function resolve_preset_text_color( string $class_names ): ?string {
		$slug = self::extract_preset_slug( $class_names, 'color' );

		if ( null === $slug ) {
			return null;
		}

		return self::get_color_preset_map()[ $slug ] ?? null;
	}

	/**
	 * Resolve a theme background colour slug from an inline element class list.
	 *
	 * @param string $class_names Element class attribute.
	 * @return string|null
	 */
	private static function resolve_preset_background_color( string $class_names ): ?string {
		$slug = self::extract_preset_slug( $class_names, 'background-color' );

		if ( null === $slug ) {
			return null;
		}

		return self::get_color_preset_map()[ $slug ] ?? null;
	}

	/**
	 * Extract a palette slug from a WordPress colour class.
	 *
	 * @param string $class_names Element class attribute.
	 * @param string $suffix      Either "color" or "background-color".
	 * @return string|null
	 */
	private static function extract_preset_slug( string $class_names, string $suffix ): ?string {
		$class_names = trim( $class_names );

		if ( '' === $class_names ) {
			return null;
		}

		$pattern = sprintf(
			'/\bhas-([a-z0-9-]+)-%s\b/',
			preg_quote( $suffix, '/' )
		);

		if ( ! preg_match_all( $pattern, $class_names, $matches ) ) {
			return null;
		}

		foreach ( $matches[1] as $slug ) {
			if ( 'inline' === $slug || 'text' === $slug ) {
				continue;
			}

			return $slug;
		}

		return null;
	}

	/**
	 * Build a cached slug-to-colour map from theme settings.
	 *
	 * Used only to resolve explicit inline preset classes on span/mark elements.
	 * The map is not applied to unstyled body text.
	 *
	 * @return array<string, string>
	 */
	private static function get_color_preset_map(): array {
		if ( null !== self::$color_preset_map ) {
			return self::$color_preset_map;
		}

		$map     = [];
		$palette = wp_get_global_settings( array( 'color', 'palette' ) );
		$sources = array( 'theme', 'default', 'custom' );
		$palette = is_array( $palette ) ? $palette : [];

		foreach ( $sources as $source ) {
			if ( empty( $palette[ $source ] ) || ! is_array( $palette[ $source ] ) ) {
				continue;
			}

			foreach ( $palette[ $source ] as $entry ) {
				if (
					! is_array( $entry )
					|| empty( $entry['slug'] )
					|| empty( $entry['color'] )
					|| ! is_string( $entry['slug'] )
					|| ! is_string( $entry['color'] )
				) {
					continue;
				}

				$map[ $entry['slug'] ] = $entry['color'];
			}
		}

		self::$color_preset_map = $map;

		return self::$color_preset_map;
	}
}
