/**
 * Send a beehiiv test email of the saved post from the beehiiv sidebar.
 */
import { __, _n, sprintf } from '@wordpress/i18n';
import { useState } from '@wordpress/element';
import { useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { Button, TextareaControl } from '@wordpress/components';
import apiFetch from '@wordpress/api-fetch';

import PostSettingsNotice from './post-settings-notice';
import {
	formatSiteDateTime,
	getFutureNewsletterSendDateString,
} from './newsletter-linked-notice';
import { useBeehiivEditorConfig } from '../hooks/use-beehiiv-editor-config';
import renderSettingsLinkMessage from '../utils/render-settings-link-message';

const ELIGIBLE_STATUSES = [ 'draft', 'pending', 'future' ];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Split a recipients field on commas and new lines, trimmed and de-duplicated.
 *
 * Duplicates are matched case-insensitively; the first spelling is kept.
 *
 * @param {string} value Raw field value.
 * @return {string[]} Addresses in entry order.
 */
export function parseRecipients( value ) {
	const seen = new Set();

	return ( value || '' )
		.split( /[,\r\n]+/ )
		.map( ( part ) => part.trim() )
		.filter( ( email ) => {
			const key = email.toLowerCase();

			if ( ! email || seen.has( key ) ) {
				return false;
			}

			seen.add( key );

			return true;
		} );
}

/**
 * Why test send is unavailable for the saved post, or null when it is available.
 *
 * @param {Object}                                                   args
 * @param {string}                                                   args.savedStatus Saved post status.
 * @param {import('../hooks/use-beehiiv-post-meta').BeehiivPostMeta} args.meta        beehiiv post meta.
 * @return {string|null} Reason shown to the editor.
 */
function getUnavailableReason( { savedStatus, meta } ) {
	const isLinked = meta.newsletterAlreadySent;

	if (
		isLinked &&
		! getFutureNewsletterSendDateString(
			meta.beehiivScheduledAt,
			meta.sendToNewsletterDate
		)
	) {
		return __(
			"This post's newsletter was already sent, so it can't send a test email.",
			'beehiiv'
		);
	}

	if ( ! ELIGIBLE_STATUSES.includes( savedStatus ) ) {
		return __(
			'Test emails are available for drafts, pending posts, and scheduled posts.',
			'beehiiv'
		);
	}

	if ( isLinked && meta.newsletterError ) {
		return __(
			"This post's newsletter isn't in sync with beehiiv. Save the post again, then send a test email.",
			'beehiiv'
		);
	}

	return null;
}

/**
 * Success notice text for a completed test send.
 *
 * @param {{remaining_test_sends: number|null, reset_at: number|null}} data REST response.
 * @return {string} Confirmation with sends left and the reset time when known.
 */
function getSuccessMessage( data ) {
	const parts = [ __( 'Test email sent.', 'beehiiv' ) ];

	if ( Number.isInteger( data?.remaining_test_sends ) ) {
		parts.push(
			sprintf(
				/* translators: %d: number of test sends left today. */
				_n(
					'%d test send left today.',
					'%d test sends left today.',
					data.remaining_test_sends,
					'beehiiv'
				),
				data.remaining_test_sends
			)
		);
	}

	if ( Number.isInteger( data?.reset_at ) ) {
		const resetAt = formatSiteDateTime(
			new Date( data.reset_at * 1000 ).toISOString()
		);

		if ( resetAt ) {
			parts.push(
				sprintf(
					/* translators: %s: date, time, and timezone when test sends reset. */
					__( 'Test sends reset on %s.', 'beehiiv' ),
					resetAt
				)
			);
		}
	}

	return parts.join( ' ' );
}

/**
 * @param {Object}                                                   props
 * @param {import('../hooks/use-beehiiv-post-meta').BeehiivPostMeta} props.beehiivMeta
 */
export default function TestEmailSend( { beehiivMeta } ) {
	const { settingsUrl } = useBeehiivEditorConfig();
	const [ recipients, setRecipients ] = useState( '' );
	const [ isSending, setIsSending ] = useState( false );
	const [ result, setResult ] = useState( null );

	const { postId, savedStatus, isDirty, isNew, isSaving } = useSelect(
		( select ) => {
			const editor = select( editorStore );

			return {
				postId: editor.getCurrentPostId(),
				savedStatus: editor.getCurrentPostAttribute( 'status' ),
				isDirty: editor.isEditedPostDirty(),
				isNew: editor.isEditedPostNew(),
				isSaving: editor.isSavingPost(),
			};
		},
		[]
	);

	const needsSave = isNew || isDirty;
	const unavailableReason = isNew
		? null
		: getUnavailableReason( { savedStatus, meta: beehiivMeta } );

	if ( unavailableReason ) {
		return (
			<div className="beehiiv-test-email">
				<p className="beehiiv-test-email__reason">
					{ unavailableReason }
				</p>
			</div>
		);
	}

	const onSend = () => {
		const addresses = parseRecipients( recipients );

		if ( addresses.length === 0 ) {
			setResult( {
				status: 'error',
				message: __( 'Enter at least one email address.', 'beehiiv' ),
			} );
			return;
		}

		const invalid = addresses.filter(
			( email ) => ! EMAIL_PATTERN.test( email )
		);

		if ( invalid.length > 0 ) {
			setResult( {
				status: 'error',
				message: sprintf(
					/* translators: %s: comma-separated list of invalid email addresses. */
					__( "These email addresses aren't valid: %s", 'beehiiv' ),
					invalid.join( ', ' )
				),
			} );
			return;
		}

		setIsSending( true );
		setResult( null );

		apiFetch( {
			path: '/beehiiv/v1/test-send',
			method: 'POST',
			data: {
				post_id: postId,
				recipients: addresses.join( '\n' ),
			},
		} )
			.then( ( data ) => {
				setResult( {
					status: 'success',
					message: getSuccessMessage( data ),
					leftoverDraft: !! data?.leftover_draft,
				} );
			} )
			.catch( ( error ) => {
				setResult( {
					status: 'error',
					message:
						error?.message ||
						__(
							"Something went wrong and the test email wasn't sent. Try again.",
							'beehiiv'
						),
				} );
			} )
			.finally( () => {
				setIsSending( false );
			} );
	};

	return (
		<div className="beehiiv-test-email">
			<TextareaControl
				__nextHasNoMarginBottom
				label={ __( 'Send test email to', 'beehiiv' ) }
				help={ __(
					'Separate addresses with commas or new lines.',
					'beehiiv'
				) }
				value={ recipients }
				onChange={ setRecipients }
				rows={ 3 }
			/>

			{ needsSave && (
				<p className="beehiiv-test-email__note">
					{ __(
						'Save the post to include your latest edits.',
						'beehiiv'
					) }
				</p>
			) }

			<Button
				variant="secondary"
				onClick={ onSend }
				isBusy={ isSending }
				disabled={ needsSave || isSaving || isSending }
				accessibleWhenDisabled
			>
				{ __( 'Send test email', 'beehiiv' ) }
			</Button>

			{ result && (
				<PostSettingsNotice status={ result.status }>
					<p className="beehiiv-post-settings-notice__text">
						{ renderSettingsLinkMessage(
							result.message,
							settingsUrl
						) }
					</p>
					{ result.leftoverDraft && (
						<p className="beehiiv-post-settings-notice__text">
							{ __(
								'A leftover test draft may still be in beehiiv. You can delete it there.',
								'beehiiv'
							) }
						</p>
					) }
				</PostSettingsNotice>
			) }
		</div>
	);
}
