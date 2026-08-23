'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { PdfMint } = require('../dist/nodes/PdfMint/PdfMint.node.js');
const { buildMargin } = require('../dist/nodes/PdfMint/GenericFunctions.js');
const { pdfOptions } = require('../dist/nodes/PdfMint/descriptions/PdfDescription.js');
const { createContext, ok } = require('./harness.js');

const marginFieldDefault = pdfOptions.options.find((o) => o.name === 'margin').default;

test('setting only one edge leaves the other three at the documented default', () => {
	const margin = buildMargin({ marginTop: '25mm' });
	assert.deepEqual(margin, {
		top: '25mm',
		right: marginFieldDefault,
		bottom: marginFieldDefault,
		left: marginFieldDefault,
	});
});

test('an explicit Margin still sets the edges that were not overridden', () => {
	assert.deepEqual(buildMargin({ margin: '5mm', marginLeft: '30mm' }), {
		top: '5mm',
		right: '5mm',
		bottom: '5mm',
		left: '30mm',
	});
});

test('Margin: 0 is honoured, not treated as unset', () => {
	assert.deepEqual(buildMargin({ margin: '0', marginTop: '20mm' }), {
		top: '20mm',
		right: '0',
		bottom: '0',
		left: '0',
	});
});

test('no margin options at all sends no margin, so the API default applies', () => {
	assert.equal(buildMargin({}), undefined);
});

test('the request body carries the untouched edges', async () => {
	const { context, calls } = createContext({
		params: {
			operation: 'pdf',
			source: 'html',
			html: '<h1>hi</h1>',
			output: 'binary',
			fileName: 'document.pdf',
			options: { marginTop: '25mm' },
		},
		http: () => ok(Buffer.from('%PDF-1.7')),
	});
	await new PdfMint().execute.call(context);
	assert.deepEqual(calls[0].body.options.margin, {
		top: '25mm',
		right: marginFieldDefault,
		bottom: marginFieldDefault,
		left: marginFieldDefault,
	});
});
