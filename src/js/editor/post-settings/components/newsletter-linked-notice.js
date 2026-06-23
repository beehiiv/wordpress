/**
 * Success notice after a post is linked to a Beehiiv newsletter.
 */
import { __, sprintf } from '@wordpress/i18n';
import { dateI18n } from '@wordpress/date';

import PostSettingsNotice from './post-settings-notice';

/**
 * Format a datetime for display in the WordPress site timezone.
 *
 * Beehiiv `scheduled_at` values are UTC ISO strings (`…Z`). Pass a millisecond
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
 * @param {string|null|undefined} scheduledAtUtc UTC ISO 8601 `scheduled_at` from Beehiiv sync.
 * @param {string|null|undefined} sendToNewsletterDate Custom send datetime from post meta.
 * @return {string|null} Raw datetime string for a future send, or null when not scheduled.
 */
function getFutureNewsletterSendDateString(
	scheduledAtUtc,
	sendToNewsletterDate
) {
	const now = Date.now();

	for ( const raw of [ scheduledAtUtc, sendToNewsletterDate ] ) {
		if ( typeof raw !== 'string' || raw.length === 0 ) {
			continue;
		}

		const send = new Date( raw );

		if ( ! Number.isNaN( send.getTime() ) && send.getTime() > now ) {
			return raw;
		}
	}

	return null;
}

/**
 * User-facing copy for a linked Beehiiv newsletter.
 *
 * @param {string|null|undefined} scheduledAtUtc       UTC ISO 8601 `scheduled_at` from Beehiiv sync.
 * @param {string|null|undefined} sendToNewsletterDate Custom send datetime from post meta.
 * @return {string}
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
			'This post was sent to your Beehiiv newsletter.',
			'beehiiv'
		);
	}

	const formattedSendDate = formatSiteDateTime( sendDate );

	if ( ! formattedSendDate ) {
		return __(
			'This post was sent to your Beehiiv newsletter.',
			'beehiiv'
		);
	}

	return sprintf(
		/* translators: %s: formatted newsletter send date, time, and timezone. */
		__( 'This post is scheduled in Beehiiv for %s.', 'beehiiv' ),
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
