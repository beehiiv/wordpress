<?php
/**
 * Frontend asset registration.
 *
 * @package beehiiv
 */

namespace Beehiiv\Frontend;

defined( 'ABSPATH' ) || exit;

/**
 * Enqueues compiled scripts and styles on the public site.
 *
 * @since 1.0.0
 */
final class Assets {

	/**
	 * Script handle for public scripts (`build/frontend.js`).
	 */
	private const SCRIPT_HANDLE = 'beehiiv-frontend';

	/**
	 * Style handle for public styles (`build/frontend.css`).
	 */
	private const STYLE_HANDLE = 'beehiiv-frontend';

	/**
	 * Webpack entry name for the frontend bundle.
	 */
	private const BUILD_ENTRY = 'frontend';

	/**
	 * Hook asset registration.
	 *
	 * @since 1.0.0
	 */
	public static function init(): void {
		add_action( 'wp_enqueue_scripts', [ self::class, 'enqueue_scripts' ] );
	}

	/**
	 * Enqueue frontend scripts and styles when the build artifacts exist.
	 *
	 * @since 1.0.0
	 */
	public static function enqueue_scripts(): void {
		$asset_path  = BEEHIIV_BUILD_DIR . self::BUILD_ENTRY . '.asset.php';
		$script_path = BEEHIIV_BUILD_DIR . self::BUILD_ENTRY . '.js';

		if (
			! file_exists( $asset_path )
			|| ! file_exists( $script_path )
			|| 0 === (int) filesize( $script_path )
		) {
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
