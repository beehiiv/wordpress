/**
 * Extends the default `@wordpress/scripts` webpack config so we can keep
 * automatic `block.json` entry detection (for blocks under `src/js/blocks/`)
 * AND register custom entries (editor, admin, frontend).
 */
const path = require( 'path' );
const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );

module.exports = {
	...defaultConfig,
	entry: () => ( {
		...defaultConfig.entry(),
		'post-settings': path.resolve(
			process.cwd(),
			'src/js/editor/post-settings',
			'index.js'
		),
		admin: path.resolve( process.cwd(), 'src/js/admin', 'index.js' ),
		'admin-settings': path.resolve(
			process.cwd(),
			'src/js/admin/settings',
			'index.js'
		),
		frontend: path.resolve( process.cwd(), 'src/js/frontend', 'index.js' ),
	} ),
};
