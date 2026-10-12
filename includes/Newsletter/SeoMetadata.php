<?php
/**
 * Search and social-sharing metadata for beehiiv newsletters.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter;

use Throwable;
use WP_Post;

defined( 'ABSPATH' ) || exit;

/**
 * Resolves the beehiiv `seo_settings` values for a WordPress post.
 *
 * Values come from the active SEO plugin (Yoast SEO or Rank Math) when present,
 * otherwise from the post title and excerpt. Social titles and descriptions fall
 * back to the search title and description when the SEO plugin leaves them empty.
 *
 * @since x.x.x
 */
final class SeoMetadata {

	/**
	 * Resolve beehiiv `seo_settings` for a post.
	 *
	 * Never throws: an SEO plugin or filter error falls back to the post title and excerpt.
	 *
	 * @param WP_Post $post Post object.
	 * @return array{
	 *     default_title: string,
	 *     default_description: string,
	 *     og_title: string,
	 *     og_description: string,
	 *     twitter_title: string,
	 *     twitter_description: string
	 * }
	 * @since x.x.x
	 */
	public static function resolve( WP_Post $post ): array {
		try {
			return self::filter( self::build( self::from_seo_plugin( $post ), $post ), $post );
		} catch ( Throwable $e ) {
			return self::build( [], $post );
		}
	}

	/**
	 * Fill the six `seo_settings` values, falling back to the post title and excerpt only when needed.
	 *
	 * @param array<string, string> $values SEO plugin values.
	 * @param WP_Post               $post   Post object.
	 * @return array<string, string>
	 * @since x.x.x
	 */
	private static function build( array $values, WP_Post $post ): array {
		$title       = '' !== ( $values['title'] ?? '' ) ? $values['title'] : self::clean( get_the_title( $post ) );
		$description = '' !== ( $values['description'] ?? '' ) ? $values['description'] : self::excerpt( $post );
		$og_title    = self::first_filled( $values['og_title'] ?? '', $title );
		$og_desc     = self::first_filled( $values['og_description'] ?? '', $description );

		return [
			'default_title'       => $title,
			'default_description' => $description,
			'og_title'            => $og_title,
			'og_description'      => $og_desc,
			'twitter_title'       => self::first_filled( $values['twitter_title'] ?? '', $og_title ),
			'twitter_description' => self::first_filled( $values['twitter_description'] ?? '', $og_desc ),
		];
	}

	/**
	 * Apply the `beehiiv_newsletter_seo_settings` filter, keeping only known scalar values.
	 *
	 * @param array<string, string> $settings Resolved values.
	 * @param WP_Post               $post     Post object.
	 * @return array<string, string>
	 * @since x.x.x
	 */
	private static function filter( array $settings, WP_Post $post ): array {
		/**
		 * Filters the beehiiv `seo_settings` for a post.
		 *
		 * Use this to supply values from an SEO plugin the beehiiv plugin does not read natively.
		 *
		 * @since x.x.x
		 *
		 * @param array   $settings Resolved `seo_settings` values.
		 * @param WP_Post $post     WordPress post object.
		 */
		$filtered = apply_filters( 'beehiiv_newsletter_seo_settings', $settings, $post );

		if ( ! is_array( $filtered ) ) {
			return $settings;
		}

		foreach ( array_keys( $settings ) as $key ) {
			if ( isset( $filtered[ $key ] ) && is_scalar( $filtered[ $key ] ) ) {
				$settings[ $key ] = self::clean( (string) $filtered[ $key ] );
			}
		}

		return $settings;
	}

	/**
	 * Plain-text description: the manual excerpt, or the opening words of the content.
	 *
	 * Avoids get_the_excerpt(), which renders the full content and appends the "read more" suffix.
	 *
	 * @param WP_Post $post Post object.
	 * @return string
	 * @since x.x.x
	 */
	private static function excerpt( WP_Post $post ): string {
		if ( '' !== trim( $post->post_excerpt ) ) {
			return self::clean( $post->post_excerpt );
		}

		$content = strip_shortcodes( excerpt_remove_blocks( $post->post_content ) );

		return self::clean( wp_trim_words( wp_strip_all_tags( $content ), 55, '' ) );
	}

	/**
	 * Raw values from the active SEO plugin, keyed by title, description, and the og and twitter fields.
	 *
	 * @param WP_Post $post Post object.
	 * @return array<string, string>
	 * @since x.x.x
	 */
	private static function from_seo_plugin( WP_Post $post ): array {
		if ( function_exists( 'YoastSEO' ) ) {
			return self::from_yoast( $post );
		}

		if ( class_exists( '\RankMath\Helper' ) ) {
			return self::from_rank_math( $post );
		}

		return [];
	}

	/**
	 * Resolved values from Yoast SEO's indexable surface.
	 *
	 * @param WP_Post $post Post object.
	 * @return array<string, string>
	 * @since x.x.x
	 */
	private static function from_yoast( WP_Post $post ): array {
		$meta = YoastSEO()->meta->for_post( $post->ID );

		if ( ! is_object( $meta ) ) {
			return [];
		}

		return [
			'title'               => self::clean( (string) $meta->title ),
			'description'         => self::clean( (string) $meta->description ),
			'og_title'            => self::clean( (string) $meta->open_graph_title ),
			'og_description'      => self::clean( (string) $meta->open_graph_description ),
			'twitter_title'       => self::clean( (string) $meta->twitter_title ),
			'twitter_description' => self::clean( (string) $meta->twitter_description ),
		];
	}

	/**
	 * Values from Rank Math post meta, with its template variables replaced.
	 *
	 * @param WP_Post $post Post object.
	 * @return array<string, string>
	 * @since x.x.x
	 */
	private static function from_rank_math( WP_Post $post ): array {
		$keys = [
			'title'               => 'rank_math_title',
			'description'         => 'rank_math_description',
			'og_title'            => 'rank_math_facebook_title',
			'og_description'      => 'rank_math_facebook_description',
			'twitter_title'       => 'rank_math_twitter_title',
			'twitter_description' => 'rank_math_twitter_description',
		];

		$can_replace = is_callable( [ '\RankMath\Helper', 'replace_vars' ] );
		$values      = [];

		foreach ( $keys as $field => $meta_key ) {
			$value = get_post_meta( $post->ID, $meta_key, true );
			$value = is_string( $value ) ? $value : '';

			if ( '' !== $value && $can_replace ) {
				$value = (string) \RankMath\Helper::replace_vars( $value, $post );
			}

			$values[ $field ] = self::clean( $value );
		}

		return $values;
	}

	/**
	 * First non-empty value.
	 *
	 * @param string $value    Preferred value.
	 * @param string $fallback Fallback value.
	 * @return string
	 * @since x.x.x
	 */
	private static function first_filled( string $value, string $fallback ): string {
		return '' !== $value ? $value : $fallback;
	}

	/**
	 * Plain text with HTML stripped and entities decoded.
	 *
	 * @param string $value Raw value.
	 * @return string
	 * @since x.x.x
	 */
	private static function clean( string $value ): string {
		return trim( html_entity_decode( wp_strip_all_tags( $value ), ENT_QUOTES, 'UTF-8' ) );
	}
}
