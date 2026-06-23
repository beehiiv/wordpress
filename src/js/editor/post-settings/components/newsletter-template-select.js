/**
 * Post template picker for a queued newsletter.
 */
import { useEffect, useMemo, useState } from '@wordpress/element';
import { SelectControl, Spinner } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
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
		const opts = [
			{
				value: '',
				label: __( 'Default (from beehiiv settings)', 'beehiiv' ),
			},
			...templates
				.filter( ( item ) => item?.id )
				.map( ( item ) => ( {
					value: item.id,
					label: item.name || item.id,
				} ) ),
		];

		if ( value && ! opts.some( ( option ) => option.value === value ) ) {
			opts.push( {
				value,
				label: value,
			} );
		}

		return opts;
	}, [ templates, value ] );

	const defaultTemplateName = useMemo( () => {
		if ( ! defaultPostTemplateId ) {
			return '';
		}

		const match = templates.find(
			( item ) => item?.id === defaultPostTemplateId
		);

		return match?.name || defaultPostTemplateId;
	}, [ templates, defaultPostTemplateId ] );

	const helpText = useMemo( () => {
		if ( value ) {
			return undefined;
		}

		if ( defaultTemplateName ) {
			return sprintf(
				/* translators: %s: post template name from beehiiv settings */
				__( 'Uses %s from beehiiv settings.', 'beehiiv' ),
				defaultTemplateName
			);
		}

		if ( defaultPostTemplateId ) {
			return __(
				'Uses the template configured in beehiiv settings.',
				'beehiiv'
			);
		}

		return __(
			'No site default is set. Choose a template or configure one in beehiiv settings.',
			'beehiiv'
		);
	}, [ value, defaultTemplateName, defaultPostTemplateId ] );

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
			value={ value }
			options={ options }
			onChange={ onChange }
			help={ helpText }
		/>
	);
}
