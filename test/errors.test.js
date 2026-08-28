'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { PdfMint } = require('../dist/nodes/PdfMint/PdfMint.node.js');
const { createContext, httpFailure, apiErrorBody, ok } = require('./harness.js');

const INVALID_KEY = apiErrorBody(
	'invalid_api_key',
	'This API key is not valid, or it has been revoked.',
	{
		hint: 'Keys are only shown once and cannot be read back, so if you have lost it, create a new one on your dashboard at /dashboard.',
		docs: 'https://pdf.mintapis.com/docs#authentication',
		request_id: 'c99211da08a1b46d',
	},
);

const pdfParams = {
	operation: 'pdf',
	source: 'html',
	html: '<h1>hi</h1>',
	output: 'binary',
	fileName: 'document.pdf',
	options: {},
};

function run(overrides) {
	const { context, calls } = createContext(overrides);
	return { promise: new PdfMint().execute.call(context), calls };
}

test('a 401 on the binary path reaches the operator as the API message, not a byte array', async () => {
	const { promise } = run({
		params: pdfParams,
		http: () => httpFailure(401, INVALID_KEY, { arraybuffer: true }),
	});

	const error = await promise.then(
		() => assert.fail('the node should have thrown'),
		(e) => e,
	);

	const panel = JSON.stringify({
		message: error.message,
		description: error.description,
		context: error.context,
	});

	// What the operator reads first.
	assert.match(error.message, /This API key is not valid, or it has been revoked\./);
	// Everything needed to act on it, and to quote it in a support request.
	assert.match(panel, /create a new one on your dashboard/);
	assert.match(panel, /docs#authentication/);
	assert.match(panel, /c99211da08a1b46d/);
	// The n8n-specific advice the node keeps for this code.
	assert.match(panel, /Open the credential in n8n/);
	// And never the raw buffer.
	assert.doesNotMatch(panel, /"type":"Buffer"/);
	assert.doesNotMatch(panel, /\[123,34/);
});

test('a JSON-path error keeps the API message too', async () => {
	const { promise } = run({
		params: { ...pdfParams, output: 'url' },
		http: () =>
			httpFailure(404, apiErrorBody('template_not_found', 'No template called "invoice" on this account.')),
	});

	const error = await promise.then(
		() => assert.fail('the node should have thrown'),
		(e) => e,
	);
	assert.match(error.message, /No template called "invoice" on this account\./);
	assert.match(String(error.description), /Reopen the Template dropdown/);
});

test('Continue On Fail emits a structured error an IF node can branch on', async () => {
	const { promise } = run({
		params: pdfParams,
		continueOnFail: true,
		http: () => httpFailure(401, INVALID_KEY, { arraybuffer: true }),
	});

	const [items] = await promise;
	assert.equal(items.length, 1);
	const json = items[0].json;

	assert.equal(json.error.code, 'invalid_api_key');
	assert.equal(json.error.message, 'This API key is not valid, or it has been revoked.');
	assert.equal(json.error.request_id, 'c99211da08a1b46d');
	// A human-readable string stays available for anything that just prints it.
	assert.equal(typeof json.errorMessage, 'string');
	assert.match(json.errorMessage, /This API key is not valid/);
	assert.doesNotMatch(JSON.stringify(json), /"type":"Buffer"/);
});

test('Continue using error output marks the item for n8n to route', async () => {
	const { promise } = run({
		params: pdfParams,
		continueOnFail: true,
		onError: 'continueErrorOutput',
		http: () => httpFailure(401, INVALID_KEY, { arraybuffer: true }),
	});

	const [items] = await promise;
	assert.equal(items.length, 1);
	assert.match(items[0].error.message, /This API key is not valid, or it has been revoked\./);
	assert.equal(items[0].json.error.code, 'invalid_api_key');
});

test('a success still returns the file', async () => {
	const { promise } = run({
		params: pdfParams,
		http: () => ok(Buffer.from('%PDF-1.7 test'), { 'x-pdfmint-pages': '2' }),
	});
	const [items] = await promise;
	assert.equal(items[0].json.pages, 2);
	assert.equal(items[0].binary.data.fileName, 'document.pdf');
});
