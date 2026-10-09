/**
 * Connection, configuration, and newsletter send error notices.
 */
import { __, sprintf } from '@wordpress/i18n';
import { createInterpolateElement } from '@wordpress/element';
import { ExternalLink } from '@wordpress/components';

import PostSettingsNotice from './post-settings-notice';
import { useBeehiivEditorConfig } from '../hooks/use-beehiiv-editor-config';
import { usePostPublication } from '../hooks/use-post-publication';
import renderSettingsLinkMessage from '../utils/render-settings-link-message';

/**
 * @param {Object}                                                        props
 * @param {import('../hooks/use-beehiiv-post-meta').BeehiivPostMeta|null} props.beehiivMeta
 */
export default function NewsletterStatusNotices( { beehiivMeta } ) {
	const { isConnected, canWritePosts, settingsUrl, pricingUrl } =
		useBeehiivEditorConfig();
	const postPublication = usePostPublication( beehiivMeta );

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

	if ( ! canWritePosts ) {
		return (
			<PostSettingsNotice status="error">
				{ createInterpolateElement(
					__(
						"Your connected beehiiv account doesn't have access to send newsletters. This integration requires the <strong>Max</strong> or <strong>Enterprise</strong> plan. <a>Learn more about plans.</a>",
						'beehiiv'
					),
					{
						strong: <strong />,
						a: <ExternalLink href={ pricingUrl } />,
					}
				) }
			</PostSettingsNotice>
		);
	}

	if ( postPublication.publications.length === 0 ) {
		return (
			<PostSettingsNotice status="error">
				{ renderSettingsLinkMessage(
					__(
						'Choose a publication in <a>beehiiv settings</a> to send newsletters.',
						'beehiiv'
					),
					settingsUrl
				) }
			</PostSettingsNotice>
		);
	}

	return (
		<>
			<PostPublicationNotices
				beehiivMeta={ beehiivMeta }
				postPublication={ postPublication }
			/>
			<NewsletterErrorNotice
				beehiivMeta={ beehiivMeta }
				settingsUrl={ settingsUrl }
			/>
		</>
	);
}

/**
 * Publication and template the post still needs before it can send.
 *
 * @param {Object}                                                        props
 * @param {import('../hooks/use-beehiiv-post-meta').BeehiivPostMeta|null} props.beehiivMeta
 * @param {import('../hooks/use-post-publication').PostPublication}       props.postPublication
 */
function PostPublicationNotices( { beehiivMeta, postPublication } ) {
	if (
		! beehiivMeta?.sendToNewsletter ||
		beehiivMeta.newsletterAlreadySent
	) {
		return null;
	}

	const {
		publications,
		defaultPublicationId,
		isFallback,
		missingPublication,
		missingTemplate,
	} = postPublication;

	if ( isFallback ) {
		const defaultPublication = publications.find(
			( item ) => item.id === defaultPublicationId
		);

		return (
			<PostSettingsNotice status="error">
				{ sprintf(
					/* translators: %s: default beehiiv publication name */
					__(
						'The publication chosen for this post is no longer connected. The newsletter will be sent to the default publication "%s" instead.',
						'beehiiv'
					),
					defaultPublication?.name || defaultPublicationId
				) }
			</PostSettingsNotice>
		);
	}

	if ( missingPublication ) {
		return (
			<PostSettingsNotice status="warning">
				{ __( 'Choose a publication for this post.', 'beehiiv' ) }
			</PostSettingsNotice>
		);
	}

	if ( missingTemplate ) {
		return (
			<PostSettingsNotice status="warning">
				{ __( 'Pick a post template for this post.', 'beehiiv' ) }
			</PostSettingsNotice>
		);
	}

	return null;
}

/**
 * Save or send error recorded by the server for this post.
 *
 * @param {Object}                                                        props
 * @param {import('../hooks/use-beehiiv-post-meta').BeehiivPostMeta|null} props.beehiivMeta
 * @param {string}                                                        props.settingsUrl
 */
function NewsletterErrorNotice( { beehiivMeta, settingsUrl } ) {
	if ( ! beehiivMeta?.newsletterError ) {
		return null;
	}

	const { newsletterError, newsletterErrorType } = beehiivMeta;

	if ( newsletterErrorType === 'publication_fallback' ) {
		return (
			<PostSettingsNotice status="error">
				{ newsletterError }
			</PostSettingsNotice>
		);
	}

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
