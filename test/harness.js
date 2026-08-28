'use strict';

/**
 * A stand-in for n8n's IExecuteFunctions that behaves like the real one in the
 * ways this node depends on: parameters come back per item, the HTTP helper
 * throws exactly what n8n-core throws (a NodeApiError wrapping an axios error),
 * and binary data round-trips through a buffer.
 *
 * The error shape is copied from n8n-core:
 *   packages/core/.../request-helpers/authentication.js
 *     catch (error) { throw new NodeApiError(this.getNode(), error); }
 * where `error` is the axios error whose response.data is a Buffer whenever the
 * request asked for `encoding: 'arraybuffer'`.
 */
const { NodeApiError } = require('n8n-workflow');

const testNode = {
	id: 'af1b2c3d',
	name: 'PDFMint',
	type: 'n8n-nodes-pdfmint.pdfMint',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

/** n8n reads `constructor.name === 'AxiosError'` to find the status code. */
class AxiosError extends Error {}

/** The axios error n8n's HTTP client rejects with for a non-2xx response. */
function axiosError(statusCode, body, { arraybuffer = false } = {}) {
	const error = new AxiosError(`Request failed with status code ${statusCode}`);
	error.name = 'AxiosError';
	error.isAxiosError = true;
	error.code = statusCode >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST';
	error.config = { url: 'https://pdfmint.test/v1/pdf', method: 'post' };
	error.response = {
		status: statusCode,
		statusText: '',
		headers: { 'content-type': 'application/json; charset=utf-8' },
		data: arraybuffer ? Buffer.from(JSON.stringify(body), 'utf8') : body,
		config: error.config,
	};
	return error;
}

/** What `helpers.httpRequestWithAuthentication` throws when the API says no. */
function httpFailure(statusCode, body, options) {
	return new NodeApiError(testNode, axiosError(statusCode, body, options));
}

/** The API's own error envelope. */
function apiErrorBody(code, message, extra = {}) {
	return {
		error: {
			code,
			message,
			hint: extra.hint ?? 'A hint the operator can act on.',
			docs: extra.docs ?? 'https://pdfmint.test/docs#errors',
			request_id: extra.request_id ?? 'c99211da08a1b46d',
		},
	};
}

function createContext({ params = {}, items = [{ json: {} }], continueOnFail = false, onError, http }) {
	const calls = [];
	const node = onError ? { ...testNode, onError } : testNode;
	const context = {
		getNode: () => node,
		getInputData: () => items,
		continueOnFail: () => continueOnFail,
		getCredentials: async () => ({ apiKey: 'pm_live_test', baseUrl: 'https://pdfmint.test' }),
		getNodeParameter(name, itemIndex, fallback) {
			if (!(name in params)) {
				if (fallback !== undefined) return fallback;
				throw new Error(`test asked for an unset parameter: ${name}`);
			}
			const value = params[name];
			return typeof value === 'function' ? value(itemIndex) : value;
		},
		helpers: {
			async httpRequestWithAuthentication(_credentialsType, options) {
				calls.push(options);
				const result = await http(options, calls.length - 1);
				if (result instanceof Error) throw result;
				return result;
			},
			async prepareBinaryData(buffer, fileName, mimeType) {
				return { data: Buffer.from(buffer).toString('base64'), fileName, mimeType };
			},
			async getBinaryDataBuffer(itemIndex, property) {
				return Buffer.from(items[itemIndex].binary[property].data, 'base64');
			},
		},
	};
	return { context, calls };
}

/** A success response from the API, matching `returnFullResponse: true`. */
function ok(body, headers = {}) {
	return { body, headers, statusCode: 200 };
}

module.exports = { createContext, httpFailure, axiosError, apiErrorBody, ok, testNode };
