/**
 * Helpers for Custom HTML blocks in the beehiiv newsletter.
 */

export const HTML_BLOCK = 'core/html';

/** Block attribute that holds the "Newsletter only" option (keep in sync with PHP). */
export const NEWSLETTER_ONLY_ATTRIBUTE = 'beehiivNewsletterOnly';

/**
 * Whether HTML holds a script or iframe element, which beehiiv HTML Snippets do not accept.
 *
 * @param {string|undefined} html Block HTML.
 * @return {boolean} True when the newsletter will leave an element out.
 */
export function hasUnsupportedHtmlElements( html ) {
	return /<\s*(?:script|iframe)\b/i.test( html ?? '' );
}
