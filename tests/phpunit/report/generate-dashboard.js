#!/usr/bin/env node
/**
 * Reads a PHPUnit JUnit XML report and writes a self-contained HTML
 * dashboard: overall pass/fail/error/skipped counts, a per-class breakdown,
 * failure/error details, and a full test table.
 *
 * Used standalone after `composer test` (default paths, from the
 * <logging> block in phpunit.xml.dist) and by scripts/test-compat.js to
 * produce one dashboard per PHP/WP combination via --junit/--out/--label.
 *
 * Usage:
 *   node tests/phpunit/report/generate-dashboard.js
 *   node tests/phpunit/report/generate-dashboard.js --junit=<path> --out=<path> --label="PHP 8.1 / WP 6.8"
 */

const fs = require( 'fs' );
const path = require( 'path' );

const PLUGIN_ROOT = path.join( __dirname, '..', '..', '..' );

function parseArgs( argv ) {
	const args = {};
	for ( const arg of argv ) {
		const match = arg.match( /^--([a-z-]+)(?:=(.*))?$/ );
		if ( match ) {
			args[ match[ 1 ] ] = match[ 2 ] ?? true;
		}
	}
	return args;
}

const args = parseArgs( process.argv.slice( 2 ) );
const JUNIT_PATH = path.resolve( PLUGIN_ROOT, args.junit || 'tests/phpunit/test-results/junit.xml' );
const OUTPUT_PATH = path.resolve( PLUGIN_ROOT, args.out || 'tests/phpunit/test-results/dashboard.html' );
const LABEL = args.label || 'PHPUnit';

function readJunit() {
	if ( ! fs.existsSync( JUNIT_PATH ) ) {
		console.error(
			`No JUnit report at ${ JUNIT_PATH }. Run PHPUnit with --log-junit first (see phpunit.xml.dist).`
		);
		process.exit( 1 );
	}
	return fs.readFileSync( JUNIT_PATH, 'utf8' );
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function xmlUnescape( str ) {
	return str.replace(
		/&(amp|lt|gt|quot|apos|#\d+);/g,
		( _, entity ) =>
			entity[ 0 ] === '#'
				? String.fromCharCode( Number( entity.slice( 1 ) ) )
				: XML_ENTITIES[ entity ]
	);
}

function esc( str ) {
	return String( str ).replace(
		/[&<>"']/g,
		( ch ) =>
			( {
				'&': '&amp;',
				'<': '&lt;',
				'>': '&gt;',
				'"': '&quot;',
				"'": '&#39;',
			} )[ ch ]
	);
}

function parseAttrs( attrString ) {
	const attrs = {};
	const re = /([\w-]+)="([^"]*)"/g;
	let m;
	while ( ( m = re.exec( attrString ) ) ) {
		attrs[ m[ 1 ] ] = xmlUnescape( m[ 2 ] );
	}
	return attrs;
}

// PHPUnit's JUnit writer self-closes passing <testcase/> elements and only
// gives failing/errored/skipped ones a body, so both shapes must match.
const TESTCASE_RE = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
const OUTCOME_RE = /<(failure|error|skipped|warning)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/;

function parseTestcase( match ) {
	const attrs = parseAttrs( match[ 1 ] );
	const body = match[ 2 ] || '';
	const outcomeMatch = OUTCOME_RE.exec( body );

	let status = 'passed';
	let type = null;
	let message = null;

	if ( outcomeMatch ) {
		const [ , tag, outcomeAttrString, outcomeBody ] = outcomeMatch;
		status = tag;
		type = parseAttrs( outcomeAttrString ).type || null;
		message = outcomeBody ? xmlUnescape( outcomeBody.trim() ) : null;
	}

	return {
		name: attrs.name || '(unnamed)',
		class: attrs.class || attrs.classname || '(no class)',
		file: attrs.file || '',
		line: attrs.line || '',
		time: parseFloat( attrs.time || '0' ),
		status,
		type,
		message,
	};
}

function collectCases( xml ) {
	const cases = [];
	let match;
	TESTCASE_RE.lastIndex = 0;
	while ( ( match = TESTCASE_RE.exec( xml ) ) ) {
		cases.push( parseTestcase( match ) );
	}
	return cases;
}

// Prefer the outer <testsuite>'s reported time (matches PHPUnit's own CLI
// summary) over summing individual testcase times, which misses setup time.
function parseTotalTime( xml, cases ) {
	const match = xml.match( /<testsuite\b[^>]*\stime="([^"]*)"/ );
	if ( match ) {
		return parseFloat( match[ 1 ] );
	}
	return cases.reduce( ( sum, c ) => sum + c.time, 0 );
}

function byClass( cases ) {
	const classes = new Map();
	for ( const c of cases ) {
		if ( ! classes.has( c.class ) ) {
			classes.set( c.class, [] );
		}
		classes.get( c.class ).push( c );
	}
	return classes;
}

function fmtDuration( seconds ) {
	if ( seconds < 1 ) return `${ Math.round( seconds * 1000 ) }ms`;
	return `${ seconds.toFixed( 2 ) }s`;
}

const STATUS_LABEL = {
	passed: 'Passed',
	failure: 'Failed',
	error: 'Error',
	skipped: 'Skipped',
	warning: 'Warning',
};

function renderSummary( cases, totalTime ) {
	const counts = { passed: 0, failure: 0, error: 0, skipped: 0, warning: 0 };
	for ( const c of cases ) {
		counts[ c.status ] = ( counts[ c.status ] || 0 ) + 1;
	}

	const tiles = [
		[ 'Total', cases.length, '' ],
		[ 'Passed', counts.passed, 'status-passed' ],
		[ 'Failed', counts.failure, 'status-failure' ],
		[ 'Errors', counts.error, 'status-error' ],
		[ 'Skipped', counts.skipped, 'status-skipped' ],
		[ 'Duration', fmtDuration( totalTime ), '' ],
	];

	return `<div class="summary">${ tiles
		.map(
			( [ label, count, cls ] ) =>
				`<div class="tile ${ cls }"><div class="tile-count">${ count }</div><div class="tile-label">${ label }</div></div>`
		)
		.join( '' ) }</div>`;
}

function renderClassTable( classes ) {
	const rows = [ ...classes.entries() ].sort( ( a, b ) => a[ 0 ].localeCompare( b[ 0 ] ) );
	return `<table class="class-table">
		<thead><tr><th>Class</th><th>Tests</th><th>Passed</th><th>Failed</th><th>Errors</th><th>Skipped</th><th>Time</th></tr></thead>
		<tbody>${ rows
			.map( ( [ className, tests ] ) => {
				const counts = { passed: 0, failure: 0, error: 0, skipped: 0 };
				let time = 0;
				for ( const t of tests ) {
					counts[ t.status ] = ( counts[ t.status ] || 0 ) + 1;
					time += t.time;
				}
				const rowClass = counts.failure || counts.error ? 'row-failing' : '';
				return `<tr class="${ rowClass }">
					<td>${ esc( className ) }</td>
					<td>${ tests.length }</td>
					<td>${ counts.passed }</td>
					<td>${ counts.failure }</td>
					<td>${ counts.error }</td>
					<td>${ counts.skipped }</td>
					<td>${ fmtDuration( time ) }</td>
				</tr>`;
			} )
			.join( '' ) }</tbody>
	</table>`;
}

function renderFailures( cases ) {
	const failing = cases.filter( ( c ) => c.status === 'failure' || c.status === 'error' );
	if ( ! failing.length ) {
		return '<p class="none">No failures or errors.</p>';
	}
	return failing
		.map(
			( c ) => `<div class="failure">
				<div class="failure-title"><span class="badge status-${ c.status }">${ STATUS_LABEL[ c.status ] }</span> ${ esc(
				c.class
			) }::${ esc( c.name ) }</div>
				${ c.file ? `<div class="failure-location">${ esc( c.file ) }${ c.line ? `:${ esc( c.line ) }` : '' }</div>` : '' }
				${ c.type ? `<div class="failure-type">${ esc( c.type ) }</div>` : '' }
				${ c.message ? `<pre class="failure-message">${ esc( c.message ) }</pre>` : '' }
			</div>`
		)
		.join( '' );
}

function renderAllTests( cases ) {
	const sorted = [ ...cases ].sort(
		( a, b ) => a.class.localeCompare( b.class ) || a.name.localeCompare( b.name )
	);
	return `<table class="all-tests-table">
		<thead><tr><th>Status</th><th>Class</th><th>Test</th><th>Time</th></tr></thead>
		<tbody>${ sorted
			.map(
				( c ) => `<tr>
					<td><span class="badge status-${ c.status }">${ STATUS_LABEL[ c.status ] }</span></td>
					<td>${ esc( c.class ) }</td>
					<td>${ esc( c.name ) }</td>
					<td>${ fmtDuration( c.time ) }</td>
				</tr>`
			)
			.join( '' ) }</tbody>
	</table>`;
}

function renderHtml( cases, totalTime ) {
	const generatedAt = new Date().toLocaleString();
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${ esc( LABEL ) } — PHPUnit dashboard</title>
<style>
	:root {
		--bg: #f7f7f8; --card-bg: #fff; --text: #1a1a1a; --muted: #6b7280; --border: #e5e7eb;
		--passed: #16a34a; --failed: #dc2626; --error: #b91c1c; --skipped: #d97706; --warning: #d97706;
	}
	@media (prefers-color-scheme: dark) {
		:root { --bg: #16171a; --card-bg: #1f2023; --text: #e5e7eb; --muted: #9ca3af; --border: #30323a; }
	}
	* { box-sizing: border-box; }
	body { margin: 0; padding: 2rem; background: var(--bg); color: var(--text); font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
	h1 { font-size: 1.4rem; margin: 0 0 0.25rem; }
	.meta { color: var(--muted); margin-bottom: 1.5rem; }
	h2 { font-size: 1.05rem; margin: 2rem 0 0.75rem; }
	.summary { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 1rem; }
	.tile { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 0.75rem 1.25rem; min-width: 90px; }
	.tile-count { font-size: 1.5rem; font-weight: 600; }
	.tile-label { color: var(--muted); font-size: 0.8rem; }
	.tile.status-passed .tile-count { color: var(--passed); }
	.tile.status-failure .tile-count { color: var(--failed); }
	.tile.status-error .tile-count { color: var(--error); }
	.tile.status-skipped .tile-count { color: var(--skipped); }
	table { width: 100%; border-collapse: collapse; background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
	th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); font-size: 0.85rem; }
	th { color: var(--muted); font-weight: 600; }
	tr:last-child td { border-bottom: none; }
	tr.row-failing { background: color-mix(in srgb, var(--failed) 8%, transparent); }
	.badge { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600; color: #fff; }
	.badge.status-passed { background: var(--passed); }
	.badge.status-failure { background: var(--failed); }
	.badge.status-error { background: var(--error); }
	.badge.status-skipped { background: var(--skipped); color: #1a1a1a; }
	.badge.status-warning { background: var(--warning); color: #1a1a1a; }
	.failure { background: var(--card-bg); border: 1px solid var(--border); border-left: 3px solid var(--failed); border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 0.75rem; }
	.failure-title { font-weight: 600; margin-bottom: 0.25rem; }
	.failure-location { color: var(--muted); font-size: 0.8rem; }
	.failure-type { color: var(--muted); font-size: 0.8rem; margin-top: 0.25rem; }
	.failure-message { white-space: pre-wrap; margin-top: 0.5rem; font-size: 0.8rem; overflow-x: auto; }
	.none { color: var(--muted); }
</style>
</head>
<body>
	<h1>${ esc( LABEL ) }</h1>
	<div class="meta">Generated ${ esc( generatedAt ) } · ${ esc( path.relative( PLUGIN_ROOT, JUNIT_PATH ) ) }</div>

	${ renderSummary( cases, totalTime ) }

	<h2>Failures &amp; errors</h2>
	${ renderFailures( cases ) }

	<h2>By test class</h2>
	${ renderClassTable( byClass( cases ) ) }

	<h2>All tests</h2>
	${ renderAllTests( cases ) }
</body>
</html>`;
}

const xml = readJunit();
const cases = collectCases( xml );
const totalTime = parseTotalTime( xml, cases );

fs.mkdirSync( path.dirname( OUTPUT_PATH ), { recursive: true } );
fs.writeFileSync( OUTPUT_PATH, renderHtml( cases, totalTime ) );

const failing = cases.filter( ( c ) => c.status === 'failure' || c.status === 'error' ).length;
console.log(
	`Wrote ${ path.relative( PLUGIN_ROOT, OUTPUT_PATH ) } — ${ cases.length } tests, ${ failing } failing.`
);
