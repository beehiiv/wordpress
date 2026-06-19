/**
 * Post template picker for a queued newsletter.
 */
import { useEffect, useMemo, useState } from '@wordpress/element';
import { SelectControl, Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

import { useBeehiivEditorConfig } from '../hooks/use-beehiiv-editor-config';

/**
 * @param {Object}                  props
 * @param {string}                  props.value    Saved template ID, or empty for plugin default.
 * @param {(value: string) => void} props.onChange Called when the user picks a template.
 */
export default function NewsletterTemplateSelect( { value, onChange } ) {
	const { publicationId, defaultPostTemplateId } = useBeehiivEditorConfig();
	const [ templates, setTemplates ] = useState( [] );
	const [ isLoading, setIsLoading ] = useState( false );

	useEffect( () => {
		if ( ! publicationId ) {
			setTemplates( [] );
			return;
		}

		let cancelled = false;
		setIsLoading( true );

		apiFetch( {
			path: `/beehiiv/v1/post-templates?publication_id=${ encodeURIComponent(
				publicationId
			) }`,
		} )
			.then( ( items ) => {
				if ( ! cancelled ) {
					setTemplates( Array.isArray( items ) ? items : [] );
				}
			} )
			.catch( () => {
				if ( ! cancelled ) {
					setTemplates( [] );
				}
			} )
			.finally( () => {
				if ( ! cancelled ) {
					setIsLoading( false );
				}
			} );

		return () => {
			cancelled = true;
		};
	}, [ publicationId ] );

	const options = useMemo( () => {
		const opts = templates
			.filter( ( item ) => item?.id )
			.map( ( item ) => ( {
				value: item.id,
				label: item.name || item.id,
			} ) );

		const effectiveValue = value || defaultPostTemplateId;

		if (
			effectiveValue &&
			! opts.some( ( option ) => option.value === effectiveValue )
		) {
			opts.push( {
				value: effectiveValue,
				label: effectiveValue,
			} );
		}

		return opts;
	}, [ templates, value, defaultPostTemplateId ] );

	const selectedValue = value || defaultPostTemplateId || '';

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
		<SelectControl
			className="beehiiv-newsletter-template"
			label={ __( 'Post template', 'beehiiv' ) }
			value={ selectedValue }
			options={ options }
			onChange={ onChange }
			help={
				! value && defaultPostTemplateId
					? __(
							'Using the template from plugin settings.',
							'beehiiv'
					  )
					: undefined
			}
		/>
	);
}
