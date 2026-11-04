#!/usr/bin/env node
/**
 * record-intake-demo helper. No dependencies.
 *
 *   node tests/e2e/demo/check.js check  <intake.md> <demo-script>
 *   node tests/e2e/demo/check.js finish <intake.md> <demo-script> <out-dir>
 *
 * The demo script declares the ACs it shows on its first line:
 *   // @demo-acs AC-001 AC-007 ...
 * `check` proves the demo is about this intake: every declared AC must exist
 * in the intake's routed PRDs, and the plugin checkout's commit must be one
 * the intake recorded. ACs the demo does not show are reported, not failed.
 * `finish` runs after Playwright: it copies the single recorded video to
 * <out-dir>/walkthrough.webm and writes manifest.json and manifest.md.
 */
const fs = require( 'fs' );
const path = require( 'path' );
const { execSync } = require( 'child_process' );

const [ , , cmd, intakePath, demoScriptArg, outDir ] = process.argv;
const pluginDir = path.resolve( __dirname, '../../..' );
const demoScript = path.resolve( __dirname, demoScriptArg );
const relayRoot = path.resolve( intakePath, '../../../..' );

const read = ( p ) => fs.readFileSync( p, 'utf8' );
const uniq = ( a ) => [ ...new Set( a ) ].sort();

function routedTargets( intake ) {
	const block = intake.match(
		/<!-- route-intake:targets -->([\s\S]*?)<!-- \/route-intake:targets -->/
	);
	if ( ! block ) {
		throw new Error( 'No route-intake:targets block in the intake.' );
	}
	return [ ...block[ 1 ].matchAll( /^\s*-\s*path:\s*(\S+)/gm ) ].map(
		( m ) => m[ 1 ]
	);
}

function findPrd( target ) {
	const slug = target.split( '/' ).pop();
	const hits = execSync(
		`find "${ path.join(
			relayRoot,
			'requirements'
		) }" -name "${ slug }.prd.md"`
	)
		.toString()
		.trim()
		.split( '\n' )
		.filter( Boolean );
	if ( hits.length !== 1 ) {
		throw new Error(
			`Expected one PRD for ${ target }, found ${ hits.length }.`
		);
	}
	return hits[ 0 ];
}

function prdAcs( file ) {
	return uniq(
		[ ...read( file ).matchAll( /^- \[[ x]\] (AC-\d+):/gm ) ].map(
			( m ) => m[ 1 ]
		)
	);
}

function demoAcs( file ) {
	const line = read( file ).match( /^\/\/ @demo-acs (.+)$/m );
	if ( ! line ) {
		throw new Error(
			'The demo script has no "// @demo-acs AC-001 ..." line.'
		);
	}
	return uniq( line[ 1 ].match( /AC-\d+/g ) || [] );
}

function recordedShas( intake ) {
	return uniq(
		[ ...intake.matchAll( /\b[0-9a-f]{7}\b/g ) ].map( ( m ) => m[ 0 ] )
	);
}

const intake = read( intakePath );
const targets = routedTargets( intake );
const prds = targets.map( ( t ) => ( { target: t, file: findPrd( t ) } ) );
const wanted = uniq( prds.flatMap( ( p ) => prdAcs( p.file ) ) );
const shown = demoAcs( demoScript );

function summary() {
	const head = execSync( 'git rev-parse HEAD', { cwd: pluginDir } )
		.toString()
		.trim();
	const branch = execSync( 'git rev-parse --abbrev-ref HEAD', {
		cwd: pluginDir,
	} )
		.toString()
		.trim();
	const result = {
		intake: path.basename( intakePath ),
		targets,
		head,
		branch,
		build_matches_intake: recordedShas( intake ).some( ( s ) =>
			head.startsWith( s )
		),
		acs_shown: shown,
		acs_not_shown: wanted.filter( ( a ) => ! shown.includes( a ) ),
		acs_not_in_intake: shown.filter( ( a ) => ! wanted.includes( a ) ),
	};
	result.ok =
		result.build_matches_intake && ! result.acs_not_in_intake.length;
	return result;
}

function check() {
	const result = summary();
	process.stdout.write( JSON.stringify( result, null, 2 ) + '\n' );
	process.exit( result.ok ? 0 : 1 );
}

function finish() {
	const result = summary();
	const results = JSON.parse( read( path.join( outDir, 'results.json' ) ) );
	const spec = results.suites[ 0 ].specs[ 0 ];
	const run = spec.tests[ 0 ].results.slice( -1 )[ 0 ];
	const vid = ( run.attachments || [] ).find( ( a ) => a.name === 'video' );
	if ( ! vid || ! fs.existsSync( vid.path ) ) {
		throw new Error( 'Playwright recorded no video.' );
	}
	fs.copyFileSync( vid.path, path.join( outDir, 'walkthrough.webm' ) );
	const out = {
		...result,
		commit: result.head.slice( 0, 7 ),
		test_status: run.status,
		seconds: Math.round( run.duration / 1000 ),
		video: 'walkthrough.webm',
	};
	fs.writeFileSync(
		path.join( outDir, 'manifest.json' ),
		JSON.stringify( out, null, 2 )
	);
	const md = [
		`# Demo walkthrough: ${ out.intake } @ ${ out.commit }`,
		'',
		`Video: ${ out.video } (${ out.seconds }s, test ${ out.test_status })`,
		`Criteria shown: ${ out.acs_shown.join( ', ' ) }`,
		`Criteria in the PRDs but not shown: ${
			out.acs_not_shown.join( ', ' ) || 'none'
		}`,
		`Shown but not in the routed PRDs: ${
			out.acs_not_in_intake.join( ', ' ) || 'none'
		}`,
	].join( '\n' );
	fs.writeFileSync( path.join( outDir, 'manifest.md' ), md + '\n' );
	process.stdout.write( md + '\n' );
}

(
	( { check, finish } )[ cmd ] ||
	( () => {
		throw new Error( 'Use check or finish.' );
	} )
)();
