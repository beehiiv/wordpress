<?php
/**
 * Beehiiv settings page template.
 *
 * @package beehiiv
 */

defined( 'ABSPATH' ) || exit;

use Beehiiv\Config;
use Beehiiv\Connection\Manager;

?>
<div class="wrap">
	<h1><?php echo esc_html( get_admin_page_title() ); ?></h1>

	<?php settings_errors( Config::SETTINGS_GROUP ); ?>

	<?php if ( ! Manager::is_connected() ) : ?>
		<div class="notice notice-info inline beehiiv-plans-notice">
			<span
				class="beehiiv-plans-notice__icon dashicons dashicons-info-outline"
				aria-hidden="true"
			></span>
			<p>
				<?php
				$beehiiv_plans_link = sprintf(
					'<a href="%1$s" target="_blank" rel="noopener noreferrer">%2$s</a>',
					esc_url( Config::PRICING_URL ),
					esc_html__( 'Learn more about plans.', 'beehiiv' )
				);
				echo wp_kses(
					sprintf(
						/* translators: 1: Max plan, 2: Enterprise plan, 3: pricing link. */
						__( 'The beehiiv integration is available to publications on the %1$s and %2$s plans. %3$s', 'beehiiv' ), // phpcs:ignore Generic.Files.LineLength.MaxExceeded,Generic.Files.LineLength.TooLong -- Single string for translators / i18n tools.
						'<strong>' . esc_html__( 'Max', 'beehiiv' ) . '</strong>',
						'<strong>' . esc_html__( 'Enterprise', 'beehiiv' ) . '</strong>',
						$beehiiv_plans_link
					),
					[
						'strong' => [],
						'a'      => [
							'href'   => true,
							'target' => true,
							'rel'    => true,
						],
					]
				);
				?>
			</p>
		</div>
	<?php endif; ?>

	<?php require Config::ADMIN_VIEWS_DIR . 'connection.php'; ?>

	<?php if ( Manager::is_connected() ) : ?>
		<form action="options.php" method="post">
			<?php
			settings_fields( Config::SETTINGS_GROUP );
			do_settings_sections( Config::PLUGIN_SLUG );
			submit_button( __( 'Save settings', 'beehiiv' ) );
			?>
		</form>
	<?php endif; ?>
</div>
