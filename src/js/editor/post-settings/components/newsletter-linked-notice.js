/**
 * Success notice after a post is linked to a beehiiv newsletter.
 */
import { __, sprintf } from '@wordpress/i18n';
import { dateI18n, isInTheFuture } from '@wordpress/date';

import PostSettingsNotice from './post-settings-notice';

/**
 * Format a datetime for display in the WordPress site timezone.
 *
 * beehiiv `scheduled_at` values are UTC ISO strings (`…Z`). Pass a millisecond
 * timestamp into `dateI18n` so the instant is shown in the site timezone.
 *
 * @param {string} dateValue ISO 8601 datetime string.
 * @return {string|null} Formatted date, time, and timezone abbreviation.
 */
function formatSiteDateTime( dateValue ) {
	const timestamp = new Date( dateValue ).getTime();

	if ( Number.isNaN( timestamp ) ) {
		return null;
	}

	return `${ dateI18n( 'F j, g:i a', timestamp ) } ${ dateI18n(
		'T',
		timestamp
	) }`;
}

/**
 * Resolve the next future beehiiv send datetime string.
 *
 * @param {string|null|undefined} scheduledAtUtc       UTC ISO 8601 `scheduled_at` from beehiiv sync.
 * @param {string|null|undefined} sendToNewsletterDate Custom send datetime from post meta.
 * @return {string|null} Raw datetime string for a future send, or null when not scheduled.
 */
function getFutureNewsletterSendDateString(
	scheduledAtUtc,
	sendToNewsletterDate
) {
	for ( const raw of [ scheduledAtUtc, sendToNewsletterDate ] ) {
		if ( typeof raw !== 'string' || raw.length === 0 ) {
			continue;
		}

		if ( isInTheFuture( raw ) ) {
			return raw;
		}
	}

	return null;
}

/**
 * User-facing copy for a linked beehiiv newsletter.
 *
 * @param {string|null|undefined} scheduledAtUtc       UTC ISO 8601 `scheduled_at` from beehiiv sync.
 * @param {string|null|undefined} sendToNewsletterDate Custom send datetime from post meta.
 * @return {string} User-facing notice for the linked newsletter state.
 */
export function getNewsletterLinkedNoticeMessage(
	scheduledAtUtc,
	sendToNewsletterDate
) {
	const sendDate = getFutureNewsletterSendDateString(
		scheduledAtUtc,
		sendToNewsletterDate
	);

	if ( ! sendDate ) {
		return __(
			'This post was sent to your beehiiv newsletter.',
			'beehiiv'
		);
	}

	const formattedSendDate = formatSiteDateTime( sendDate );

	if ( ! formattedSendDate ) {
		return __(
			'This post was sent to your beehiiv newsletter.',
			'beehiiv'
		);
	}

	return sprintf(
		/* translators: %s: formatted newsletter send date, time, and timezone. */
		__( 'This post is scheduled in beehiiv for %s.', 'beehiiv' ),
		formattedSendDate
	);
}

/**
 * @param {Object}                                                        props
 * @param {import('../hooks/use-beehiiv-post-meta').BeehiivPostMeta|null} props.beehiivMeta
 */
export default function NewsletterLinkedNotice( { beehiivMeta } ) {
	if ( ! beehiivMeta?.newsletterAlreadySent ) {
		return null;
	}

	return (
		<PostSettingsNotice status="success">
			{ getNewsletterLinkedNoticeMessage(
				beehiivMeta.beehiivScheduledAt,
				beehiivMeta.sendToNewsletterDate
			) }
		</PostSettingsNotice>
	);
}
