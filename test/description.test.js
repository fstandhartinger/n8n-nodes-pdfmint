'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { PdfMint } = require('../dist/nodes/PdfMint/PdfMint.node.js');
const codex = require('../dist/nodes/PdfMint/PdfMint.node.json');
const { createContext, ok } = require('./harness.js');

const description = new PdfMint().description;

/** The values n8n would send for a node just dragged onto the canvas. */
function dragInDefaults(operation, extra = {}) {
	const params = {};
	for (const property of description.properties) {
		const show = property.displayOptions?.show;
		if (show?.operation && !show.operation.includes(operation)) continue;
		params[property.name] = property.default;
	}
	return { ...params, operation, ...extra };
}

test('a node dragged in and executed with no edits renders something', async () => {
	const params = dragInDefaults('pdf');
	assert.notEqual(params.html, '', 'HTML is required, so its default cannot be empty');
	assert.match(params.html, /<html/i);
	assert.match(params.html, /<\/html>/i);

	const { context, calls } = createContext({ params, http: () => ok(Buffer.from('%PDF-1.7')) });
	const [items] = await new PdfMint().execute.call(context);
	assert.equal(calls[0].body.html, params.html);
	assert.ok(items[0].binary.data);
});

test('the codex file lists aliases so the node is findable in the search box', () => {
	assert.ok(Array.isArray(codex.alias), 'PdfMint.node.json needs an alias array');
	assert.ok(codex.alias.length >= 8, `only ${codex.alias.length} aliases`);
	for (const expected of ['PDF', 'HTML to PDF', 'Markdown to PDF', 'URL to PDF', 'Merge PDF', 'Invoice']) {
		assert.ok(codex.alias.includes(expected), `missing alias: ${expected}`);
	}
	// Nothing the node cannot actually do.
	for (const alias of codex.alias) {
		assert.doesNotMatch(alias, /OCR|Split|Password|Sign|Extract|Fill/i, `dishonest alias: ${alias}`);
	}
});

test('Generate an Image has File Name at the top level, like Generate PDF', () => {
	const imageFileNames = description.properties.filter(
		(p) => p.name === 'fileName' && p.displayOptions?.show?.operation?.includes('image'),
	);
	assert.ok(imageFileNames.length > 0, 'File Name is still buried in Options for images');

	const imageOptions = description.properties.find((p) => p.name === 'imageOptions');
	assert.equal(
		imageOptions.options.find((o) => o.name === 'fileName'),
		undefined,
		'File Name should not also sit inside Options',
	);

	// The default extension has to follow the chosen format.
	const defaults = imageFileNames.map((p) => p.default);
	assert.ok(defaults.includes('image.png'), `no png default among ${JSON.stringify(defaults)}`);
	assert.ok(defaults.includes('image.jpeg'), `no jpeg default among ${JSON.stringify(defaults)}`);
});

test('an image dragged in with JPEG selected is called .jpeg', async () => {
	const jpegField = description.properties.find(
		(p) =>
			p.name === 'fileName' &&
			p.displayOptions?.show?.operation?.includes('image') &&
			p.default.endsWith('.jpeg'),
	);
	const formatParameter = Object.keys(jpegField.displayOptions.show).find((k) => k !== 'operation');
	assert.ok(formatParameter, 'the JPEG file name has to be keyed on the format field');

	const params = dragInDefaults('image', {
		[formatParameter]: 'jpeg',
		fileName: jpegField.default,
	});
	const { context, calls } = createContext({ params, http: () => ok(Buffer.from('\xff\xd8\xff')) });
	const [items] = await new PdfMint().execute.call(context);
	assert.equal(calls[0].body.type, 'jpeg');
	assert.equal(calls[0].body.filename, 'image.jpeg');
	assert.equal(items[0].binary.data.fileName, 'image.jpeg');
	assert.equal(items[0].binary.data.mimeType, 'image/jpeg');
});
