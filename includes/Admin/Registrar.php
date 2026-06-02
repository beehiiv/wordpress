<?php
/**
 * WordPress Settings API registration for the Beehiiv admin page.
 *
 * @package beehiiv
 */

namespace Beehiiv\Admin;

use Beehiiv\API\Resources\PostTemplates;
use Beehiiv\API\Resources\Publications;
use Beehiiv\Config;
use Beehiiv\Connection\Manager;
use WP_Error;

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
			__( 'Default email template', 'beehiiv' ),
			[ self::class, 'render_post_template_id_field' ],
			$page_slug,
			self::PAGE_SETTINGS_SECTION_ID,
			[
				'label_for' => 'beehiiv_post_template_id',
			]
		);
	}

	/**
	 * Section intro text.
	 *
	 * @since 1.0.0
	 */
	public static function render_page_settings_description(): void {
		echo '<p>' . esc_html__(
			'Default Beehiiv publication and email template for newsletters sent from this site.',
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
		$items    = Publications::list();
		?>
		<select id="beehiiv_publication_id" class="beehiiv-settings-select" name="<?php echo esc_attr( $name ); ?>">
			<option value="" <?php selected( $selected, '' ); ?>>
				<?php esc_html_e( 'Select a publication', 'beehiiv' ); ?>
			</option>
			<?php if ( is_wp_error( $items ) ) : ?>
				<?php if ( '' !== $selected ) : ?>
					<option value="<?php echo esc_attr( $selected ); ?>" selected="selected">
						<?php echo esc_html( $selected ); ?>
					</option>
				<?php endif; ?>
			<?php elseif ( is_array( $items ) ) : ?>
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
			<?php endif; ?>
		</select>
		<p class="description">
			<?php
			esc_html_e( 'The publication to use for newsletters sent from this site.', 'beehiiv' );
			if ( is_wp_error( $items ) ) {
				printf(
					' %s',
					wp_kses(
						sprintf(
							/* translators: %s: Beehiiv API error message. */
							__( 'Unable to load publications from Beehiiv (%s).', 'beehiiv' ),
							esc_html( $items->get_error_message() )
						),
						[]
					)
				);
			}
			?>
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
		$items          = '' !== $publication_id ? PostTemplates::list( $publication_id ) : new WP_Error(
			'beehiiv_no_publication_selected',
			__( 'Select a publication to load templates.', 'beehiiv' )
		);
		?>
		<select id="beehiiv_post_template_id" class="beehiiv-settings-select" name="<?php echo esc_attr( $name ); ?>">
			<option value="" <?php selected( $selected, '' ); ?>>
				<?php esc_html_e( 'No default template', 'beehiiv' ); ?>
			</option>
			<?php if ( is_wp_error( $items ) ) : ?>
				<?php if ( '' !== $selected ) : ?>
					<option value="<?php echo esc_attr( $selected ); ?>" selected="selected">
						<?php echo esc_html( $selected ); ?>
					</option>
				<?php endif; ?>
			<?php elseif ( is_array( $items ) ) : ?>
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
			<?php endif; ?>
		</select>
		<p class="description">
			<?php
			esc_html_e( 'Default email template for newsletters sent from this site.', 'beehiiv' );
			if ( is_wp_error( $items ) ) {
				printf(
					' %s',
					wp_kses(
						sprintf(
							/* translators: %s: Beehiiv API error message. */
							__( 'Unable to load templates from Beehiiv (%s).', 'beehiiv' ),
							esc_html( $items->get_error_message() )
						),
						[]
					)
				);
			}
			?>
		</p>
		<?php
	}
}
