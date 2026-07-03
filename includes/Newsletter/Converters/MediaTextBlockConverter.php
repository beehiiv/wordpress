<?php
/**
 * Converts WordPress core/media-text blocks to beehiiv columns blocks.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter\Converters;

defined( 'ABSPATH' ) || exit;

/**
 * Helpers for mapping core/media-text blocks to beehiiv columns blocks.
 *
 * @since 1.0.0
 */
final class MediaTextBlockConverter {

	/**
	 * Default media column width when WordPress does not specify one.
	 *
	 * @var int
	 */
	private const DEFAULT_MEDIA_WIDTH = 50;

	/**
	 * Whether the media side uses a video rather than an image.
	 *
	 * @param array<string, mixed> $attrs      Parsed media-text attrs.
	 * @param string               $inner_html Saved media-text HTML.
	 * @return bool
	 * @since 1.0.0
	 */
	public static function is_video_media_type( array $attrs, string $inner_html ): bool {
		$media_type = isset( $attrs['mediaType'] ) ? strtolower( trim( (string) $attrs['mediaType'] ) ) : '';

		if ( 'video' === $media_type ) {
			return true;
		}

		$figure_html = self::extract_media_figure_html( $inner_html );

		return '' !== $figure_html && preg_match( '/<video\b/i', $figure_html );
	}

	/**
	 * Resolve the media column width percentage.
	 *
	 * @param array<string, mixed> $attrs      Parsed media-text attrs.
	 * @param string               $inner_html Saved media-text HTML.
	 * @return int
	 * @since 1.0.0
	 */
	public static function resolve_media_width( array $attrs, string $inner_html ): int {
		if ( isset( $attrs['mediaWidth'] ) ) {
			$width = ColumnsBlockConverter::parse_width_percentage( $attrs['mediaWidth'] );

			if ( null !== $width ) {
				return $width;
			}
		}

		if ( preg_match( '/grid-template-columns\s*:\s*([^;"\']+)/i', $inner_html, $matches ) ) {
			$parts           = preg_split( '/\s+/', trim( $matches[1] ) );
			$media_on_right  = self::is_media_on_right( $attrs, $inner_html );
			$media_part      = $media_on_right ? ( $parts[1] ?? '' ) : ( $parts[0] ?? '' );
			$parsed_width    = ColumnsBlockConverter::parse_width_percentage( $media_part );
			$content_part    = $media_on_right ? ( $parts[0] ?? '' ) : ( $parts[1] ?? '' );
			$content_width   = ColumnsBlockConverter::parse_width_percentage( $content_part );

			if ( null !== $parsed_width ) {
				return $parsed_width;
			}

			if ( null !== $content_width ) {
				$derived = 100 - $content_width;

				if ( $derived >= 1 && $derived <= 100 ) {
					return $derived;
				}
			}
		}

		return self::DEFAULT_MEDIA_WIDTH;
	}

	/**
	 * Resolve vertical alignment for both media-text columns.
	 *
	 * Reads `verticalAlignment` from block attrs or `is-vertically-aligned-*` classes
	 * in saved HTML. Defaults to `middle` when the editor leaves alignment unset.
	 *
	 * @param array<string, mixed> $attrs      Parsed media-text attrs.
	 * @param string               $inner_html Saved media-text HTML.
	 * @return string top, middle, or bottom.
	 * @since 1.0.0
	 */
	public static function resolve_vertical_alignment( array $attrs, string $inner_html ): string {
		$raw_alignment = null;

		if ( ! empty( $attrs['verticalAlignment'] ) && is_string( $attrs['verticalAlignment'] ) ) {
			$raw_alignment = $attrs['verticalAlignment'];
		} elseif ( preg_match( '/is-vertically-aligned-(top|center|bottom)/', $inner_html, $matches ) ) {
			$raw_alignment = $matches[1];
		}

		$normalized = ColumnsBlockConverter::normalize_column_vertical_alignment( $raw_alignment );

		return null !== $normalized ? $normalized : 'middle';
	}

	/**
	 * Whether the media column should appear on the right.
	 *
	 * @param array<string, mixed> $attrs      Parsed media-text attrs.
	 * @param string               $inner_html Saved media-text HTML.
	 * @return bool
	 * @since 1.0.0
	 */
	public static function is_media_on_right( array $attrs, string $inner_html ): bool {
		$media_position = isset( $attrs['mediaPosition'] ) ? strtolower( trim( (string) $attrs['mediaPosition'] ) ) : '';

		if ( 'right' === $media_position ) {
			return true;
		}

		return str_contains( $inner_html, 'has-media-on-the-right' );
	}

	/**
	 * Order media and content columns based on media position.
	 *
	 * @param array<string, mixed> $media_column   Converted media column.
	 * @param array<string, mixed> $content_column Converted content column.
	 * @param array<string, mixed> $attrs          Parsed media-text attrs.
	 * @param string               $inner_html     Saved media-text HTML.
	 * @return array<int, array<string, mixed>>
	 * @since 1.0.0
	 */
	public static function order_columns(
		array $media_column,
		array $content_column,
		array $attrs,
		string $inner_html
	): array {
		$columns = [];

		if ( self::is_media_on_right( $attrs, $inner_html ) ) {
			if ( ! empty( $content_column ) ) {
				$columns[] = $content_column;
			}

			if ( ! empty( $media_column ) ) {
				$columns[] = $media_column;
			}

			return $columns;
		}

		if ( ! empty( $media_column ) ) {
			$columns[] = $media_column;
		}

		if ( ! empty( $content_column ) ) {
			$columns[] = $content_column;
		}

		return $columns;
	}

	/**
	 * Build a synthetic core/image block from media-text attrs and saved HTML.
	 *
	 * @param array<string, mixed> $attrs      Parsed media-text attrs.
	 * @param string               $inner_html Saved media-text HTML.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function build_synthetic_image_block( array $attrs, string $inner_html ): array {
		$figure_html = self::extract_media_figure_html( $inner_html );

		if ( '' !== $figure_html ) {
			return [
				'blockName' => 'core/image',
				'attrs'     => [],
				'innerHTML' => $figure_html,
			];
		}

		$image_url = self::resolve_image_url( $attrs );

		if ( '' === $image_url ) {
			return [];
		}

		$image_html = '<img src="' . esc_url( $image_url ) . '" alt="" />';
		$href       = isset( $attrs['href'] ) ? trim( (string) $attrs['href'] ) : '';

		if ( '' !== $href ) {
			$target     = isset( $attrs['linkTarget'] ) ? trim( (string) $attrs['linkTarget'] ) : '';
			$target_attr = '' !== $target ? ' target="' . esc_attr( $target ) . '"' : '';
			$image_html  = '<a href="' . esc_url( $href ) . '"' . $target_attr . '>' . $image_html . '</a>';
		}

		return [
			'blockName' => 'core/image',
			'attrs'     => [],
			'innerHTML' => '<figure class="wp-block-media-text__media">' . $image_html . '</figure>',
		];
	}

	/**
	 * Resolve a video URL from media-text attrs or saved HTML.
	 *
	 * @param array<string, mixed> $attrs      Parsed media-text attrs.
	 * @param string               $inner_html Saved media-text HTML.
	 * @return string
	 * @since 1.0.0
	 */
	public static function resolve_video_url( array $attrs, string $inner_html ): string {
		if ( ! empty( $attrs['mediaUrl'] ) && is_string( $attrs['mediaUrl'] ) ) {
			return trim( $attrs['mediaUrl'] );
		}

		$figure_html = self::extract_media_figure_html( $inner_html );

		if ( '' !== $figure_html && preg_match( '/<video[^>]*\ssrc=["\']([^"\']+)["\']/i', $figure_html, $matches ) ) {
			return trim( $matches[1] );
		}

		if ( preg_match( '/<video[^>]*\ssrc=["\']([^"\']+)["\']/i', $inner_html, $matches ) ) {
			return trim( $matches[1] );
		}

		return '';
	}

	/**
	 * Extract the media figure HTML from a media-text block fragment.
	 *
	 * @param string $inner_html Saved media-text HTML.
	 * @return string
	 * @since 1.0.0
	 */
	public static function extract_media_figure_html( string $inner_html ): string {
		if ( preg_match(
			'/<figure[^>]*\bwp-block-media-text__media\b[^>]*>.*?<\/figure>/is',
			$inner_html,
			$matches
		) ) {
			return $matches[0];
		}

		return '';
	}

	/**
	 * Resolve an image URL from media-text attrs.
	 *
	 * @param array<string, mixed> $attrs Parsed media-text attrs.
	 * @return string
	 * @since 1.0.0
	 */
	private static function resolve_image_url( array $attrs ): string {
		if ( ! empty( $attrs['mediaUrl'] ) && is_string( $attrs['mediaUrl'] ) ) {
			return trim( $attrs['mediaUrl'] );
		}

		if ( ! empty( $attrs['mediaId'] ) && is_numeric( $attrs['mediaId'] ) ) {
			$attachment_url = wp_get_attachment_image_url( (int) $attrs['mediaId'], 'full' );

			if ( is_string( $attachment_url ) && '' !== $attachment_url ) {
				return $attachment_url;
			}
		}

		return '';
	}
}
