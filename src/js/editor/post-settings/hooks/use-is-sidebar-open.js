/**
 * Whether the beehiiv sidebar panel is the open editor sidebar.
 */
import { useSelect } from '@wordpress/data';

import { SIDEBAR_AREA } from '../constants';

/**
 * @return {boolean} True while the beehiiv sidebar is open.
 */
export function useIsBeehiivSidebarOpen() {
	return useSelect(
		( select ) =>
			SIDEBAR_AREA ===
			select( 'core/interface' )?.getActiveComplementaryArea( 'core' ),
		[]
	);
}
