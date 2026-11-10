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
 * Helpers for mapping a core/group block's colours and padding to the `visual_settings`
 * of a beehiiv `section` block.
 *
 * Only background colour, text colour and padding are mapped. Borders and other Group
 * styling stay at beehiiv defaults.
 *
 * @since x.x.x
 */
final class GroupBlockConverter {

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

		foreach ( self::resolve_padding( $attrs ) as $side => $pixels ) {
			$settings[ 'inner_spacing_' . $side ] = $pixels;
		}

		return $settings;
	}

	/**
	 * Resolve each padding side of a Group block to whole pixels.
	 *
	 * A side whose value cannot be turned into pixels (percentages, viewport units,
	 * `clamp()` presets) is left out so beehiiv keeps its default for that side.
	 *
	 * @param array<string, mixed> $attrs Parsed block attributes.
	 * @return array<string, int> Pixels keyed by side.
	 */
	private static function resolve_padding( array $attrs ): array {
		$padding = $attrs['style']['spacing']['padding'] ?? null;

		if ( is_string( $padding ) || is_int( $padding ) ) {
			$padding = array_fill_keys( self::SIDES, $padding );
		}

		if ( ! is_array( $padding ) ) {
			return [];
		}

		$resolved = [];

		foreach ( self::SIDES as $side ) {
			if ( ! isset( $padding[ $side ] ) ) {
				continue;
			}

			$pixels = self::to_pixels( $padding[ $side ] );

			if ( null !== $pixels ) {
				$resolved[ $side ] = $pixels;
			}
		}

		return $resolved;
	}

	/**
	 * Convert one padding value to whole pixels.
	 *
	 * @param mixed $value Padding value: a number, a CSS length, or a spacing preset.
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
	 * Convert a plain CSS length (`40px`, `2.5rem`, `1em`, `12`) to whole pixels.
	 *
	 * @param string $length CSS length.
	 * @return int|null Pixels, or null for any other unit or function.
	 */
	private static function css_length_to_pixels( string $length ): ?int {
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

		foreach ( array( 'theme', 'default', 'custom' ) as $source ) {
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
