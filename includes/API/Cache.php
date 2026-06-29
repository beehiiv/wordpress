<?php
/**
 * Transient cache for beehiiv publications and templates.
 *
 * @package beehiiv
 */

namespace Beehiiv\API;

defined( 'ABSPATH' ) || exit;

/**
 * Caches normalized publication and template lists for 15 minutes.
 *
 * @since 1.0.0
 */
final class Cache {

	/**
	 * Cache TTL in seconds.
	 *
	 * Lists rarely change, and the editor and settings screens expose a manual
	 * "Refresh" control that clears the relevant transient on demand, so the TTL
	 * acts as a background performance and resilience floor rather than a
	 * freshness window.
	 *
	 * @since 1.0.0
	 */
	private const TTL = 6 * HOUR_IN_SECONDS;

	/**
	 * Transient key for publications list.
	 *
	 * @since 1.0.0
	 */
	private const PUBLICATIONS_KEY = 'beehiiv_publications';

	/**
	 * Transient key prefix for template lists.
	 *
	 * @since 1.0.0
	 */
	private const TEMPLATES_KEY_PREFIX = 'beehiiv_post_templates_';

	/**
	 * Index of cached template publication IDs.
	 *
	 * @since 1.0.0
	 */
	private const TEMPLATE_INDEX_KEY = 'beehiiv_template_cache_index';

	/**
	 * Transient key prefix for advertisement opportunity lists.
	 *
	 * @since 1.0.0
	 */
	private const AD_OPPORTUNITIES_KEY_PREFIX = 'beehiiv_ad_opportunities_';

	/**
	 * Index of cached advertisement opportunity publication IDs.
	 *
	 * @since 1.0.0
	 */
	private const AD_OPPORTUNITIES_INDEX_KEY = 'beehiiv_ad_opportunities_cache_index';

	/**
	 * Cached publications list.
	 *
	 * @since 1.0.0
	 *
	 * @return array<int, array{id: string, name: string}>|null
	 */
	public static function get_publications(): ?array {

		$cached = get_transient( self::PUBLICATIONS_KEY );

		return is_array( $cached ) ? $cached : null;
	}

	/**
	 * Store publications list in cache.
	 *
	 * @since 1.0.0
	 *
	 * @param array<int, array{id: string, name: string}> $items Normalized publications.
	 *
	 * @return void
	 */
	public static function set_publications( array $items ): void {

		set_transient( self::PUBLICATIONS_KEY, $items, self::TTL );
	}

	/**
	 * Cached templates for a publication.
	 *
	 * @since 1.0.0
	 *
	 * @param string $publication_id Publication ID.
	 *
	 * @return array<int, array{id: string, name: string}>|null
	 */
	public static function get_post_templates( string $publication_id ): ?array {

		$publication_id = trim( $publication_id );

		if ( '' === $publication_id ) {
			return null;
		}

		$cached = get_transient( self::template_key( $publication_id ) );

		return is_array( $cached ) ? $cached : null;
	}

	/**
	 * Store templates for a publication in cache.
	 *
	 * @since 1.0.0
	 *
	 * @param string                                      $publication_id Publication ID.
	 * @param array<int, array{id: string, name: string}> $items          Normalized templates.
	 *
	 * @return void
	 */
	public static function set_post_templates( string $publication_id, array $items ): void {

		$publication_id = trim( $publication_id );

		if ( '' === $publication_id ) {
			return;
		}

		set_transient( self::template_key( $publication_id ), $items, self::TTL );
		self::track_template_publication( $publication_id );
	}

	/**
	 * Delete cached templates for a single publication.
	 *
	 * @since 1.0.0
	 *
	 * @param string $publication_id Publication ID.
	 *
	 * @return void
	 */
	public static function delete_post_templates( string $publication_id ): void {

		$publication_id = trim( $publication_id );

		if ( '' === $publication_id ) {
			return;
		}

		delete_transient( self::template_key( $publication_id ) );
	}

	/**
	 * Cached advertisement opportunities for a publication.
	 *
	 * @since 1.0.0
	 *
	 * @param string $publication_id Publication ID.
	 *
	 * @return array<int, array<string, mixed>>|null
	 */
	public static function get_advertisement_opportunities( string $publication_id ): ?array {

		$publication_id = trim( $publication_id );

		if ( '' === $publication_id ) {
			return null;
		}

		$cached = get_transient( self::ad_opportunities_key( $publication_id ) );

		return is_array( $cached ) ? $cached : null;
	}

	/**
	 * Store advertisement opportunities for a publication in cache.
	 *
	 * @since 1.0.0
	 *
	 * @param string                           $publication_id Publication ID.
	 * @param array<int, array<string, mixed>> $items          Normalized opportunities.
	 *
	 * @return void
	 */
	public static function set_advertisement_opportunities( string $publication_id, array $items ): void {

		$publication_id = trim( $publication_id );

		if ( '' === $publication_id ) {
			return;
		}

		set_transient( self::ad_opportunities_key( $publication_id ), $items, self::TTL );
		self::track_ad_opportunities_publication( $publication_id );
	}

	/**
	 * Delete cached advertisement opportunities for a single publication.
	 *
	 * @since 1.0.0
	 *
	 * @param string $publication_id Publication ID.
	 *
	 * @return void
	 */
	public static function delete_advertisement_opportunities( string $publication_id ): void {

		$publication_id = trim( $publication_id );

		if ( '' === $publication_id ) {
			return;
		}

		delete_transient( self::ad_opportunities_key( $publication_id ) );
	}

	/**
	 * Delete all cached publications, templates and advertisement opportunities.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public static function flush_all(): void {

		delete_transient( self::PUBLICATIONS_KEY );

		$index = get_transient( self::TEMPLATE_INDEX_KEY );

		if ( is_array( $index ) ) {
			foreach ( $index as $publication_id ) {
				if ( is_string( $publication_id ) && '' !== $publication_id ) {
					delete_transient( self::template_key( $publication_id ) );
				}
			}
		}

		delete_transient( self::TEMPLATE_INDEX_KEY );

		$ad_index = get_transient( self::AD_OPPORTUNITIES_INDEX_KEY );

		if ( is_array( $ad_index ) ) {
			foreach ( $ad_index as $publication_id ) {
				if ( is_string( $publication_id ) && '' !== $publication_id ) {
					delete_transient( self::ad_opportunities_key( $publication_id ) );
				}
			}
		}

		delete_transient( self::AD_OPPORTUNITIES_INDEX_KEY );
	}

	/**
	 * Build a transient key for a publication's templates.
	 *
	 * @since 1.0.0
	 *
	 * @param string $publication_id Publication ID.
	 *
	 * @return string
	 */
	private static function template_key( string $publication_id ): string {

		return self::TEMPLATES_KEY_PREFIX . $publication_id;
	}

	/**
	 * Track a publication ID in the template cache index.
	 *
	 * @since 1.0.0
	 *
	 * @param string $publication_id Publication ID.
	 *
	 * @return void
	 */
	private static function track_template_publication( string $publication_id ): void {

		$index = get_transient( self::TEMPLATE_INDEX_KEY );

		if ( ! is_array( $index ) ) {
			$index = [];
		}

		if ( ! in_array( $publication_id, $index, true ) ) {
			$index[] = $publication_id;
		}

		set_transient( self::TEMPLATE_INDEX_KEY, $index, self::TTL );
	}

	/**
	 * Build a transient key for a publication's advertisement opportunities.
	 *
	 * @since 1.0.0
	 *
	 * @param string $publication_id Publication ID.
	 *
	 * @return string
	 */
	private static function ad_opportunities_key( string $publication_id ): string {

		return self::AD_OPPORTUNITIES_KEY_PREFIX . $publication_id;
	}

	/**
	 * Track a publication ID in the advertisement opportunities cache index.
	 *
	 * @since 1.0.0
	 *
	 * @param string $publication_id Publication ID.
	 *
	 * @return void
	 */
	private static function track_ad_opportunities_publication( string $publication_id ): void {

		$index = get_transient( self::AD_OPPORTUNITIES_INDEX_KEY );

		if ( ! is_array( $index ) ) {
			$index = [];
		}

		if ( ! in_array( $publication_id, $index, true ) ) {
			$index[] = $publication_id;
		}

		set_transient( self::AD_OPPORTUNITIES_INDEX_KEY, $index, self::TTL );
	}
}
