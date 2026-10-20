/**
 * Preview the real beehiiv email of the saved post in a WordPress modal.
 */
import { __ } from '@wordpress/i18n';
import { useRef, useState } from '@wordpress/element';
import { useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { Button, Modal, Spinner } from '@wordpress/components';
import { update } from '@wordpress/icons';
import apiFetch from '@wordpress/api-fetch';

import { useBeehiivEditorConfig } from '../hooks/use-beehiiv-editor-config';
import renderSettingsLinkMessage from '../utils/render-settings-link-message';

/**
 * Make the email view-only: links cannot be followed, even with the keyboard.
 * Scripts and forms are already blocked by the empty `sandbox` attribute.
 */
const INERT_HEAD =
	'<base target="_blank"><style>a,a *{pointer-events:none!important;cursor:default!important}</style>';

/**
 * @param {string} html Rendered email HTML from beehiiv.
 * @return {string} HTML with links made inert.
 */
export function makeEmailInert( html ) {
	return (
		html.replace( /<a\b([^>]*)>/gi, ( match, attrs ) => {
			const stripped = attrs.replace(
				/\shref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i,
				''
			);
			return `<a${ stripped }>`;
		} ) + INERT_HEAD
	);
}

/**
 * @param {Object}                                                   props
 * @param {import('../hooks/use-beehiiv-post-meta').BeehiivPostMeta} props.beehiivMeta
 */
export default function EmailPreview( { beehiivMeta } ) {
	const { settingsUrl } = useBeehiivEditorConfig();
	const [ isOpen, setIsOpen ] = useState( false );
	const [ isLoading, setIsLoading ] = useState( false );
	const [ email, setEmail ] = useState( null );
	const [ device, setDevice ] = useState( 'desktop' );
	const [ error, setError ] = useState( null );
	const latestRequest = useRef( 0 );

	const { postId, isDirty, isNew, isSaving } = useSelect( ( select ) => {
		const editor = select( editorStore );

		return {
			postId: editor.getCurrentPostId(),
			isDirty: editor.isEditedPostDirty(),
			isNew: editor.isEditedPostNew(),
			isSaving: editor.isSavingPost(),
		};
	}, [] );

	if ( beehiivMeta.newsletterAlreadySent ) {
		return (
			<p className="beehiiv-email-preview__reason">
				{ __(
					"This newsletter is already scheduled or sent, so it can't be previewed.",
					'beehiiv'
				) }
			</p>
		);
	}

	const needsSave = isNew || isDirty;

	const load = () => {
		const requestId = ++latestRequest.current;

		setIsLoading( true );
		setError( null );
		setEmail( null );

		apiFetch( {
			path: '/beehiiv/v1/email-preview',
			method: 'POST',
			data: { post_id: postId },
		} )
			.then( ( data ) => {
				if ( requestId === latestRequest.current ) {
					setEmail(
						data?.html
							? {
									html: data.html,
									subject: data.subject ?? '',
									previewText: data.preview_text ?? '',
									fromName: data.from_name ?? '',
							  }
							: null
					);
				}
			} )
			.catch( ( apiError ) => {
				if ( requestId === latestRequest.current ) {
					setError(
						apiError?.message ||
							__(
								"Something went wrong and the preview couldn't load. Try again.",
								'beehiiv'
							)
					);
				}
			} )
			.finally( () => {
				if ( requestId === latestRequest.current ) {
					setIsLoading( false );
				}
			} );
	};

	const open = () => {
		setIsOpen( true );
		load();
	};

	const close = () => {
		// Ignore any request still in flight; reopening runs a fresh sync.
		latestRequest.current++;
		setIsOpen( false );
		setIsLoading( false );
		setEmail( null );
		setError( null );
	};

	return (
		<div className="beehiiv-email-preview">
			{ needsSave && (
				<p className="beehiiv-email-preview__note">
					{ __(
						'Save the post to preview your latest edits.',
						'beehiiv'
					) }
				</p>
			) }

			<Button
				variant="secondary"
				onClick={ open }
				disabled={ needsSave || isSaving }
				accessibleWhenDisabled
			>
				{ __( 'Preview email', 'beehiiv' ) }
			</Button>

			{ isOpen && (
				<Modal
					title={ __( 'Email preview', 'beehiiv' ) }
					onRequestClose={ close }
					size="fill"
					className="beehiiv-email-preview__modal"
				>
					{ isLoading && (
						<p className="beehiiv-email-preview__loading">
							<Spinner />{ ' ' }
							{ __( 'Preparing your email preview…', 'beehiiv' ) }
						</p>
					) }

					{ error && (
						<div className="beehiiv-email-preview__error">
							<p>
								{ renderSettingsLinkMessage(
									error,
									settingsUrl
								) }
							</p>
							<Button variant="secondary" onClick={ load }>
								{ __( 'Try again', 'beehiiv' ) }
							</Button>
						</div>
					) }

					{ email && (
						<div className="beehiiv-email-preview__stage">
							<div className="beehiiv-email-preview__toolbar">
								<div className="beehiiv-email-preview__devices">
									<Button
										variant={
											device === 'desktop'
												? 'primary'
												: 'secondary'
										}
										onClick={ () => setDevice( 'desktop' ) }
										aria-pressed={ device === 'desktop' }
									>
										{ __( 'Desktop', 'beehiiv' ) }
									</Button>
									<Button
										variant={
											device === 'mobile'
												? 'primary'
												: 'secondary'
										}
										onClick={ () => setDevice( 'mobile' ) }
										aria-pressed={ device === 'mobile' }
									>
										{ __( 'Mobile', 'beehiiv' ) }
									</Button>
								</div>
								<Button
									variant="tertiary"
									icon={ update }
									label={ __( 'Refresh preview', 'beehiiv' ) }
									onClick={ load }
								/>
							</div>

							<div
								className={ `beehiiv-email-preview__device is-${ device }` }
							>
								{ device === 'desktop' && (
									<div
										className="beehiiv-email-preview__chrome"
										aria-hidden="true"
									>
										<span />
										<span />
										<span />
									</div>
								) }
								<dl className="beehiiv-email-preview__meta">
									<dt>{ __( 'From:', 'beehiiv' ) }</dt>
									<dd>{ email.fromName }</dd>
									<dt>{ __( 'Subject:', 'beehiiv' ) }</dt>
									<dd>{ email.subject }</dd>
									<dt>
										{ __( 'Preview Text:', 'beehiiv' ) }
									</dt>
									<dd>{ email.previewText }</dd>
								</dl>
								<iframe
									className="beehiiv-email-preview__frame"
									title={ __(
										'beehiiv email preview',
										'beehiiv'
									) }
									sandbox=""
									srcDoc={ makeEmailInert( email.html ) }
								/>
							</div>
						</div>
					) }
				</Modal>
			) }
		</div>
	);
}
