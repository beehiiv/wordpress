<?php
/**
 * Server-side markup for the gated content block.
 *
 * @package beehiiv
 */

namespace Beehiiv\Blocks;

use Beehiiv\Admin\Options;
use WP_Block;

defined( 'ABSPATH' ) || exit;

/**
 * Splits a gated content block into preview and locked content and renders the gate.
 *
 * The gate is always rendered on the server so full-page caches work. The
 * browser removes it when the unlock cookie exists (see the block's view.js).
 *
 * @since 1.2.0
 */
final class GatedContent {

	/**
	 * Gated content block name.
	 */
	public const BLOCK_NAME = 'beehiiv/gated-content';

	/**
	 * Divider block name.
	 */
	public const DIVIDER_NAME = 'beehiiv/gated-content-divider';

	/**
	 * Site-wide unlock cookie name.
	 */
	public const COOKIE_NAME = 'beehiiv_gate_unlocked';

	/**
	 * Whether a gate has already been rendered on this page.
	 *
	 * @var bool
	 */
	private static $gate_rendered = false;

	/**
	 * Forget which gate was rendered (new page / tests).
	 *
	 * @since 1.2.0
	 */
	public static function reset(): void {
		self::$gate_rendered = false;
	}

	/**
	 * Render the block.
	 *
	 * @param array<string, mixed> $attributes Block attributes.
	 * @param WP_Block             $block      Block instance.
	 * @return string
	 * @since 1.2.0
	 */
	public static function render( array $attributes, WP_Block $block ): string {
		$preview = [];
		$locked  = [];
		$split   = false;
		$count   = 0;

		// Work out once, before looping. The inner block list shares one cursor,
		// so scanning it again inside the loop below would restart the loop forever.
		$has_divider = self::has_divider( $block );

		foreach ( $block->inner_blocks as $inner_block ) {
			if ( self::DIVIDER_NAME === $inner_block->name ) {
				// Only the first divider counts. A divider never prints anything.
				$split = true;
				continue;
			}

			$html = $inner_block->render();

			if ( $split || ( 0 < $count && ! $has_divider ) ) {
				$locked[] = $html;
			} else {
				$preview[] = $html;
			}

			++$count;
		}

		$form_id = isset( $attributes['formId'] ) ? sanitize_text_field( $attributes['formId'] ) : '';

		// Nothing to gate, no form to unlock with, logged-in user, or a second
		// gate on the page: show the content in full.
		if (
			empty( $locked )
			|| '' === $form_id
			|| is_user_logged_in()
			|| self::$gate_rendered
		) {
			return sprintf(
				'<div %s>%s</div>',
				get_block_wrapper_attributes(),
				implode( '', array_merge( $preview, $locked ) )
			);
		}

		self::$gate_rendered = true;

		$defaults = Options::get_gate_settings();
		$headline = isset( $attributes['headline'] ) ? trim( sanitize_text_field( $attributes['headline'] ) ) : '';
		$text     = isset( $attributes['text'] ) ? trim( sanitize_text_field( $attributes['text'] ) ) : '';
		$headline = '' !== $headline ? $headline : $defaults['headline'];
		$text     = '' !== $text ? $text : $defaults['text'];

		$form_script = wp_get_script_tag(
			[
				'src'               => 'https://subscribe-forms.beehiiv.com/v3/loader.js',
				'async'             => true,
				'data-beehiiv-form' => $form_id,
			]
		);

		// Optional per-block card colors. Anything that is not a hex color is dropped.
		$card_bg    = isset( $attributes['cardBackgroundColor'] ) ? sanitize_hex_color( $attributes['cardBackgroundColor'] ) : '';
		$card_color = isset( $attributes['cardTextColor'] ) ? sanitize_hex_color( $attributes['cardTextColor'] ) : '';
		$card_style = '';

		if ( $card_bg ) {
			$card_style .= 'background-color:' . $card_bg . ';';
		}

		if ( $card_color ) {
			$card_style .= 'color:' . $card_color . ';--beehiiv-gate-card-color:' . $card_color . ';';
		}

		$card = sprintf(
			'<div class="beehiiv-gated-content__card"%4$s><h2 class="beehiiv-gated-content__headline">%1$s</h2>'
			. '<p class="beehiiv-gated-content__text">%2$s</p>%3$s</div>',
			esc_html( $headline ),
			esc_html( $text ),
			$form_script,
			'' !== $card_style ? ' style="' . esc_attr( $card_style ) . '"' : ''
		);

		$gate = sprintf(
			'<div class="beehiiv-gated-content__gate" data-beehiiv-gate data-form-id="%1$s" '
			. 'data-cookie-name="%2$s" data-cookie-days="%3$d">%4$s'
			. '<div class="beehiiv-gated-content__locked" aria-hidden="true" inert>%5$s</div></div>',
			esc_attr( $form_id ),
			esc_attr( self::COOKIE_NAME ),
			(int) $defaults['cookie_days'],
			$card,
			implode( '', $locked )
		);

		return sprintf(
			'<div %1$s>%2$s%3$s</div>',
			get_block_wrapper_attributes(),
			implode( '', $preview ),
			$gate
		);
	}

	/**
	 * Whether a block has a divider among its direct inner blocks.
	 *
	 * @param WP_Block $block Gated content block.
	 * @return bool
	 */
	private static function has_divider( WP_Block $block ): bool {
		foreach ( $block->inner_blocks as $inner_block ) {
			if ( self::DIVIDER_NAME === $inner_block->name ) {
				return true;
			}
		}

		return false;
	}
}
