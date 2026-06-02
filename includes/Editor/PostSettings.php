<?php
/**
 * Beehiiv post-level editor settings.
 *
 * @package beehiiv
 */

namespace Beehiiv\Editor;

defined( 'ABSPATH' ) || exit;

/**
 * Registers post meta and enqueues the Beehiiv plugin sidebar for the default
 * `post` post type.
 *
 * @since 1.0.0
 */
final class PostSettings {

	/**
	 * Webpack entry name for the post settings editor plugin.
	 */
	private const BUILD_ENTRY = 'post-settings';

	/**
	 * Script handle for the post settings sidebar (`build/post-settings.js`).
	 */
	private const SCRIPT_HANDLE = 'beehiiv-post-settings';

	/**
	 * Style handle for the post settings sidebar (`build/post-settings.css`).
	 */
	private const STYLE_HANDLE = 'beehiiv-post-settings';

	/**
	 * Post type that receives Beehiiv post meta and editor settings.
	 */
	private const POST_TYPE = 'post';

	/**
	 * Post meta keys registered for the block editor (REST-visible).
	 *
	 * @var array<string, array{type: string, default: bool|string}>
	 */
	private const META_KEYS = [
		Meta::SEND_TO_NEWSLETTER         => [
			'type'    => 'boolean',
			'default' => false,
		],
		Meta::SEND_TO_NEWSLETTER_DATE    => [
			'type'    => 'string',
			'default' => '',
		],
		Meta::SEND_TO_NEWSLETTER_SNIPPET => [
			'type'    => 'boolean',
			'default' => false,
		],
	];

	/**
	 * Expose Beehiiv post meta to the REST API so the block editor can read
	 * and write it.
	 *
	 * @since 1.0.0
	 */
	public static function register_meta(): void {
		foreach ( self::META_KEYS as $key => $config ) {
			register_post_meta(
				self::POST_TYPE,
				$key,
				[
					'show_in_rest'  => true,
					'single'        => true,
					'type'          => $config['type'],
					'default'       => $config['default'],
					'auth_callback' => static function () {
						return current_user_can( 'edit_posts' );
					},
				]
			);
		}
	}

	/**
	 * Enqueue the compiled editor plugin only on `post` edit screens.
	 *
	 * @since 1.0.0
	 */
	public static function enqueue_assets(): void {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( $screen && self::POST_TYPE !== $screen->post_type ) {
			return;
		}

		$asset_path = BEEHIIV_BUILD_DIR . self::BUILD_ENTRY . '.asset.php';
		if ( ! file_exists( $asset_path ) ) {
			return;
		}

		$asset = require $asset_path;

		wp_enqueue_script(
			self::SCRIPT_HANDLE,
			BEEHIIV_BUILD_URL . self::BUILD_ENTRY . '.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);

		wp_set_script_translations( self::SCRIPT_HANDLE, 'beehiiv' );

		$style_path = BEEHIIV_BUILD_DIR . self::BUILD_ENTRY . '.css';
		if ( file_exists( $style_path ) ) {
			wp_enqueue_style(
				self::STYLE_HANDLE,
				BEEHIIV_BUILD_URL . self::BUILD_ENTRY . '.css',
				[],
				$asset['version']
			);
		}
	}
}
