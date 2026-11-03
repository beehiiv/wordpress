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
	 * Divider block name.
	 */
	public const DIVIDER_NAME = 'beehiiv/gated-content-divider';

	/**
	 * Site-wide unlock cookie name.
	 */
	public const COOKIE_NAME = 'beehiiv_gate_unlocked';

	/**
	 * Beehiiv form loader script.
	 */
	private const LOADER_SRC = 'https://subscribe-forms.beehiiv.com/v3/loader.js';

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

			// With no divider, the whole block is gated.
			if ( $split || ! $has_divider ) {
				$locked[] = $html;
			} else {
				$preview[] = $html;
			}
		}

		$defaults = Options::get_gate_settings();
		$form_id  = isset( $attributes['formId'] ) ? trim( sanitize_text_field( $attributes['formId'] ) ) : '';
		$form_id  = '' !== $form_id ? $form_id : $defaults['form_id'];

		// Nothing to gate, no form to unlock with, or a logged-in user: show the
		// content in full.
		if (
			empty( $locked )
			|| '' === $form_id
			|| is_user_logged_in()
		) {
			return sprintf(
				'<div %s>%s</div>',
				get_block_wrapper_attributes(),
				implode( '', array_merge( $preview, $locked ) )
			);
		}

		$headline = isset( $attributes['headline'] ) ? trim( sanitize_text_field( $attributes['headline'] ) ) : '';
		$text     = isset( $attributes['text'] ) ? trim( sanitize_text_field( $attributes['text'] ) ) : '';
		$headline = '' !== $headline ? $headline : $defaults['headline'];
		$text     = '' !== $text ? $text : $defaults['text'];

		// Optional per-block card colors. Anything that is not a hex color is dropped.
		$card_bg    = isset( $attributes['cardBackgroundColor'] ) ? sanitize_hex_color( $attributes['cardBackgroundColor'] ) : '';
		$card_color = isset( $attributes['cardTextColor'] ) ? sanitize_hex_color( $attributes['cardTextColor'] ) : '';
		$card_style = '';

		if ( $card_bg ) {
			$card_style .= 'background-color:' . $card_bg . ';';
		}

		if ( $card_color ) {
			$card_style .= 'color:' . $card_color . ';';
		}

		// A blank headline or text is left out of the card.
		$headline_html = '' !== $headline
			? '<p class="beehiiv-gated-content__headline">' . esc_html( $headline ) . '</p>'
			: '';
		$text_html     = '' !== $text
			? '<p class="beehiiv-gated-content__text">' . esc_html( $text ) . '</p>'
			: '';

		$card = sprintf(
			'<div class="beehiiv-gated-content__card"%1$s>%2$s%3$s%4$s</div>',
			'' !== $card_style ? ' style="' . esc_attr( $card_style ) . '"' : '',
			$headline_html,
			$text_html,
			self::get_boot_script( $form_id )
		);

		$gate = sprintf(
			'<div class="beehiiv-gated-content__gate" data-beehiiv-gate data-form-id="%1$s" '
			. 'data-cookie-name="%2$s" data-cookie-days="%3$d" data-unlocked-message="%6$s">%4$s'
			. '<div class="beehiiv-gated-content__locked" aria-hidden="true" inert>%5$s</div></div>',
			esc_attr( $form_id ),
			esc_attr( self::COOKIE_NAME ),
			(int) $defaults['cookie_days'],
			$card,
			implode( '', $locked ),
			esc_attr__( 'Content unlocked.', 'beehiiv' )
		);

		return sprintf(
			'<div %1$s>%2$s%3$s</div>',
			get_block_wrapper_attributes(),
			implode( '', $preview ),
			$gate
		);
	}

	/**
	 * Inline script that runs as the card is parsed, before the first paint.
	 *
	 * A reader who already has the unlock cookie gets the gate opened at once, so
	 * the blurred content never flashes, and the form loader is never requested.
	 * Everyone else gets the form loader right away, with no wait for view.js.
	 *
	 * @param string $form_id Beehiiv form ID.
	 * @return string
	 */
	private static function get_boot_script( string $form_id ): string {
		$cookie = wp_json_encode( self::COOKIE_NAME );
		$src    = wp_json_encode( self::LOADER_SRC );
		$form   = wp_json_encode( $form_id );

		$js = '(function(s){var c=s.parentNode,g=c.parentNode;'
			. 'if(document.cookie.split("; ").some(function(p){return p.split("=")[0]===' . $cookie . '})){'
			. 'g.classList.add("is-unlocked");c.classList.add("is-hidden");return;}'
			. 'var l=document.createElement("script");l.async=true;l.src=' . $src . ';'
			. 'l.setAttribute("data-beehiiv-form",' . $form . ');c.appendChild(l);})(document.currentScript);';

		return wp_get_inline_script_tag( $js );
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
