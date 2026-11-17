<?php
/**
 * Shared definition of the content types that beehiiv can send.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter;

defined( 'ABSPATH' ) || exit;

/**
 * Single source of truth for which post types support beehiiv newsletters.
 *
 * The sender, test sender, post settings (meta, REST, assets) and the editor
 * script all read this list instead of hard-coding `post`.
 *
 * @since x.x.x
 */
final class ContentTypes {

	/**
	 * Regular WordPress posts.
	 *
	 * @since x.x.x
	 */
	public const POST = 'post';

	/**
	 * Non-public newsletter content type.
	 *
	 * @since x.x.x
	 */
	public const NEWSLETTER = 'beehiiv_newsletter';

	/**
	 * Post types that support beehiiv newsletters.
	 *
	 * @return string[]
	 * @since x.x.x
	 */
	public static function supported(): array {
		return [ self::POST, self::NEWSLETTER ];
	}

	/**
	 * Whether a post type supports beehiiv newsletters.
	 *
	 * @param mixed $post_type Post type name.
	 * @return bool
	 * @since x.x.x
	 */
	public static function is_supported( $post_type ): bool {
		return is_string( $post_type ) && in_array( $post_type, self::supported(), true );
	}

	/**
	 * Whether a post type is the newsletter content type.
	 *
	 * @param mixed $post_type Post type name.
	 * @return bool
	 * @since x.x.x
	 */
	public static function is_newsletter( $post_type ): bool {
		return self::NEWSLETTER === $post_type;
	}

	/**
	 * Default for "Send to newsletter" for a post type.
	 *
	 * On for newsletters, off for posts. Registered as the meta default so the
	 * editor and the server read the same value when nothing is stored.
	 *
	 * @param string $post_type Post type name.
	 * @return bool
	 * @since x.x.x
	 */
	public static function send_default( string $post_type ): bool {
		return self::is_newsletter( $post_type );
	}

	/**
	 * REST base for a post type.
	 *
	 * @param string $post_type Post type name.
	 * @return string
	 * @since x.x.x
	 */
	public static function rest_base( string $post_type ): string {
		$object = get_post_type_object( $post_type );

		if ( $object && ! empty( $object->rest_base ) ) {
			return (string) $object->rest_base;
		}

		return self::POST === $post_type ? 'posts' : $post_type;
	}

	/**
	 * Regex matching the single-item and collection REST routes of supported types
	 * (including `/{id}` and `/{id}/autosaves`).
	 *
	 * @return string
	 * @since x.x.x
	 */
	public static function rest_route_pattern(): string {
		$bases = array_map(
			static fn( string $type ): string => preg_quote( self::rest_base( $type ), '#' ),
			self::supported()
		);

		return '#^/wp/v2/(?:' . implode( '|', $bases ) . ')(?:/\d+(?:/autosaves)?)?$#';
	}
}
