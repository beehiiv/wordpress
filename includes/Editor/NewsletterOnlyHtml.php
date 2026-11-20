<?php
/**
 * The "Newsletter only" option on Custom HTML blocks.
 *
 * @package beehiiv
 */

namespace Beehiiv\Editor;

defined( 'ABSPATH' ) || exit;

/**
 * Lets a Custom HTML block go to beehiiv without showing on the WordPress site.
 *
 * The option is a per-block attribute on `core/html`, off by default. The block is still
 * saved and synced to beehiiv as an HTML block; this class only stops it rendering. It
 * hooks `render_block`, which runs wherever WordPress renders post content, so the front
 * end, the RSS feed, the excerpt and the REST API's rendered content all show nothing for
 * a newsletter-only block. The editor shows the block as usual so it stays editable.
 *
 * @since 1.3.0
 */
final class NewsletterOnlyHtml {

	/**
	 * Block attribute that holds the option.
	 */
	public const ATTRIBUTE = 'beehiivNewsletterOnly';

	/**
	 * Register hooks.
	 *
	 * @return void
	 * @since 1.3.0
	 */
	public static function init(): void {
		add_filter( 'register_block_type_args', [ self::class, 'register_attribute' ], 10, 2 );
		add_filter( 'render_block', [ self::class, 'hide_block' ], 10, 2 );
	}

	/**
	 * Add the option to the core/html block type.
	 *
	 * @param array<string, mixed> $args       Block type arguments.
	 * @param string               $block_name Block name.
	 * @return array<string, mixed>
	 * @since 1.3.0
	 */
	public static function register_attribute( array $args, string $block_name ): array {
		if ( 'core/html' !== $block_name ) {
			return $args;
		}

		$attributes = isset( $args['attributes'] ) && is_array( $args['attributes'] ) ? $args['attributes'] : [];

		$args['attributes']                    = $attributes;
		$args['attributes'][ self::ATTRIBUTE ] = [
			'type'    => 'boolean',
			'default' => false,
		];

		return $args;
	}

	/**
	 * Output nothing for a newsletter-only Custom HTML block.
	 *
	 * @param string               $block_content Rendered block content.
	 * @param array<string, mixed> $block         Parsed block.
	 * @return string
	 * @since 1.3.0
	 */
	public static function hide_block( string $block_content, array $block ): string {
		if ( self::is_newsletter_only( $block ) ) {
			return '';
		}

		return $block_content;
	}

	/**
	 * Whether a parsed block is a Custom HTML block set to "Newsletter only".
	 *
	 * @param array<string, mixed> $block Parsed block.
	 * @return bool
	 * @since 1.3.0
	 */
	public static function is_newsletter_only( array $block ): bool {
		return 'core/html' === ( $block['blockName'] ?? '' )
			&& ! empty( $block['attrs'][ self::ATTRIBUTE ] );
	}
}
