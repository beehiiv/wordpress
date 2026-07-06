<?php
/**
 * Converts WordPress core/columns blocks to beehiiv columns blocks.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter\Converters;

defined( 'ABSPATH' ) || exit;

/**
 * Helpers for mapping core/columns and core/column blocks to beehiiv columns blocks.
 *
 * @since 1.0.0
 */
final class ColumnsBlockConverter {

	/**
	 * Build a beehiiv columns block from converted column definitions.
	 *
	 * @param array<int, array<string, mixed>> $columns         Column definitions.
	 * @param bool|null                        $stack_on_mobile Whether columns stack on mobile.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function build_beehiiv_columns_block( array $columns, ?bool $stack_on_mobile = null ): array {
		if ( empty( $columns ) ) {
			return [];
		}

		$beehiiv_block = [
			'type'    => 'columns',
			'columns' => array_values( $columns ),
		];

		if ( null !== $stack_on_mobile ) {
			$beehiiv_block['stackOnMobile'] = $stack_on_mobile;
		}

		return $beehiiv_block;
	}

	/**
	 * Build a beehiiv column definition from converted child blocks.
	 *
	 * @param array<int, array<string, mixed>> $blocks                    Child beehiiv blocks.
	 * @param array<string, mixed>             $column_block              Parsed core/column block.
	 * @param string|null                      $parent_vertical_alignment Vertical alignment from
	 *                                                                  the parent core/columns block.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function build_beehiiv_column(
		array $blocks,
		array $column_block,
		?string $parent_vertical_alignment = null
	): array {
		if ( empty( $blocks ) ) {
			return [];
		}

		$attrs      = $column_block['attrs'] ?? [];
		$inner_html = (string) ( $column_block['innerHTML'] ?? '' );

		$beehiiv_column = [
			'blocks' => array_values( $blocks ),
		];

		$width = self::resolve_column_width( $attrs, $inner_html );

		if ( null !== $width ) {
			$beehiiv_column['width'] = $width;
		}

		$vertical_align = self::resolve_column_vertical_alignment( $attrs, $inner_html, $parent_vertical_alignment );

		if ( null !== $vertical_align ) {
			$beehiiv_column['verticalAlign'] = $vertical_align;
		}

		return $beehiiv_column;
	}

	/**
	 * Build a beehiiv column definition from converted blocks and layout options.
	 *
	 * Used when column metadata does not come from a parsed core/column block,
	 * such as core/media-text side columns.
	 *
	 * @param array<int, array<string, mixed>> $blocks          Child beehiiv blocks.
	 * @param int|null                         $width           Column width percentage.
	 * @param string|null                      $vertical_align  top, middle, or bottom.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function build_beehiiv_column_from_definition(
		array $blocks,
		?int $width = null,
		?string $vertical_align = null
	): array {
		if ( empty( $blocks ) ) {
			return [];
		}

		$beehiiv_column = [
			'blocks' => array_values( $blocks ),
		];

		if ( null !== $width ) {
			$beehiiv_column['width'] = $width;
		}

		if ( null !== $vertical_align && '' !== $vertical_align ) {
			$beehiiv_column['verticalAlign'] = $vertical_align;
		}

		return $beehiiv_column;
	}

	/**
	 * Resolve whether columns should stack on mobile.
	 *
	 * @param array<string, mixed> $attrs      Parsed core/columns attrs.
	 * @param string               $inner_html Saved columns HTML.
	 * @return bool
	 * @since 1.0.0
	 */
	public static function resolve_stack_on_mobile( array $attrs, string $inner_html ): bool {
		if ( array_key_exists( 'isStackedOnMobile', $attrs ) ) {
			return (bool) $attrs['isStackedOnMobile'];
		}

		if ( str_contains( $inner_html, 'is-not-stacked-on-mobile' ) ) {
			return false;
		}

		return true;
	}

	/**
	 * Resolve a column's vertical alignment from attrs, HTML, or the parent columns block.
	 *
	 * @param array<string, mixed> $attrs                     Parsed core/column attrs.
	 * @param string               $inner_html                Saved column HTML.
	 * @param string|null          $parent_vertical_alignment Vertical alignment from core/columns.
	 * @return string|null top, middle, bottom, or null when unset.
	 * @since 1.0.0
	 */
	public static function resolve_column_vertical_alignment(
		array $attrs,
		string $inner_html,
		?string $parent_vertical_alignment = null
	): ?string {
		$raw_alignment = null;

		if ( ! empty( $attrs['verticalAlignment'] ) && is_string( $attrs['verticalAlignment'] ) ) {
			$raw_alignment = $attrs['verticalAlignment'];
		} elseif ( preg_match( '/is-vertically-aligned-(top|center|bottom)/', $inner_html, $matches ) ) {
			$raw_alignment = $matches[1];
		} elseif ( null !== $parent_vertical_alignment ) {
			$raw_alignment = $parent_vertical_alignment;
		}

		return self::normalize_column_vertical_alignment( $raw_alignment );
	}

	/**
	 * Normalize WordPress column vertical alignment to a beehiiv value.
	 *
	 * @param string|null $alignment Raw alignment from attrs or HTML classes.
	 * @return string|null top, middle, bottom, or null when unset/invalid.
	 * @since 1.0.0
	 */
	public static function normalize_column_vertical_alignment( ?string $alignment ): ?string {
		if ( ! is_string( $alignment ) || '' === trim( $alignment ) ) {
			return null;
		}

		$alignment = strtolower( trim( $alignment ) );

		$map = [
			'top'    => 'top',
			'center' => 'middle',
			'middle' => 'middle',
			'bottom' => 'bottom',
		];

		return $map[ $alignment ] ?? null;
	}

	/**
	 * Resolve a column width percentage from attrs or saved HTML.
	 *
	 * @param array<string, mixed> $attrs      Parsed core/column attrs.
	 * @param string               $inner_html Saved column HTML.
	 * @return int|null Integer percentage between 1 and 100.
	 * @since 1.0.0
	 */
	public static function resolve_column_width( array $attrs, string $inner_html ): ?int {
		if ( isset( $attrs['width'] ) ) {
			$width = self::parse_width_percentage( $attrs['width'] );

			if ( null !== $width ) {
				return $width;
			}
		}

		$processor = new \WP_HTML_Tag_Processor( $inner_html );

		if ( $processor->next_tag( 'DIV' ) ) {
			$style = $processor->get_attribute( 'style' );

			if ( is_string( $style ) && preg_match( '/flex-basis\s*:\s*([^;]+)/i', $style, $matches ) ) {
				return self::parse_width_percentage( trim( $matches[1] ) );
			}
		}

		return null;
	}

	/**
	 * Parse a width value into an integer percentage.
	 *
	 * @param mixed $value Raw width from attrs or inline style.
	 * @return int|null
	 * @since 1.0.0
	 */
	public static function parse_width_percentage( $value ): ?int {
		if ( is_numeric( $value ) ) {
			$percentage = (int) round( (float) $value );

			return self::is_valid_width_percentage( $percentage ) ? $percentage : null;
		}

		if ( ! is_string( $value ) || '' === trim( $value ) ) {
			return null;
		}

		if ( preg_match( '/^([\d.]+)\s*%?$/', trim( $value ), $matches ) ) {
			$percentage = (int) round( (float) $matches[1] );

			return self::is_valid_width_percentage( $percentage ) ? $percentage : null;
		}

		return null;
	}

	/**
	 * Whether a parsed width is a valid beehiiv column percentage.
	 *
	 * @param int $percentage Parsed width percentage.
	 * @return bool
	 * @since 1.0.0
	 */
	private static function is_valid_width_percentage( int $percentage ): bool {
		return $percentage >= 1 && $percentage <= 100;
	}
}
