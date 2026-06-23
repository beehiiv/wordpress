<?php
/**
 * beehiiv settings page template.
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
