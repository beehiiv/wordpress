/**
 * Connection, configuration, and newsletter send error notices.
 */
import { __ } from '@wordpress/i18n';

import PostSettingsNotice from './post-settings-notice';
import { useBeehiivEditorConfig } from '../hooks/use-beehiiv-editor-config';
import renderSettingsLinkMessage from '../utils/render-settings-link-message';

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
				{ renderSettingsLinkMessage(
					__(
						'Connect your beehiiv account in <a>beehiiv settings</a> before you can send newsletters.',
						'beehiiv'
					),
					settingsUrl
				) }
			</PostSettingsNotice>
		);
	}

	let errorMessage = '';

	if ( ! hasPublication && ! hasPostTemplate ) {
		errorMessage = __(
			'Choose a publication and default post template in <a>beehiiv settings</a>.',
			'beehiiv'
		);
	} else if ( ! hasPublication ) {
		errorMessage = __(
			'Choose a publication in <a>beehiiv settings</a> to send newsletters.',
			'beehiiv'
		);
	} else if ( ! hasPostTemplate ) {
		errorMessage = __(
			'Choose a default post template in <a>beehiiv settings</a> to send newsletters.',
			'beehiiv'
		);
	}

	if ( errorMessage ) {
		return (
			<PostSettingsNotice status="error">
				{ renderSettingsLinkMessage( errorMessage, settingsUrl ) }
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
				{ __( 'Could not save this post to beehiiv:', 'beehiiv' ) }{ ' ' }
				{ renderSettingsLinkMessage( newsletterError, settingsUrl ) }
			</PostSettingsNotice>
		);
	}

	return (
		<PostSettingsNotice status="error">
			{ __( 'Could not send this post to beehiiv:', 'beehiiv' ) }{ ' ' }
			{ renderSettingsLinkMessage( newsletterError, settingsUrl ) }
		</PostSettingsNotice>
	);
}
