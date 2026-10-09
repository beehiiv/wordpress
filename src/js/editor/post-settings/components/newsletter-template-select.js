/**
 * Post template picker for a queued newsletter.
 */
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { Button, SelectControl, Spinner } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

import { useBeehiivEditorConfig } from '../hooks/use-beehiiv-editor-config';

/**
 * @param {Object}                  props
 * @param {string}                  props.value                Saved template ID, or empty for the default.
 * @param {(value: string) => void} props.onChange             Called when the user picks a template.
 * @param {string}                  props.publicationId        Publication whose templates are listed.
 * @param {boolean}                 props.isDefaultPublication Whether that is the site-wide default publication.
 * @param {boolean}                 [props.disabled]           Whether the choice is locked.
 */
export default function NewsletterTemplateSelect( {
	value,
	onChange,
	publicationId,
	isDefaultPublication,
	disabled = false,
} ) {
	const { defaultPostTemplateId: siteDefaultPostTemplateId } =
		useBeehiivEditorConfig();
	// Only the site-wide default publication has a default template.
	const defaultPostTemplateId = isDefaultPublication
		? siteDefaultPostTemplateId
		: '';
	const [ templates, setTemplates ] = useState( [] );
	const [ isLoading, setIsLoading ] = useState( false );
	const [ justRefreshed, setJustRefreshed ] = useState( false );
	const noticeTimer = useRef( null );
	const requestId = useRef( 0 );

	useEffect( () => {
		return () => {
			if ( noticeTimer.current ) {
				clearTimeout( noticeTimer.current );
			}
		};
	}, [] );

	const loadTemplates = useCallback(
		( { refresh = false } = {} ) => {
			// Ignore responses for a publication the editor has since switched away from.
			const currentRequest = ++requestId.current;

			if ( ! publicationId ) {
				setTemplates( [] );
				setIsLoading( false );
				return Promise.resolve();
			}

			setIsLoading( true );

			return apiFetch( {
				path: `/beehiiv/v1/post-templates?publication_id=${ encodeURIComponent(
					publicationId
				) }${ refresh ? '&refresh=1' : '' }`,
			} )
				.then( ( items ) => {
					if ( currentRequest === requestId.current ) {
						setTemplates( Array.isArray( items ) ? items : [] );
					}
				} )
				.catch( () => {
					if ( currentRequest === requestId.current ) {
						setTemplates( [] );
					}
				} )
				.finally( () => {
					if ( currentRequest === requestId.current ) {
						setIsLoading( false );
					}
				} );
		},
		[ publicationId ]
	);

	useEffect( () => {
		setTemplates( [] );
		loadTemplates();
	}, [ loadTemplates ] );

	const handleRefresh = useCallback( () => {
		setJustRefreshed( false );

		if ( noticeTimer.current ) {
			clearTimeout( noticeTimer.current );
		}

		loadTemplates( { refresh: true } ).then( () => {
			setJustRefreshed( true );
			noticeTimer.current = setTimeout(
				() => setJustRefreshed( false ),
				4000
			);
		} );
	}, [ loadTemplates ] );

	// The default template shows as selected when the post has no template of its own.
	const selectedValue = value || defaultPostTemplateId;

	const options = useMemo( () => {
		const opts = templates
			.filter( ( item ) => item?.id )
			.map( ( item ) => ( {
				value: item.id,
				label:
					item.id === defaultPostTemplateId
						? sprintf(
								/* translators: %s: post template name */
								__( '%s (default)', 'beehiiv' ),
								item.name || item.id
						  )
						: item.name || item.id,
			} ) );

		if ( opts.length === 0 && ! selectedValue ) {
			return opts;
		}

		if (
			defaultPostTemplateId &&
			! opts.some( ( option ) => option.value === defaultPostTemplateId )
		) {
			opts.unshift( {
				value: defaultPostTemplateId,
				label: sprintf(
					/* translators: %s: post template ID */
					__( '%s (default)', 'beehiiv' ),
					defaultPostTemplateId
				),
			} );
		}

		if ( value && ! opts.some( ( option ) => option.value === value ) ) {
			opts.push( {
				value,
				label: value,
			} );
		}

		if ( ! selectedValue ) {
			opts.unshift( {
				value: '',
				label: __( 'Select a template', 'beehiiv' ),
			} );
		}

		return opts;
	}, [ templates, value, selectedValue, defaultPostTemplateId ] );

	if ( isLoading && options.length === 0 ) {
		return (
			<div className="beehiiv-newsletter-template">
				<Spinner />
			</div>
		);
	}

	if ( options.length === 0 ) {
		return null;
	}

	return (
		<div className="beehiiv-newsletter-template">
			<SelectControl
				label={ __( 'Post template', 'beehiiv' ) }
				value={ selectedValue }
				options={ options }
				onChange={ onChange }
				help={
					disabled
						? __(
								'The newsletter has been sent, so its template can no longer change.',
								'beehiiv'
						  )
						: undefined
				}
				disabled={ disabled || isLoading }
				__nextHasNoMarginBottom
			/>
			<Button
				variant="secondary"
				onClick={ handleRefresh }
				disabled={ disabled || isLoading }
				isBusy={ isLoading }
			>
				{ isLoading
					? __( 'Refreshing…', 'beehiiv' )
					: __( 'Refresh templates', 'beehiiv' ) }
			</Button>
			{ justRefreshed && (
				<p
					className="beehiiv-newsletter-template__refresh-notice"
					role="status"
				>
					{ __( 'Templates updated from beehiiv.', 'beehiiv' ) }
				</p>
			) }
			<p className="beehiiv-newsletter-template__refresh-help">
				{ __(
					'Templates are cached. Refresh to pull the latest from beehiiv after adding, renaming, or deleting one.',
					'beehiiv'
				) }
			</p>
		</div>
	);
}
