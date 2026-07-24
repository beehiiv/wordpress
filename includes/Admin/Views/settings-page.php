<?php
/**
 * Beehiiv settings page template.
 *
 * @package beehiiv
 */

defined( 'ABSPATH' ) || exit;

use Beehiiv\API\Resources\Workspace;
use Beehiiv\Config;
use Beehiiv\Connection\Manager;

$beehiiv_is_connected    = Manager::is_connected();
$beehiiv_can_write_posts = false;

if ( $beehiiv_is_connected ) {
	$beehiiv_can_write_posts = Workspace::can_write_posts();
}

?>
<div class="wrap">
	<h1><?php echo esc_html( get_admin_page_title() ); ?></h1>

	<?php settings_errors( Config::SETTINGS_GROUP ); ?>

	<?php if ( ! $beehiiv_can_write_posts ) : ?>
		<div class="notice notice-info inline beehiiv-plans-notice">
			<span
				class="beehiiv-plans-notice__icon dashicons dashicons-info-outline"
				aria-hidden="true"
			></span>
			<p>
				<?php
				$beehiiv_plans_link  = sprintf(
					'<a href="%1$s" target="_blank" rel="noopener noreferrer">%2$s</a>',
					esc_url( Config::PRICING_URL ),
					esc_html__( 'Learn more about plans.', 'beehiiv' )
				);
				$beehiiv_notice_kses = [
					'strong' => [],
					'a'      => [
						'href'   => true,
						'target' => true,
						'rel'    => true,
					],
				];

				if ( $beehiiv_is_connected ) {
					echo wp_kses(
						sprintf(
							/* translators: 1: Max plan, 2: Enterprise plan, 3: pricing link. */
							__( 'Your connected beehiiv account doesn\'t have access to send newsletters. This integration requires the %1$s or %2$s plan. %3$s', 'beehiiv' ), // phpcs:ignore Generic.Files.LineLength.MaxExceeded,Generic.Files.LineLength.TooLong -- Single string for translators / i18n tools.
							'<strong>' . esc_html__( 'Max', 'beehiiv' ) . '</strong>',
							'<strong>' . esc_html__( 'Enterprise', 'beehiiv' ) . '</strong>',
							$beehiiv_plans_link
						),
						$beehiiv_notice_kses
					);
				} else {
					echo wp_kses(
						sprintf(
							/* translators: 1: Max plan, 2: Enterprise plan, 3: pricing link. */
							__( 'The beehiiv integration is available to publications on the %1$s and %2$s plans. %3$s', 'beehiiv' ), // phpcs:ignore Generic.Files.LineLength.MaxExceeded,Generic.Files.LineLength.TooLong -- Single string for translators / i18n tools.
							'<strong>' . esc_html__( 'Max', 'beehiiv' ) . '</strong>',
							'<strong>' . esc_html__( 'Enterprise', 'beehiiv' ) . '</strong>',
							$beehiiv_plans_link
						),
						$beehiiv_notice_kses
					);
				}
				?>
			</p>
		</div>
	<?php endif; ?>

	<?php require Config::ADMIN_VIEWS_DIR . 'connection.php'; ?>

	<?php if ( $beehiiv_can_write_posts ) : ?>
		<form action="options.php" method="post">
			<?php
			settings_fields( Config::SETTINGS_GROUP );
			do_settings_sections( Config::PLUGIN_SLUG );
			submit_button( __( 'Save settings', 'beehiiv' ) );
			?>
		</form>
	<?php endif; ?>
</div>
