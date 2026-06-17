<?php
/**
 * WordPress Settings API registration for the Beehiiv admin page.
 *
 * @package beehiiv
 */

namespace Beehiiv\Admin;

use Beehiiv\API\Client;
use Beehiiv\API\Resources\PostTemplates;
use Beehiiv\API\Resources\Publications;
use Beehiiv\Config;
use Beehiiv\Connection\Manager;

defined( 'ABSPATH' ) || exit;

/**
 * On `admin_init`, registers the option and page settings fields.
 *
 * @since 1.0.0
 */
final class Registrar {

	/**
	 * Settings API section ID for publication / template defaults.
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

		if ( Manager::is_connected() ) {
			self::register_page_settings_section( Config::PLUGIN_SLUG );
		}
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
			__( 'Publication', 'beehiiv' ),
			[ self::class, 'render_page_settings_description' ],
			$page_slug
		);

		add_settings_field(
			'beehiiv_publication_id',
			__( 'Publication', 'beehiiv' ),
			[ self::class, 'render_publication_id_field' ],
			$page_slug,
			self::PAGE_SETTINGS_SECTION_ID,
			[
				'label_for' => 'beehiiv_publication_id',
			]
		);

		add_settings_field(
			'beehiiv_post_template_id',
			__( 'Default post template', 'beehiiv' ),
			[ self::class, 'render_post_template_id_field' ],
			$page_slug,
			self::PAGE_SETTINGS_SECTION_ID,
			[
				'label_for' => 'beehiiv_post_template_id',
			]
		);

		add_settings_field(
			'beehiiv_api_debug',
			__( 'API debug', 'beehiiv' ),
			[ self::class, 'render_api_debug_field' ],
			$page_slug,
			self::PAGE_SETTINGS_SECTION_ID
		);
	}

	/**
	 * Section intro text.
	 *
	 * @since 1.0.0
	 */
	public static function render_page_settings_description(): void {
		echo '<p>' . esc_html__(
			'Default Beehiiv publication and post template for newsletters sent from this site.',
			'beehiiv'
		) . '</p>';
	}

	/**
	 * Publication ID field.
	 *
	 * @since 1.0.0
	 */
	public static function render_publication_id_field(): void {
		$settings = Options::get();
		$selected = (string) $settings['publication_id'];
		$name     = Config::OPTION_NAME . '[publication_id]';
		$items    = Publications::get_publications();
		?>
		<select id="beehiiv_publication_id" class="beehiiv-settings-select" name="<?php echo esc_attr( $name ); ?>" required>
			<option value="" <?php selected( $selected, '' ); ?>>
				<?php esc_html_e( 'Select a publication', 'beehiiv' ); ?>
			</option>
			<?php foreach ( $items as $item ) : ?>
					<?php
					$id   = isset( $item['id'] ) ? (string) $item['id'] : '';
					$name = isset( $item['name'] ) ? (string) $item['name'] : '';
					if ( '' === $id ) {
						continue;
					}
					$label = '' !== $name ? $name : $id;
					?>
					<option value="<?php echo esc_attr( $id ); ?>" <?php selected( $selected, $id ); ?>>
						<?php echo esc_html( $label ); ?>
					</option>
				<?php endforeach; ?>
				<?php
				$selected_missing = '' !== $selected && ! array_filter(
					$items,
					static function ( $row ) use ( $selected ) {
						return isset( $row['id'] ) && (string) $row['id'] === $selected;
					}
				);
				?>
				<?php if ( $selected_missing ) : ?>
					<option value="<?php echo esc_attr( $selected ); ?>" selected="selected">
						<?php echo esc_html( $selected ); ?>
					</option>
				<?php endif; ?>
		</select>
		<p class="description">
			<?php esc_html_e( 'The publication to use for newsletters sent from this site.', 'beehiiv' ); ?>
		</p>
		<?php
	}

	/**
	 * Default post template ID field.
	 *
	 * @since 1.0.0
	 */
	public static function render_post_template_id_field(): void {
		$settings       = Options::get();
		$selected       = (string) $settings['post_template_id'];
		$name           = Config::OPTION_NAME . '[post_template_id]';
		$publication_id = (string) $settings['publication_id'];
		$items          = '' !== $publication_id ? PostTemplates::get_post_templates( $publication_id ) : [];
		?>
		<select id="beehiiv_post_template_id" class="beehiiv-settings-select" name="<?php echo esc_attr( $name ); ?>" required>
			<option value="" <?php selected( $selected, '' ); ?>>
				<?php esc_html_e( 'No default template', 'beehiiv' ); ?>
			</option>
			<?php foreach ( $items as $item ) : ?>
					<?php
					$id   = isset( $item['id'] ) ? (string) $item['id'] : '';
					$name = isset( $item['name'] ) ? (string) $item['name'] : '';
					if ( '' === $id ) {
						continue;
					}
					$label = '' !== $name ? $name : $id;
					?>
					<option value="<?php echo esc_attr( $id ); ?>" <?php selected( $selected, $id ); ?>>
						<?php echo esc_html( $label ); ?>
					</option>
				<?php endforeach; ?>
				<?php
				$selected_missing = '' !== $selected && ! array_filter(
					$items,
					static function ( $row ) use ( $selected ) {
						return isset( $row['id'] ) && (string) $row['id'] === $selected;
					}
				);
				?>
				<?php if ( $selected_missing ) : ?>
					<option value="<?php echo esc_attr( $selected ); ?>" selected="selected">
						<?php echo esc_html( $selected ); ?>
					</option>
				<?php endif; ?>
		</select>
		<p class="description">
			<?php esc_html_e( 'Default post template for newsletters sent from this site.', 'beehiiv' ); ?>
		</p>
		<?php
	}

	/**
	 * Temporary: show raw Beehiiv API responses from this page load.
	 *
	 * @since 1.0.0
	 */
	public static function render_api_debug_field(): void {
		$log = Client::get_request_log();

		if ( empty( $log ) ) {
			echo '<p class="description">' . esc_html__(
				'No API requests were made on this page load.',
				'beehiiv'
			) . '</p>';
			return;
		}

		echo '<p class="description">' . esc_html__(
			// phpcs:ignore Generic.Files.LineLength.MaxExceeded,Generic.Files.LineLength.TooLong -- Single string for translators / i18n tools.
			'Temporary debug output from Beehiiv API calls made while rendering the fields above. Remove before release.',
			'beehiiv'
		) . '</p>';

		foreach ( $log as $index => $entry ) {
			$label = sprintf(
				/* translators: %d: 1-based request number. */
				__( 'Request %d', 'beehiiv' ),
				$index + 1
			);
			?>
			<details class="beehiiv-api-debug" open>
				<summary>
					<strong><?php echo esc_html( $label ); ?></strong>
					<?php if ( ! empty( $entry['url'] ) ) : ?>
						<code><?php echo esc_html( (string) $entry['url'] ); ?></code>
					<?php endif; ?>
					<?php if ( isset( $entry['status_code'] ) && null !== $entry['status_code'] ) : ?>
						— <?php echo esc_html( 'HTTP ' . (string) $entry['status_code'] ); ?>
					<?php endif; ?>
					<?php if ( ! empty( $entry['wp_error'] ) ) : ?>
						— <?php echo esc_html( (string) $entry['wp_error'] ); ?>
					<?php endif; ?>
				</summary>
				<pre class="beehiiv-api-debug__body">
					<?php
					echo esc_html(
						wp_json_encode(
							$entry,
							JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
						)
					);
					?>
				</pre>
			</details>
			<?php
		}
	}
}
