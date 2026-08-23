'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { PdfMint } = require('../dist/nodes/PdfMint/PdfMint.node.js');
const { createContext, httpFailure, apiErrorBody, ok } = require('./harness.js');

const pdfItem = (name) => ({
	json: {},
	binary: { data: { data: Buffer.from(`%PDF-1.7 ${name}`).toString('base64'), fileName: `${name}.pdf` } },
});

const mergeParams = {
	operation: 'merge',
	mergeSource: 'items',
	mergeBinaryProperty: 'data',
	output: 'binary',
	fileName: 'merged.pdf',
	mergeOptions: {},
};

test('merge honours Continue On Fail when an item has no binary field', async () => {
	const { context } = createContext({
		params: mergeParams,
		items: [pdfItem('a'), { json: { note: 'no binary here' } }],
		continueOnFail: true,
		http: () => ok(Buffer.from('%PDF-1.7 merged')),
	});

	const [items] = await new PdfMint().execute.call(context);
	assert.equal(items.length, 1);
	assert.match(String(items[0].json.errorMessage), /no binary field called "data"/);
});

test('merge honours Continue On Fail when the API rejects the request', async () => {
	const { context } = createContext({
		params: { ...mergeParams, mergeSource: 'urls', mergeUrls: 'https://x.test/a.pdf\nhttps://x.test/b.pdf' },
		items: [{ json: {} }],
		continueOnFail: true,
		http: () =>
			httpFailure(400, apiErrorBody('url_http_error', 'https://x.test/a.pdf answered 404.'), {
				arraybuffer: true,
			}),
	});

	const [items] = await new PdfMint().execute.call(context);
	assert.equal(items.length, 1);
	assert.equal(items[0].json.error.code, 'url_http_error');
	assert.match(String(items[0].json.errorMessage), /answered 404/);
});

test('merge still throws when Continue On Fail is off', async () => {
	const { context } = createContext({
		params: mergeParams,
		items: [pdfItem('a'), { json: {} }],
		http: () => ok(Buffer.from('%PDF-1.7 merged')),
	});
	await assert.rejects(new PdfMint().execute.call(context), /no binary field called "data"/);
});

test('merge still merges', async () => {
	const { context, calls } = createContext({
		params: mergeParams,
		items: [pdfItem('a'), pdfItem('b')],
		http: () => ok(Buffer.from('%PDF-1.7 merged')),
	});
	const [items] = await new PdfMint().execute.call(context);
	assert.equal(calls[0].body.files.length, 2);
	assert.deepEqual(items[0].pairedItem, [{ item: 0 }, { item: 1 }]);
});

test('Get Usage calls the API once no matter how many items arrive', async () => {
	const { context, calls } = createContext({
		params: { operation: 'usage' },
		items: [{ json: { a: 1 } }, { json: { a: 2 } }, { json: { a: 3 } }],
		http: () => ok({ plan: 'free', remaining: 297 }),
	});

	const [items] = await new PdfMint().execute.call(context);
	assert.equal(calls.length, 1, 'one /v1/me call for the whole node run');
	assert.equal(items.length, 1, 'one output item, not one per input item');
	assert.deepEqual(items[0].pairedItem, [{ item: 0 }, { item: 1 }, { item: 2 }]);
	assert.equal(items[0].json.remaining, 297);
});

test('Get Usage with Continue On Fail emits one structured error item', async () => {
	const { context, calls } = createContext({
		params: { operation: 'usage' },
		items: [{ json: {} }, { json: {} }],
		continueOnFail: true,
		http: () => httpFailure(401, apiErrorBody('invalid_api_key', 'This API key is not valid, or it has been revoked.')),
	});
	const [items] = await new PdfMint().execute.call(context);
	assert.equal(calls.length, 1);
	assert.equal(items.length, 1);
	assert.equal(items[0].json.error.code, 'invalid_api_key');
});
