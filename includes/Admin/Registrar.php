<?php
/**
 * WordPress Settings API registration for the beehiiv admin page.
 *
 * @package beehiiv
 */

namespace Beehiiv\Admin;

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
	 * Settings API section ID for the subscriber gating defaults.
	 */
	private const GATE_SETTINGS_SECTION_ID = 'beehiiv_gate_settings';

	/**
	 * Settings API page slug that holds the subscriber gating section.
	 *
	 * Separate from the main page slug so the section prints whether or not
	 * the Publication section is shown.
	 */
	public const GATE_SETTINGS_PAGE = Config::PLUGIN_SLUG . '_gating';

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
		self::register_gate_settings_section( self::GATE_SETTINGS_PAGE );

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
			__( 'Default publication', 'beehiiv' ),
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
	}

	/**
	 * Register the subscriber gating section and fields.
	 *
	 * @param string $page_slug Settings API page slug for this section.
	 * @since 1.2.0
	 */
	private static function register_gate_settings_section( string $page_slug ): void {
		add_settings_section(
			self::GATE_SETTINGS_SECTION_ID,
			__( 'Subscriber gating', 'beehiiv' ),
			[ self::class, 'render_gate_settings_description' ],
			$page_slug
		);

		add_settings_field(
			'beehiiv_gate_headline',
			__( 'Default gate headline', 'beehiiv' ),
			[ self::class, 'render_gate_headline_field' ],
			$page_slug,
			self::GATE_SETTINGS_SECTION_ID,
			[ 'label_for' => 'beehiiv_gate_headline' ]
		);

		add_settings_field(
			'beehiiv_gate_text',
			__( 'Default gate text', 'beehiiv' ),
			[ self::class, 'render_gate_text_field' ],
			$page_slug,
			self::GATE_SETTINGS_SECTION_ID,
			[ 'label_for' => 'beehiiv_gate_text' ]
		);

		add_settings_field(
			'beehiiv_gate_cookie_days',
			__( 'Unlock cookie lifetime', 'beehiiv' ),
			[ self::class, 'render_gate_cookie_days_field' ],
			$page_slug,
			self::GATE_SETTINGS_SECTION_ID,
			[ 'label_for' => 'beehiiv_gate_cookie_days' ]
		);
	}

	/**
	 * Subscriber gating section intro text.
	 *
	 * @since 1.2.0
	 */
	public static function render_gate_settings_description(): void {
		echo '<p>' . esc_html__(
			'Defaults for gated content blocks. A gated content block can override the headline and text.',
			'beehiiv'
		) . '</p>';
	}

	/**
	 * Default gate headline field.
	 *
	 * @since 1.2.0
	 */
	public static function render_gate_headline_field(): void {
		$settings = Options::get();
		?>
		<input
			type="text"
			id="beehiiv_gate_headline"
			class="regular-text"
			name="<?php echo esc_attr( Config::OPTION_NAME . '[gate_headline]' ); ?>"
			value="<?php echo esc_attr( (string) $settings['gate_headline'] ); ?>"
		/>
		<p class="description">
			<?php
			echo esc_html(
				sprintf(
					/* translators: %s: built-in default gate headline. */
					__( 'Plain text. Leave blank to use "%s".', 'beehiiv' ),
					Options::default_gate_headline()
				)
			);
			?>
		</p>
		<?php
	}

	/**
	 * Default gate text field.
	 *
	 * @since 1.2.0
	 */
	public static function render_gate_text_field(): void {
		$settings = Options::get();
		?>
		<input
			type="text"
			id="beehiiv_gate_text"
			class="large-text"
			name="<?php echo esc_attr( Config::OPTION_NAME . '[gate_text]' ); ?>"
			value="<?php echo esc_attr( (string) $settings['gate_text'] ); ?>"
		/>
		<p class="description">
			<?php
			echo esc_html(
				sprintf(
					/* translators: %s: built-in default gate text. */
					__( 'Plain text. Leave blank to use "%s".', 'beehiiv' ),
					Options::default_gate_text()
				)
			);
			?>
		</p>
		<?php
	}

	/**
	 * Unlock cookie lifetime field.
	 *
	 * @since 1.2.0
	 */
	public static function render_gate_cookie_days_field(): void {
		$settings = Options::get();
		?>
		<input
			type="number"
			id="beehiiv_gate_cookie_days"
			class="small-text"
			name="<?php echo esc_attr( Config::OPTION_NAME . '[gate_cookie_days]' ); ?>"
			value="<?php echo esc_attr( (string) $settings['gate_cookie_days'] ); ?>"
			min="<?php echo esc_attr( (string) Options::GATE_COOKIE_DAYS_MIN ); ?>"
			max="<?php echo esc_attr( (string) Options::GATE_COOKIE_DAYS_MAX ); ?>"
			step="1"
			placeholder="<?php echo esc_attr( (string) Options::GATE_COOKIE_DAYS_DEFAULT ); ?>"
		/>
		<?php esc_html_e( 'days', 'beehiiv' ); ?>
		<p class="description">
			<?php
			echo esc_html(
				sprintf(
					/* translators: 1: minimum days, 2: maximum days, 3: default days. */
					__( 'How long a reader stays unlocked after subscribing. Whole days from %1$d to %2$d. Anything else uses %3$d.', 'beehiiv' ), // phpcs:ignore Generic.Files.LineLength.MaxExceeded,Generic.Files.LineLength.TooLong -- Single string for translators / i18n tools.
					Options::GATE_COOKIE_DAYS_MIN,
					Options::GATE_COOKIE_DAYS_MAX,
					Options::GATE_COOKIE_DAYS_DEFAULT
				)
			);
			?>
		</p>
		<?php
	}

	/**
	 * Section intro text.
	 *
	 * @since 1.0.0
	 */
	public static function render_page_settings_description(): void {
		echo '<p>' . esc_html__(
			'Default beehiiv publication and post template for newsletters sent from this site.',
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
		<select
			id="beehiiv_publication_id"
			class="beehiiv-settings-select"
			name="<?php echo esc_attr( $name ); ?>"
			required
		>
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
		<button
			type="button"
			id="beehiiv_refresh_publications"
			class="button button-secondary beehiiv-refresh-button"
		>
			<?php esc_html_e( 'Refresh publications', 'beehiiv' ); ?>
		</button>
		<p class="description">
			<?php
			// phpcs:ignore Generic.Files.LineLength.MaxExceeded,Generic.Files.LineLength.TooLong -- Single string for translators / i18n tools.
			esc_html_e( 'Preselected on new posts. Editors can choose a different publication for each post in the beehiiv sidebar.', 'beehiiv' );
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
		$items          = '' !== $publication_id ? PostTemplates::get_post_templates( $publication_id ) : [];
		$has_templates  = (bool) array_filter(
			$items,
			static function ( $row ) {
				return isset( $row['id'] ) && '' !== (string) $row['id'];
			}
		);
		?>
		<select
			id="beehiiv_post_template_id"
			class="beehiiv-settings-select"
			name="<?php echo esc_attr( $name ); ?>"
		>
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
		<button
			type="button"
			id="beehiiv_refresh_post_templates"
			class="button button-secondary beehiiv-refresh-button"
			<?php disabled( '' === $publication_id ); ?>
		>
			<?php esc_html_e( 'Refresh templates', 'beehiiv' ); ?>
		</button>
		<?php if ( '' !== $publication_id && ! $has_templates ) : ?>
			<p class="description beehiiv-no-templates-notice">
				<?php
				esc_html_e(
					'This publication has no post templates. Create a template in beehiiv, then refresh.',
					'beehiiv'
				);
				?>
			</p>
		<?php endif; ?>
		<p class="description">
			<?php
			esc_html_e(
				'Default newsletter template for this site. Refresh after changing templates in beehiiv.',
				'beehiiv'
			);
			?>
		</p>
		<?php
	}
}
