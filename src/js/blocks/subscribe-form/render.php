<?php
/**
 * Server-side render for the subscribe form block.
 *
 * @package beehiiv
 *
 * @var array    $attributes Block attributes.
 * @var string   $content    Block content.
 * @var WP_Block $block      Block instance.
 */

defined( 'ABSPATH' ) || exit;

$form_id = isset( $attributes['formId'] ) ? sanitize_text_field( $attributes['formId'] ) : '';

if ( empty( $form_id ) ) {
	return;
}

$wrapper_attributes = get_block_wrapper_attributes();
?>

<div <?php echo $wrapper_attributes; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>>
	<?php
	wp_print_script_tag(
		[
			'src'               => 'https://subscribe-forms.beehiiv.com/v3/loader.js',
			'async'             => true,
			'data-beehiiv-form' => $form_id,
		]
	);
	?>
</div>
