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
	 * Signature of the gate that owns this page, or empty when none has rendered yet.
	 *
	 * Rendering the same block again (an SEO or excerpt pass) matches the owner
	 * and still shows the gate. A different gated block is a second gate.
	 *
	 * @var string
	 */
	private static $gate_owner = '';

	/**
	 * Forget which gate was rendered (new page / tests).
	 *
	 * @since 1.2.0
	 */
	public static function reset(): void {
		self::$gate_owner = '';
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

			// The starter template adds empty paragraphs. They do not count as content.
			if ( 1 === preg_match( '#^\s*(<p[^>]*>(\s|&nbsp;|<br\s*/?>)*</p>)?\s*$#i', $html ) ) {
				continue;
			}

			if ( $split || ( 0 < $count && ! $has_divider ) ) {
				$locked[] = $html;
			} else {
				$preview[] = $html;
			}

			++$count;
		}

		$post_id   = $block->context['postId'] ?? get_the_ID();
		$signature = md5( (string) wp_json_encode( [ $post_id, $block->parsed_block ] ) );
		$defaults  = Options::get_gate_settings();
		$form_id   = isset( $attributes['formId'] ) ? trim( sanitize_text_field( $attributes['formId'] ) ) : '';
		$form_id   = '' !== $form_id ? $form_id : $defaults['form_id'];

		// Nothing to gate, no form to unlock with, logged-in user, or a second
		// gate on the page: show the content in full.
		if (
			empty( $locked )
			|| '' === $form_id
			|| is_user_logged_in()
			|| ( '' !== self::$gate_owner && self::$gate_owner !== $signature )
		) {
			return sprintf(
				'<div %s>%s</div>',
				get_block_wrapper_attributes(),
				implode( '', array_merge( $preview, $locked ) )
			);
		}

		self::$gate_owner = $signature;

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

		// A blank headline or text is left out of the card.
		$headline_html = '' !== $headline
			? '<h2 class="beehiiv-gated-content__headline">' . esc_html( $headline ) . '</h2>'
			: '';
		$text_html     = '' !== $text
			? '<p class="beehiiv-gated-content__text">' . esc_html( $text ) . '</p>'
			: '';

		$card = sprintf(
			'<div class="beehiiv-gated-content__card"%1$s>%2$s%3$s%4$s</div>',
			'' !== $card_style ? ' style="' . esc_attr( $card_style ) . '"' : '',
			$headline_html,
			$text_html,
			$form_script
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
