/**
 * Connection, configuration, and newsletter send error notices.
 */
import { __, sprintf } from '@wordpress/i18n';
import { createInterpolateElement } from '@wordpress/element';
import { ExternalLink } from '@wordpress/components';

import PostSettingsNotice from './post-settings-notice';
import { useBeehiivEditorConfig } from '../hooks/use-beehiiv-editor-config';

/**
 * @param {Object}                                                        props
 * @param {import('../hooks/use-beehiiv-post-meta').BeehiivPostMeta|null} props.beehiivMeta
 */
export default function NewsletterStatusNotices( { beehiivMeta } ) {
	const { isConnected, settingsUrl, hasPublication, hasEmailTemplate } =
		useBeehiivEditorConfig();

	if ( ! isConnected ) {
		return (
			<PostSettingsNotice status="error">
				{ createInterpolateElement(
					__(
						'This site is not connected to Beehiiv. <a>Connect in Beehiiv settings</a> to send newsletters.',
						'beehiiv'
					),
					{
						a: <ExternalLink href={ settingsUrl } />,
					}
				) }
			</PostSettingsNotice>
		);
	}

	if ( ! hasPublication ) {
		return (
			<PostSettingsNotice status="error">
				{ createInterpolateElement(
					__(
						'No Beehiiv publication is configured. <a>Select one in Beehiiv settings</a> before sending newsletters.',
						'beehiiv'
					),
					{
						a: <ExternalLink href={ settingsUrl } />,
					}
				) }
			</PostSettingsNotice>
		);
	}

	if ( ! hasEmailTemplate ) {
		return (
			<PostSettingsNotice status="error">
				{ createInterpolateElement(
					__(
						'No default email template is configured. <a>Select one in Beehiiv settings</a> before sending newsletters.',
						'beehiiv'
					),
					{
						a: <ExternalLink href={ settingsUrl } />,
					}
				) }
			</PostSettingsNotice>
		);
	}

	if ( ! beehiivMeta?.newsletterError ) {
		return null;
	}

	const { newsletterError, newsletterErrorType } = beehiivMeta;

	if ( newsletterErrorType === 'save' ) {
		return (
			<PostSettingsNotice status="error">
				{ sprintf(
					/* translators: %s: error message from the server. */
					__( 'Could not save this post to Beehiiv: %s', 'beehiiv' ),
					newsletterError
				) }
			</PostSettingsNotice>
		);
	}

	return (
		<PostSettingsNotice status="error">
			{ sprintf(
				/* translators: %s: error message from the server or Beehiiv API. */
				__( 'Could not send this post to Beehiiv: %s', 'beehiiv' ),
				newsletterError
			) }
		</PostSettingsNotice>
	);
}
