<?php
/**
 * Block registration.
 *
 * @package beehiiv
 */

namespace Beehiiv\Blocks;

defined( 'ABSPATH' ) || exit;

/**
 * Registers every block whose metadata lives under `build/blocks/`.
 *
 * @since 1.0.0
 */
final class Registry {

	/**
	 * Block inserter category slug (must match `category` in each block's block.json).
	 */
	public const CATEGORY_SLUG = 'beehiiv-blocks';

	/**
	 * Register the Beehiiv block category for the block editor.
	 *
	 * @since 1.0.0
	 */
	public static function register_category(): void {
		add_filter( 'block_categories_all', [ self::class, 'add_block_category' ] );
	}

	/**
	 * Prepend the Beehiiv category to the block inserter.
	 *
	 * @param array<int, array<string, mixed>> $categories Registered block categories.
	 * @return array<int, array<string, mixed>>
	 * @since 1.0.0
	 */
	public static function add_block_category( array $categories ): array {
		array_unshift(
			$categories,
			[
				'slug'  => self::CATEGORY_SLUG,
				'title' => __( 'Beehiiv', 'beehiiv' ),
			]
		);

		return $categories;
	}

	/**
	 * Discover and register every compiled block.
	 *
	 * @since 1.0.0
	 */
	public static function register_blocks(): void {
		$blocks_dir = BEEHIIV_BUILD_DIR . 'blocks';

		if ( ! is_dir( $blocks_dir ) ) {
			return;
		}

		$entries = glob( $blocks_dir . '/*', GLOB_ONLYDIR );
		if ( false === $entries ) {
			return;
		}

		foreach ( $entries as $block_dir ) {
			if ( file_exists( $block_dir . '/block.json' ) ) {
				register_block_type( $block_dir );
			}
		}
	}
}
