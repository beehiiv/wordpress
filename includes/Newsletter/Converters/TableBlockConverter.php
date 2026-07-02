<?php
/**
 * Converts WordPress core/table blocks to beehiiv table blocks.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter\Converters;

use Beehiiv\Newsletter\FormattedTextParser;

defined( 'ABSPATH' ) || exit;

/**
 * Helpers for mapping core/table blocks to beehiiv table blocks.
 *
 * @since 1.0.0
 */
final class TableBlockConverter {

	/**
	 * Parse thead rows from saved table block HTML.
	 *
	 * @param string $inner_html Saved table block HTML.
	 * @return array<int, array<int, array<string, mixed>>>
	 * @since 1.0.0
	 */
	public static function parse_thead_rows_from_inner_html( string $inner_html ): array {
		$table_html = self::extract_table_html( $inner_html );

		if ( '' === $table_html || ! preg_match( '/<thead\b[^>]*>(.*?)<\/thead>/is', $table_html, $thead_match ) ) {
			return [];
		}

		return self::parse_table_row_html( $thead_match[1] );
	}

	/**
	 * Parse tbody rows from saved table block HTML.
	 *
	 * Footer rows are omitted; beehiiv has no table footer support.
	 *
	 * @param string $inner_html Saved table block HTML.
	 * @return array<int, array<int, array<string, mixed>>>
	 * @since 1.0.0
	 */
	public static function parse_tbody_rows_from_inner_html( string $inner_html ): array {
		$table_html = self::extract_table_html( $inner_html );

		if ( '' === $table_html ) {
			return [];
		}

		if ( preg_match( '/<tbody\b[^>]*>(.*?)<\/tbody>/is', $table_html, $tbody_match ) ) {
			return self::parse_table_row_html( $tbody_match[1] );
		}

		$table_without_sections = preg_replace( '/<thead\b[^>]*>.*?<\/thead>/is', '', $table_html );
		$table_without_sections = preg_replace( '/<tfoot\b[^>]*>.*?<\/tfoot>/is', '', $table_without_sections );

		return self::parse_table_row_html( (string) $table_without_sections );
	}

	/**
	 * Whether the WordPress table block Header section is enabled.
	 *
	 * Mirrors the block editor Header section toggle (`head && head.length`).
	 *
	 * @param array<string, mixed> $attrs Parsed block attrs.
	 * @return bool
	 * @since 1.0.0
	 */
	public static function table_has_header_section( array $attrs ): bool {
		$head = $attrs['head'] ?? [];

		return is_array( $head ) && count( $head ) > 0;
	}

	/**
	 * Convert WordPress table section rows (head or body) to beehiiv rows.
	 *
	 * @param mixed $section_rows Parsed attrs.head or attrs.body array.
	 * @return array<int, array<int, array<string, mixed>>>
	 * @since 1.0.0
	 */
	public static function convert_table_section_rows( $section_rows ): array {
		if ( ! is_array( $section_rows ) || empty( $section_rows ) ) {
			return [];
		}

		$beehiiv_rows = [];

		foreach ( $section_rows as $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}

			$beehiiv_row = self::convert_table_row( $row );

			if ( ! empty( $beehiiv_row ) ) {
				$beehiiv_rows[] = $beehiiv_row;
			}
		}

		return $beehiiv_rows;
	}

	/**
	 * Convert a WordPress table row to a beehiiv table row.
	 *
	 * @param array<string, mixed> $row Parsed table row with a cells array.
	 * @return array<int, array<string, mixed>>
	 * @since 1.0.0
	 */
	public static function convert_table_row( array $row ): array {
		$cells = $row['cells'] ?? [];

		if ( ! is_array( $cells ) || empty( $cells ) ) {
			return [];
		}

		$beehiiv_cells = [];

		foreach ( $cells as $cell ) {
			if ( ! is_array( $cell ) ) {
				continue;
			}

			$beehiiv_cells[] = self::convert_table_cell( $cell );
		}

		return $beehiiv_cells;
	}

	/**
	 * Convert a WordPress table cell to beehiiv TableCellData.
	 *
	 * @param array<string, mixed> $cell Parsed cell data from attrs.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function convert_table_cell( array $cell ): array {
		$content = trim( (string) ( $cell['content'] ?? '' ) );
		$parsed  = FormattedTextParser::parse( $content );

		$beehiiv_cell = [];

		if ( FormattedTextParser::has_rich_formatting( $parsed['formattedText'] ) ) {
			$beehiiv_cell['formattedText'] = $parsed['formattedText'];
		} else {
			$beehiiv_cell['text'] = $parsed['plaintext'];
		}

		$alignment = self::normalize_table_cell_alignment( $cell['align'] ?? null );

		if ( null !== $alignment ) {
			$beehiiv_cell['alignment'] = $alignment;
		}

		$colspan = self::normalize_table_cell_span( $cell['colspan'] ?? null );

		if ( null !== $colspan ) {
			$beehiiv_cell['colspan'] = $colspan;
		}

		$rowspan = self::normalize_table_cell_span( $cell['rowspan'] ?? null );

		if ( null !== $rowspan ) {
			$beehiiv_cell['rowspan'] = $rowspan;
		}

		return $beehiiv_cell;
	}

	/**
	 * Parse table rows from saved innerHTML when block attrs are not hydrated.
	 *
	 * PHP parse_blocks() does not run query-sourced attribute extraction, so
	 * attrs.head and attrs.body are often empty even for block-editor tables.
	 *
	 * @param string    $inner_html          Saved table block HTML.
	 * @param bool|null $header_row_enabled  Whether the Header section is enabled in
	 *                                       block attrs. False ignores thead. Null or
	 *                                       true includes thead when present.
	 * @return array{rows: array<int, array<int, array<string, mixed>>>, header_row: bool}
	 * @since 1.0.0
	 */
	public static function parse_table_rows_from_inner_html(
		string $inner_html,
		?bool $header_row_enabled = null
	): array {
		$result = [
			'rows'       => [],
			'header_row' => false,
		];

		$table_html = self::extract_table_html( $inner_html );

		if ( '' === $table_html ) {
			return $result;
		}

		$rows          = [];
		$header_row    = false;
		$include_thead = false !== $header_row_enabled;

		if ( $include_thead && preg_match( '/<thead\b[^>]*>(.*?)<\/thead>/is', $table_html, $thead_match ) ) {
			$head_rows = self::parse_table_row_html( $thead_match[1] );

			if ( ! empty( $head_rows ) ) {
				$rows       = $head_rows;
				$header_row = true;
			}
		}

		if ( preg_match( '/<tbody\b[^>]*>(.*?)<\/tbody>/is', $table_html, $tbody_match ) ) {
			$rows = array_merge( $rows, self::parse_table_row_html( $tbody_match[1] ) );
		} elseif ( empty( $rows ) ) {
			$rows = self::parse_tbody_rows_from_inner_html( $inner_html );
		}

		$result['rows']       = $rows;
		$result['header_row'] = $header_row;

		return $result;
	}

	/**
	 * Whether a converted beehiiv table has at least one non-empty cell.
	 *
	 * @param array<int, array<int, array<string, mixed>>> $rows Converted table rows.
	 * @return bool
	 * @since 1.0.0
	 */
	public static function table_rows_have_content( array $rows ): bool {
		foreach ( $rows as $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}

			foreach ( $row as $cell ) {
				if ( is_array( $cell ) && self::table_cell_has_content( $cell ) ) {
					return true;
				}
			}
		}

		return false;
	}

	/**
	 * Extract the `<table>` element HTML from a table block fragment.
	 *
	 * @param string $inner_html Saved table block HTML.
	 * @return string
	 * @since 1.0.0
	 */
	private static function extract_table_html( string $inner_html ): string {
		if ( preg_match( '/<table\b[^>]*>.*?<\/table>/is', $inner_html, $matches ) ) {
			return $matches[0];
		}

		return '';
	}

	/**
	 * Parse table rows from a table section HTML fragment.
	 *
	 * @param string $section_html HTML for thead, tbody, or an entire table.
	 * @return array<int, array<int, array<string, mixed>>>
	 * @since 1.0.0
	 */
	private static function parse_table_row_html( string $section_html ): array {
		$rows = [];

		if ( ! preg_match_all( '/<tr\b[^>]*>.*?<\/tr>/is', $section_html, $row_matches ) ) {
			return [];
		}

		foreach ( $row_matches[0] as $row_html ) {
			$beehiiv_row = self::parse_table_cells_from_row_html( $row_html );

			if ( ! empty( $beehiiv_row ) ) {
				$rows[] = $beehiiv_row;
			}
		}

		return $rows;
	}

	/**
	 * Parse beehiiv cells from a single table row's HTML.
	 *
	 * @param string $row_html Saved `<tr>` HTML.
	 * @return array<int, array<string, mixed>>
	 * @since 1.0.0
	 */
	private static function parse_table_cells_from_row_html( string $row_html ): array {
		$cells = [];

		if ( ! preg_match_all( '/<(td|th)\b[^>]*>.*?<\/\1>/is', $row_html, $cell_matches ) ) {
			return [];
		}

		foreach ( $cell_matches[0] as $cell_html ) {
			$cells[] = self::convert_table_cell_from_html( $cell_html );
		}

		return $cells;
	}

	/**
	 * Convert a saved table cell element to beehiiv TableCellData.
	 *
	 * @param string $cell_html Saved `<td>` or `<th>` HTML.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	private static function convert_table_cell_from_html( string $cell_html ): array {
		$tag = 'td';

		if ( preg_match( '/<(td|th)\b/i', $cell_html, $tag_match ) ) {
			$tag = strtolower( $tag_match[1] );
		}

		$processor = new \WP_HTML_Tag_Processor( $cell_html );
		$align     = null;
		$colspan   = null;
		$rowspan   = null;

		if ( $processor->next_tag( strtoupper( $tag ) ) ) {
			$align   = self::normalize_table_cell_alignment(
				$processor->get_attribute( 'data-align' ) ?? $processor->get_attribute( 'align' )
			);
			$colspan = self::normalize_table_cell_span( $processor->get_attribute( 'colspan' ) );
			$rowspan = self::normalize_table_cell_span( $processor->get_attribute( 'rowspan' ) );
		}

		$inline_html = FormattedTextParser::extract_element_inner_html( $cell_html, $tag );
		$parsed      = FormattedTextParser::parse( trim( $inline_html ) );

		$beehiiv_cell = [];

		if ( FormattedTextParser::has_rich_formatting( $parsed['formattedText'] ) ) {
			$beehiiv_cell['formattedText'] = $parsed['formattedText'];
		} else {
			$beehiiv_cell['text'] = $parsed['plaintext'];
		}

		if ( null !== $align ) {
			$beehiiv_cell['alignment'] = $align;
		}

		if ( null !== $colspan ) {
			$beehiiv_cell['colspan'] = $colspan;
		}

		if ( null !== $rowspan ) {
			$beehiiv_cell['rowspan'] = $rowspan;
		}

		return $beehiiv_cell;
	}

	/**
	 * Normalize a WordPress table cell alignment to a beehiiv value.
	 *
	 * @param mixed $alignment Raw alignment from attrs or HTML.
	 * @return string|null left, center, right, or null when unset/invalid.
	 * @since 1.0.0
	 */
	private static function normalize_table_cell_alignment( $alignment ): ?string {
		if ( ! is_string( $alignment ) || '' === trim( $alignment ) ) {
			return null;
		}

		$alignment = strtolower( trim( $alignment ) );

		if ( in_array( $alignment, [ 'left', 'center', 'right' ], true ) ) {
			return $alignment;
		}

		return null;
	}

	/**
	 * Normalize colspan/rowspan values for beehiiv TableCellData.
	 *
	 * @param mixed $span Raw span value from attrs or HTML.
	 * @return int|null Integer greater than 1, or null when unset.
	 * @since 1.0.0
	 */
	private static function normalize_table_cell_span( $span ): ?int {
		if ( null === $span || '' === $span ) {
			return null;
		}

		if ( ! is_numeric( $span ) ) {
			return null;
		}

		$value = (int) $span;

		return $value > 1 ? $value : null;
	}

	/**
	 * Whether a converted beehiiv table cell contains text.
	 *
	 * @param array<string, mixed> $cell Converted table cell data.
	 * @return bool
	 * @since 1.0.0
	 */
	private static function table_cell_has_content( array $cell ): bool {
		if ( isset( $cell['text'] ) && '' !== trim( (string) $cell['text'] ) ) {
			return true;
		}

		if ( ! isset( $cell['formattedText'] ) || ! is_array( $cell['formattedText'] ) ) {
			return false;
		}

		foreach ( $cell['formattedText'] as $segment ) {
			if ( ! is_array( $segment ) ) {
				continue;
			}

			if ( '' !== trim( (string) ( $segment['text'] ?? '' ) ) ) {
				return true;
			}
		}

		return false;
	}
}
