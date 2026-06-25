import { useEffect, useMemo, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { InspectorControls, useBlockProps } from '@wordpress/block-editor';
import {
	PanelBody,
	Placeholder,
	SelectControl,
	Spinner,
} from '@wordpress/components';
import { useSelect } from '@wordpress/data';
import apiFetch from '@wordpress/api-fetch';
import { megaphone } from '@wordpress/icons';

export default function Edit( { attributes, setAttributes } ) {
	const { adId, adLabel } = attributes;

	const postId = useSelect(
		( select ) => select( 'core/editor' )?.getCurrentPostId(),
		[]
	);

	const [ ads, setAds ] = useState( [] );
	const [ isLoading, setIsLoading ] = useState( false );

	useEffect( () => {
		if ( ! postId ) {
			return undefined;
		}

		let cancelled = false;
		setIsLoading( true );

		apiFetch( {
			path: `/beehiiv/v1/advertisement-opportunities?post_id=${ encodeURIComponent(
				postId
			) }`,
		} )
			.then( ( items ) => {
				if ( ! cancelled ) {
					setAds( Array.isArray( items ) ? items : [] );
				}
			} )
			.catch( () => {
				if ( ! cancelled ) {
					setAds( [] );
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
	}, [ postId ] );

	const options = useMemo( () => {
		const opts = [
			{ value: '', label: __( 'Select an advertisement…', 'beehiiv' ) },
			...ads
				.filter( ( item ) => item?.id )
				.map( ( item ) => ( {
					value: item.id,
					label: item.label || item.id,
				} ) ),
		];

		// Keep the saved selection visible even if it isn't in the current list.
		if ( adId && ! opts.some( ( option ) => option.value === adId ) ) {
			opts.push( { value: adId, label: adLabel || adId } );
		}

		return opts;
	}, [ ads, adId, adLabel ] );

	const onSelectAd = ( value ) => {
		const selected = ads.find( ( item ) => item.id === value );

		setAttributes( {
			adId: value,
			adLabel: selected ? selected.label || selected.id : '',
		} );
	};

	const blockProps = useBlockProps();

	const instructions = adId
		? adLabel || adId
		: __(
				'Choose an advertisement in the block settings sidebar. Nothing is shown on the website.',
				'beehiiv'
		  );

	return (
		<>
			<InspectorControls>
				<PanelBody
					title={ __( 'Advertisement', 'beehiiv' ) }
					initialOpen={ true }
				>
					{ isLoading && options.length <= 1 ? (
						<Spinner />
					) : (
						<SelectControl
							label={ __( 'Advertisement', 'beehiiv' ) }
							value={ adId }
							options={ options }
							onChange={ onSelectAd }
							help={ __(
								'Only ads not already used in another post are listed.',
								'beehiiv'
							) }
							__nextHasNoMarginBottom
						/>
					) }
				</PanelBody>
			</InspectorControls>

			<div { ...blockProps }>
				<Placeholder
					icon={ megaphone }
					label={ __( 'beehiiv Advertisement', 'beehiiv' ) }
					instructions={ instructions }
				/>
			</div>
		</>
	);
}
