<?php
/**
 * Maps core/group block styling to beehiiv section visual settings.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter\Converters;

use Beehiiv\Newsletter\FormattedTextParser;

defined( 'ABSPATH' ) || exit;

/**
 * Helpers for mapping a core/group block's colours, padding, margin and border to the
 * `visual_settings` of a beehiiv `section` block.
 *
 * Background colour, text colour, padding, margin, and the border's colour, width, style and
 * radius are mapped. Other Group styling stays at beehiiv defaults.
 *
 * @since x.x.x
 */
final class GroupBlockConverter {

	/**
	 * Border styles beehiiv accepts for a section.
	 *
	 * @var array<int, string>
	 */
	private const BORDER_STYLES = [ 'solid', 'dashed', 'dotted' ];

	/**
	 * Corner names in WordPress and the matching beehiiv setting suffix.
	 *
	 * @var array<string, string>
	 */
	private const CORNERS = [
		'topLeft'     => 'top_left',
		'topRight'    => 'top_right',
		'bottomLeft'  => 'bottom_left',
		'bottomRight' => 'bottom_right',
	];

	/**
	 * Pixels in one `rem` or `em`, used to turn relative padding into whole pixels.
	 *
	 * @var int
	 */
	private const PIXELS_PER_REM = 16;

	/**
	 * Padding sides, in the order beehiiv names them.
	 *
	 * @var array<int, string>
	 */
	private const SIDES = [ 'top', 'bottom', 'left', 'right' ];

	/**
	 * Cached slug-to-size map for theme spacing presets.
	 *
	 * @var array<string, string>|null
	 */
	private static ?array $spacing_preset_map = null;

	/**
	 * Build the beehiiv section `visual_settings` for a Group block.
	 *
	 * @param array<string, mixed> $wp_block Parsed core/group block.
	 * @return array<string, int|string> Empty when the Group sets no mapped styling.
	 * @since x.x.x
	 */
	public static function build_visual_settings( array $wp_block ): array {
		$attrs      = is_array( $wp_block['attrs'] ?? null ) ? $wp_block['attrs'] : [];
		$inner_html = (string) ( $wp_block['innerHTML'] ?? '' );
		$settings   = [];

		$background_color = FormattedTextParser::resolve_group_block_background_color( $inner_html, $attrs );

		if ( null !== $background_color && '' !== $background_color ) {
			$settings['background_color'] = $background_color;
		}

		$text_color = FormattedTextParser::resolve_group_block_text_color( $inner_html, $attrs );

		if ( null !== $text_color && '' !== $text_color ) {
			$settings['text_color'] = $text_color;
		}

		foreach ( self::resolve_spacing( $attrs, 'padding' ) as $side => $pixels ) {
			$settings[ 'inner_spacing_' . $side ] = $pixels;
		}

		foreach ( self::resolve_spacing( $attrs, 'margin' ) as $side => $pixels ) {
			$settings[ 'outer_spacing_' . $side ] = $pixels;
		}

		return array_merge( $settings, self::resolve_border( $attrs, $inner_html ) );
	}

	/**
	 * Resolve a Group block's border to beehiiv border settings.
	 *
	 * A border colour, style or width that differs between sides cannot be sent, because
	 * beehiiv takes one colour and one style; widths and radii can be sent per side or
	 * corner. A border with a colour or width but no style is sent as `solid`, as WordPress
	 * draws it.
	 *
	 * @param array<string, mixed> $attrs      Parsed block attributes.
	 * @param string               $inner_html Saved Group HTML including the `<div>` wrapper.
	 * @return array<string, int|string>
	 */
	private static function resolve_border( array $attrs, string $inner_html ): array {
		$border = $attrs['style']['border'] ?? [];
		$border = is_array( $border ) ? $border : [];

		$settings = self::resolve_border_widths( $border );
		$color    = FormattedTextParser::resolve_group_block_border_color( $inner_html, $attrs )
			?? self::shared_side_value( $border, 'color' );

		if ( null !== $color && '' !== $color ) {
			$settings['border_color'] = $color;
		}

		$style = self::resolve_border_style( $border );

		if ( null === $style && isset( $border['style'] ) ) {
			$style = false;
		}

		if ( null === $style && ( isset( $settings['border_color'] ) || self::has_border_width( $settings ) ) ) {
			$style = 'solid';
		}

		if ( is_string( $style ) ) {
			$settings['border_style'] = $style;
		}

		return array_merge( $settings, self::resolve_border_radius( $border ) );
	}

	/**
	 * Resolve border widths, one value for every side or one per side.
	 *
	 * @param array<string, mixed> $border Group `style.border` attributes.
	 * @return array<string, int>
	 */
	private static function resolve_border_widths( array $border ): array {
		if ( isset( $border['width'] ) ) {
			$pixels = self::to_pixels( $border['width'] );

			return null === $pixels ? [] : [ 'border_width' => $pixels ];
		}

		$widths = [];

		foreach ( self::SIDES as $side ) {
			if ( ! isset( $border[ $side ]['width'] ) ) {
				continue;
			}

			$pixels = self::to_pixels( $border[ $side ]['width'] );

			if ( null !== $pixels ) {
				$widths[ 'border_width_' . $side ] = $pixels;
			}
		}

		return $widths;
	}

	/**
	 * Resolve the border style, from one value or from sides that all agree.
	 *
	 * @param array<string, mixed> $border Group `style.border` attributes.
	 * @return string|null A style beehiiv accepts, or null when none is set or it is not accepted.
	 */
	private static function resolve_border_style( array $border ): ?string {
		$style = isset( $border['style'] ) && is_string( $border['style'] )
			? $border['style']
			: self::shared_side_value( $border, 'style' );

		$style = null === $style ? null : strtolower( trim( $style ) );

		return in_array( $style, self::BORDER_STYLES, true ) ? $style : null;
	}

	/**
	 * Resolve border radius, one value for every corner or one per corner.
	 *
	 * @param array<string, mixed> $border Group `style.border` attributes.
	 * @return array<string, int>
	 */
	private static function resolve_border_radius( array $border ): array {
		$radius = $border['radius'] ?? null;

		if ( is_string( $radius ) || is_int( $radius ) || is_float( $radius ) ) {
			$pixels = self::to_pixels( $radius );

			return null === $pixels ? [] : [ 'border_radius' => $pixels ];
		}

		if ( ! is_array( $radius ) ) {
			return [];
		}

		$corners = [];

		foreach ( self::CORNERS as $corner => $suffix ) {
			if ( ! isset( $radius[ $corner ] ) ) {
				continue;
			}

			$pixels = self::to_pixels( $radius[ $corner ] );

			if ( null !== $pixels ) {
				$corners[ 'border_radius_' . $suffix ] = $pixels;
			}
		}

		return $corners;
	}

	/**
	 * Whether any border width was resolved.
	 *
	 * @param array<string, int|string> $settings Border settings resolved so far.
	 * @return bool
	 */
	private static function has_border_width( array $settings ): bool {
		foreach ( array_keys( $settings ) as $key ) {
			if ( 0 === strpos( (string) $key, 'border_width' ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Read a per-side value that every set side shares.
	 *
	 * @param array<string, mixed> $border Group `style.border` attributes.
	 * @param string               $key    Per-side key, `color` or `style`.
	 * @return string|null The shared value, or null when no side sets it or the sides differ.
	 */
	private static function shared_side_value( array $border, string $key ): ?string {
		$values = [];

		foreach ( self::SIDES as $side ) {
			$value = $border[ $side ][ $key ] ?? null;

			if ( ! is_string( $value ) ) {
				continue;
			}

			$value = 'color' === $key ? FormattedTextParser::resolve_color_reference( $value ) : trim( $value );

			if ( null !== $value && '' !== $value ) {
				$values[] = $value;
			}
		}

		$values = array_unique( $values );

		return 1 === count( $values ) ? $values[0] : null;
	}

	/**
	 * Resolve each side of a Group block's padding or margin to whole pixels.
	 *
	 * A side whose value cannot be turned into pixels (percentages, viewport units,
	 * `auto`, negative values, `clamp()` presets) is left out so beehiiv keeps its default
	 * for that side.
	 *
	 * @param array<string, mixed> $attrs    Parsed block attributes.
	 * @param string               $property Spacing property, `padding` or `margin`.
	 * @return array<string, int> Pixels keyed by side.
	 */
	private static function resolve_spacing( array $attrs, string $property ): array {
		$spacing = $attrs['style']['spacing'][ $property ] ?? null;

		if ( is_string( $spacing ) || is_int( $spacing ) ) {
			$spacing = array_fill_keys( self::SIDES, $spacing );
		}

		if ( ! is_array( $spacing ) ) {
			return [];
		}

		$resolved = [];

		foreach ( self::SIDES as $side ) {
			if ( ! isset( $spacing[ $side ] ) ) {
				continue;
			}

			$pixels = self::to_pixels( $spacing[ $side ] );

			if ( null !== $pixels ) {
				$resolved[ $side ] = $pixels;
			}
		}

		return $resolved;
	}

	/**
	 * Convert one padding or margin value to whole pixels.
	 *
	 * @param mixed $value Spacing value: a number, a CSS length, or a spacing preset.
	 * @return int|null Pixels, or null when the value cannot be converted.
	 */
	private static function to_pixels( $value ): ?int {
		if ( is_int( $value ) || is_float( $value ) ) {
			return max( 0, (int) round( $value ) );
		}

		if ( ! is_string( $value ) ) {
			return null;
		}

		$value = trim( $value );
		$slug  = self::extract_spacing_preset_slug( $value );

		if ( null !== $slug ) {
			$size = self::get_spacing_preset_map()[ $slug ] ?? null;

			return null === $size ? null : self::css_length_to_pixels( $size );
		}

		return self::css_length_to_pixels( $value );
	}

	/**
	 * Convert a CSS length (`40px`, `2.5rem`, `1em`, `12`) or a fluid size to whole pixels.
	 *
	 * Themes often define spacing as `clamp()`, `min()` or `max()`. A newsletter has no
	 * responsive spacing, so a fluid size is sent at its widest value: `clamp()` at its
	 * maximum, `min()` at its smallest fixed argument, `max()` at its largest. An argument
	 * that is not a fixed length (a `vw` unit, `calc()`) is ignored.
	 *
	 * @param string $length CSS length or fluid size.
	 * @return int|null Pixels, or null for any other unit or function.
	 */
	private static function css_length_to_pixels( string $length ): ?int {
		$length = trim( $length );

		if ( preg_match( '/^(clamp|min|max)\((.*)\)$/is', $length, $call ) ) {
			return self::fluid_size_to_pixels( strtolower( $call[1] ), self::split_arguments( $call[2] ) );
		}

		if ( ! preg_match( '/^(\d+(?:\.\d+)?)\s*(px|rem|em)?$/i', trim( $length ), $matches ) ) {
			return null;
		}

		$number = (float) $matches[1];
		$unit   = strtolower( $matches[2] ?? 'px' );

		if ( 'px' !== $unit ) {
			$number *= self::PIXELS_PER_REM;
		}

		return (int) round( $number );
	}

	/**
	 * Resolve a `clamp()`, `min()` or `max()` size to whole pixels.
	 *
	 * @param string             $name      Function name: `clamp`, `min` or `max`.
	 * @param array<int, string> $arguments Top-level arguments of the function.
	 * @return int|null Pixels, or null when no argument is a fixed length.
	 */
	private static function fluid_size_to_pixels( string $name, array $arguments ): ?int {
		if ( 'clamp' === $name ) {
			// clamp( minimum, preferred, maximum ): the maximum is the widest size.
			return 3 === count( $arguments ) ? self::css_length_to_pixels( $arguments[2] ) : null;
		}

		$values = array_filter(
			array_map( array( self::class, 'css_length_to_pixels' ), $arguments ),
			static function ( $pixels ) {
				return null !== $pixels;
			}
		);

		if ( empty( $values ) ) {
			return null;
		}

		return 'min' === $name ? min( $values ) : max( $values );
	}

	/**
	 * Split a CSS function's arguments on top-level commas.
	 *
	 * @param string $arguments Text between the function's outer parentheses.
	 * @return array<int, string>
	 */
	private static function split_arguments( string $arguments ): array {
		$parts = [];
		$depth = 0;
		$start = 0;
		$total = strlen( $arguments );

		for ( $index = 0; $index < $total; $index++ ) {
			$char = $arguments[ $index ];

			if ( '(' === $char ) {
				++$depth;
			} elseif ( ')' === $char ) {
				--$depth;
			} elseif ( ',' === $char && 0 === $depth ) {
				$parts[] = trim( substr( $arguments, $start, $index - $start ) );
				$start   = $index + 1;
			}
		}

		$parts[] = trim( substr( $arguments, $start ) );

		return $parts;
	}

	/**
	 * Read the preset slug from `var:preset|spacing|40` or `var(--wp--preset--spacing--40)`.
	 *
	 * @param string $value Padding value.
	 * @return string|null Preset slug, or null when the value is not a spacing preset.
	 */
	private static function extract_spacing_preset_slug( string $value ): ?string {
		if ( preg_match( '/^var:preset\|spacing\|([a-z0-9-]+)$/i', $value, $matches ) ) {
			return $matches[1];
		}

		if ( preg_match( '/^var\(--wp--preset--spacing--([a-z0-9-]+)\)$/i', $value, $matches ) ) {
			return $matches[1];
		}

		return null;
	}

	/**
	 * Build a cached slug-to-size map from theme spacing presets.
	 *
	 * @return array<string, string>
	 */
	private static function get_spacing_preset_map(): array {
		if ( null !== self::$spacing_preset_map ) {
			return self::$spacing_preset_map;
		}

		$map   = [];
		$sizes = wp_get_global_settings( array( 'spacing', 'spacingSizes' ) );
		$sizes = is_array( $sizes ) ? $sizes : [];

		// Apply origins in WordPress's own order, so a later origin overrides an earlier one with the same slug.
		// A theme can turn WordPress's default sizes off, and then they are not offered at all.
		$sources = false === wp_get_global_settings( array( 'spacing', 'defaultSpacingSizes' ) )
			? array( 'theme', 'custom' )
			: array( 'default', 'theme', 'custom' );

		foreach ( $sources as $source ) {
			if ( empty( $sizes[ $source ] ) || ! is_array( $sizes[ $source ] ) ) {
				continue;
			}

			foreach ( $sizes[ $source ] as $entry ) {
				if (
					! is_array( $entry )
					|| empty( $entry['slug'] )
					|| ! isset( $entry['size'] )
					|| ! is_string( $entry['slug'] )
					|| ! is_string( $entry['size'] )
				) {
					continue;
				}

				$map[ $entry['slug'] ] = $entry['size'];
			}
		}

		self::$spacing_preset_map = $map;

		return self::$spacing_preset_map;
	}
}
