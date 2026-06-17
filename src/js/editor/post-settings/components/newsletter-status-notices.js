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
	const { isConnected, settingsUrl, hasPublication, hasPostTemplate } =
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

	let errorMessage = '';

	if ( ! hasPublication && ! hasPostTemplate ) {
		errorMessage = __(
			'Setup required: Select a publication and post template in <a>Beehiiv Settings</a> to start sending newsletters.',
			'beehiiv'
		);
	} else if ( ! hasPublication ) {
		errorMessage = __(
			'Setup required: Select a publication in <a>Beehiiv Settings</a> to start sending newsletters.',
			'beehiiv'
		);
	} else if ( ! hasPostTemplate ) {
		errorMessage = __(
			'Setup required: Select a post template in <a>Beehiiv Settings</a> to start sending newsletters.',
			'beehiiv'
		);
	}

	if ( errorMessage ) {
		return (
			<PostSettingsNotice status="error">
				{ createInterpolateElement( errorMessage, { a: <ExternalLink href={ settingsUrl } /> } ) }
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
