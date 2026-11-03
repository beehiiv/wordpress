<?php
/**
 * Server-side render for the gated content block.
 *
 * @package beehiiv
 *
 * @var array    $attributes Block attributes.
 * @var string   $content    Block content.
 * @var WP_Block $block      Block instance.
 */

defined( 'ABSPATH' ) || exit;

echo \Beehiiv\Blocks\GatedContent::render( $attributes, $block ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
