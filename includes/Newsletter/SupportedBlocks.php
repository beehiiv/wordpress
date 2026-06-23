<?php
/**
 * WordPress blocks supported for beehiiv newsletter conversion.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter;

defined( 'ABSPATH' ) || exit;

/**
 * Single source of truth for which WordPress blocks are included in newsletters.
 *
 * Layout blocks such as `core/group` and `core/columns` are not supported. They
 * and all of their inner blocks are omitted from the newsletter payload.
 *
 * @since 1.0.0
 */
final class SupportedBlocks {

	/**
	 * Blocks converted to beehiiv newsletter blocks.
	 *
	 * @var array<int, string>
	 */
	public const BLOCKS = [
		'core/heading',
		'core/paragraph',
		'core/image',
		'core/list',
		'core/table',
		'core/quote',
		'core/pullquote',
		'core/embed',
		'core/media-text',
		'core/buttons',
		'core/separator',
	];

	/**
	 * Inner blocks handled by a parent; never warned or converted on their own.
	 *
	 * @var array<int, string>
	 */
	public const NESTED_ONLY = [
		'core/button',
		'core/list-item',
	];

	/**
	 * Blocks only included when snippet newsletter mode is enabled.
	 *
	 * @var array<int, string>
	 */
	public const SNIPPET_ONLY = [
		'core/more',
	];

	/**
	 * Block support config for the block editor (localized to JavaScript).
	 *
	 * @return array<string, array<int, string>>
	 * @since 1.0.0
	 */
	public static function get_editor_config(): array {
		return [
			'supported'   => self::BLOCKS,
			'nestedOnly'  => self::NESTED_ONLY,
			'snippetOnly' => self::SNIPPET_ONLY,
		];
	}

	/**
	 * Whether a block is converted for beehiiv newsletters.
	 *
	 * @param string $block_name   Block name (e.g. core/paragraph).
	 * @param bool   $snippet_mode Whether snippet newsletter mode is enabled.
	 * @return bool
	 * @since 1.0.0
	 */
	public static function is_supported( string $block_name, bool $snippet_mode ): bool {
		if ( in_array( $block_name, self::NESTED_ONLY, true ) ) {
			return true;
		}

		if ( in_array( $block_name, self::SNIPPET_ONLY, true ) ) {
			return $snippet_mode;
		}

		return in_array( $block_name, self::BLOCKS, true );
	}
}
