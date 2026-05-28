<?php
/**
 * WordPress Settings API registration for the Beehiiv admin page.
 *
 * @package beehiiv
 */

namespace Beehiiv\Admin;

use Beehiiv\Config;

defined( 'ABSPATH' ) || exit;

/**
 * On `admin_init`, registers the option and page settings fields.
 *
 * @since 1.0.0
 */
final class Registrar {

	/**
	 * Settings API section ID for manual API key / publication fields.
	 */
	private const PAGE_SETTINGS_SECTION_ID = 'beehiiv_page_settings';

	/**
	 * Whether Settings API registration has already run this request.
	 *
	 * @var bool
	 */
	private static $registered = false;

	/**
	 * Register the option and page settings section (once per request).
	 *
	 * @since 1.0.0
	 */
	public static function register(): void {
		if ( self::$registered ) {
			return;
		}

		self::$registered = true;
		Options::register();
		self::register_page_settings_section( Config::PLUGIN_SLUG );
	}

	/**
	 * Register the page settings section and fields.
	 *
	 * @param string $page_slug Settings page slug (admin menu slug).
	 * @since 1.0.0
	 */
	private static function register_page_settings_section( string $page_slug ): void {
		add_settings_section(
			self::PAGE_SETTINGS_SECTION_ID,
			__( 'Manual connection (FALLBACK for OAuth)', 'beehiiv' ),
			[ self::class, 'render_page_settings_description' ],
			$page_slug
		);

		add_settings_field(
			'beehiiv_api_key',
			__( 'API key', 'beehiiv' ),
			[ self::class, 'render_api_key_field' ],
			$page_slug,
			self::PAGE_SETTINGS_SECTION_ID,
			[
				'label_for' => 'beehiiv_api_key',
			]
		);

		add_settings_field(
			'beehiiv_publication_id',
			__( 'Publication ID', 'beehiiv' ),
			[ self::class, 'render_publication_id_field' ],
			$page_slug,
			self::PAGE_SETTINGS_SECTION_ID,
			[
				'label_for' => 'beehiiv_publication_id',
			]
		);
	}

	/**
	 * Fallback section intro text.
	 *
	 * @since 1.0.0
	 */
	public static function render_page_settings_description(): void {
		echo '<p>' . esc_html__(
			'The option to use an API key while the Beehiiv OAuth integration is in development.',
			'beehiiv'
		) . '</p>';
	}

	/**
	 * API key field.
	 *
	 * @since 1.0.0
	 */
	public static function render_api_key_field(): void {
		$settings = Options::get();
		?>
		<input
			type="password"
			id="beehiiv_api_key"
			name="<?php echo esc_attr( Config::OPTION_NAME . '[api_key]' ); ?>"
			value="<?php echo esc_attr( (string) $settings['api_key'] ); ?>"
			class="regular-text"
			autocomplete="off"
		/>
		<p class="description">
			<?php esc_html_e( 'Beehiiv API key.', 'beehiiv' ); ?>
		</p>
		<?php
	}

	/**
	 * Publication ID field.
	 *
	 * @since 1.0.0
	 */
	public static function render_publication_id_field(): void {
		$settings = Options::get();
		?>
		<input
			type="text"
			id="beehiiv_publication_id"
			name="<?php echo esc_attr( Config::OPTION_NAME . '[publication_id]' ); ?>"
			value="<?php echo esc_attr( (string) $settings['publication_id'] ); ?>"
			class="regular-text"
		/>
		<p class="description">
			<?php esc_html_e( 'The ID of the Publication to use on this site.', 'beehiiv' ); ?>
		</p>
		<?php
	}
}
