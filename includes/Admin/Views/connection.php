<?php
/**
 * beehiiv connection card (above the settings form).
 *
 * @package beehiiv
 */

defined( 'ABSPATH' ) || exit;

use Beehiiv\Config;
use Beehiiv\Connection\Manager;

$is_connected         = Manager::is_connected();
$connected_user_label = Manager::get_connected_user_label();

$status_icon_class = $is_connected
	? 'beehiiv-connection-status__icon beehiiv-connection-status__icon--connected dashicons dashicons-yes-alt'
	: 'beehiiv-connection-status__icon beehiiv-connection-status__icon--disconnected dashicons dashicons-marker';
?>
<div class="beehiiv-connection-card">
	<div class="postbox-header">
		<h2><?php esc_html_e( 'Connection', 'beehiiv' ); ?></h2>
	</div>

	<div class="inside beehiiv-connection-card__inside">
		<div class="beehiiv-connection-row">
			<div class="beehiiv-connection-actions">
				<?php if ( $is_connected ) : ?>
					<a
						class="button button-secondary"
						href="<?php echo esc_url( Manager::get_disconnect_url() ); ?>"
					>
						<?php esc_html_e( 'Disconnect', 'beehiiv' ); ?>
					</a>
				<?php else : ?>
					<a
						class="button button-primary"
						href="<?php echo esc_url( Manager::get_connect_url() ); ?>"
					>
						<?php esc_html_e( 'Connect to beehiiv', 'beehiiv' ); ?>
					</a>
				<?php endif; ?>
			</div>

			<p class="beehiiv-connection-status">
				<span
					class="<?php echo esc_attr( $status_icon_class ); ?>"
					aria-hidden="true"
				></span>
				<strong><?php echo esc_html( Manager::get_status_label() ); ?></strong>
				<?php if ( $is_connected && '' !== $connected_user_label ) : ?>
					<span class="beehiiv-connection-status__account">
						<?php echo esc_html( $connected_user_label ); ?>
					</span>
				<?php endif; ?>
			</p>
		</div>

		<?php if ( ! $is_connected ) : ?>
			<p class="description beehiiv-connection-signup">
				<?php
				$signup_link = sprintf(
					'<a href="%1$s" target="_blank" rel="noopener noreferrer">%2$s</a>',
					esc_url( Manager::get_signup_url() ),
					esc_html__( 'Create a beehiiv account now', 'beehiiv' )
				);
				printf(
					/* translators: %s: link to beehiiv sign-up. */
					esc_html__( "Don't have a beehiiv account? %s", 'beehiiv' ),
					wp_kses(
						$signup_link,
						[
							'a' => [
								'href'   => true,
								'target' => true,
								'rel'    => true,
							],
						]
					)
				);
				?>
			</p>
		<?php else : ?>
			<div class="beehiiv-connection-next-steps">
				<p class="description">
					<?php
					esc_html_e(
						'You are now connected to beehiiv. To send WordPress posts to your newsletter:',
						'beehiiv'
					);
					?>
				</p>
				<ol class="description">
					<li>
						<?php
						$create_post_link = sprintf(
							'<a href="%1$s">%2$s</a>',
							esc_url( admin_url( 'post-new.php' ) ),
							esc_html__( 'Create', 'beehiiv' )
						);
						$edit_posts_link  = sprintf(
							'<a href="%1$s">%2$s</a>',
							esc_url( admin_url( 'edit.php' ) ),
							esc_html__( 'edit', 'beehiiv' )
						);
						echo wp_kses(
							sprintf(
								/* translators: 1: link to create a new post, 2: link to the posts list. */
								__( '%1$s or %2$s a post in the block editor.', 'beehiiv' ),
								$create_post_link,
								$edit_posts_link
							),
							[
								'a' => [
									'href' => true,
								],
							]
						);
						?>
					</li>
					<li>
						<?php
						echo wp_kses(
							// phpcs:ignore Generic.Files.LineLength.MaxExceeded,Generic.Files.LineLength.TooLong -- Single string for translators / i18n tools.
							__( 'Open the <strong>beehiiv</strong> panel in the editor sidebar (beehiiv icon in the top toolbar).', 'beehiiv' ),
							[ 'strong' => [] ]
						);
						?>
					</li>
					<li>
						<?php
						echo wp_kses(
							// phpcs:ignore Generic.Files.LineLength.MaxExceeded,Generic.Files.LineLength.TooLong -- Single string for translators / i18n tools.
							__( 'Turn on <strong>Send to newsletter</strong> before you publish, and the post will be queued for delivery via beehiiv.', 'beehiiv' ),
							[ 'strong' => [] ]
						);
						?>
					</li>
				</ol>
			</div>
		<?php endif; ?>

		<p class="description beehiiv-connection-docs">
			<?php
			$plugin_page_link = sprintf(
				'<a href="%1$s" target="_blank" rel="noopener noreferrer">%2$s</a>',
				esc_url( Config::PLUGIN_DOC_URL ),
				esc_html__( 'plugin page', 'beehiiv' )
			);
			echo wp_kses(
				sprintf(
					/* translators: %s: link to the plugin page on WordPress.org. */
					__( 'Read more in the documentation on the %s.', 'beehiiv' ),
					$plugin_page_link
				),
				[
					'a' => [
						'href'   => true,
						'target' => true,
						'rel'    => true,
					],
				]
			);
			?>
		</p>
	</div>
</div>
