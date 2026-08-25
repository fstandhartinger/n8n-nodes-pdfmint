import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { DEFAULT_MARGIN } from './constants';

const DEFAULT_BASE_URL = 'https://pdf.mintapis.com';

export interface PdfMintResponse {
	body: Buffer | IDataObject;
	headers: Record<string, string>;
	statusCode: number;
}

async function baseUrl(context: IExecuteFunctions | ILoadOptionsFunctions): Promise<string> {
	const credentials = await context.getCredentials('pdfMintApi');
	const raw = (credentials?.baseUrl as string) || DEFAULT_BASE_URL;
	return raw.replace(/\/+$/, '');
}

/**
 * The API's hints are deliberately client-neutral, because curl users read them
 * too. These add the n8n-shaped half — what to click, which field to change —
 * for the failures an n8n operator actually hits.
 */
const N8N_ADVICE: Record<string, string> = {
	missing_api_key: 'In n8n, open the node and pick a PDFMint credential in the Credential dropdown.',
	invalid_api_key: 'Open the credential in n8n and paste the key from your PDFMint dashboard again.',
	quota_exceeded: 'Add a Wait or an IF node if you need to spread the work, or upgrade the plan.',
	missing_content: 'Set the Source field and put your content in the field below it.',
	ambiguous_content: 'Set Source to the one you meant; the node only sends that field.',
	invalid_data: 'Use an expression that yields an object, for example {{ $json }}.',
	unresolved_placeholders: 'Check the field names in Data against the {{placeholders}} in your template, or turn Strict Placeholders off.',
	template_not_found: 'Reopen the Template dropdown to reload the list from your account.',
	url_unreachable: 'If the page needs a login, fetch it with an HTTP Request node first and pass the HTML into this node instead.',
	url_http_error: 'If the page needs a login, fetch it with an HTTP Request node first and pass the HTML into this node instead.',
	private_address_blocked: 'A URL on your own network is not reachable from PDFMint. Fetch it with an HTTP Request node and pass the HTML in.',
	render_timeout: 'Raise Options > Timeout, or set Options > Wait For to a fixed number of milliseconds.',
	wait_for_timeout: 'Check Options > Wait For — the selector never appeared.',
	renderer_busy: 'Turn on Settings > Retry On Fail so this item retries by itself.',
	rate_limited: 'Turn on Settings > Retry On Fail, or add a Loop Over Items node with a batch interval to slow the workflow down.',
	request_too_large: 'Inline base64 images are the usual cause. Host them and reference them by URL.',
	html_too_large: 'Inline base64 images are the usual cause. Host them and reference them by URL.',
	invalid_json: 'Switch the field to Expression mode and pass an object rather than building a JSON string by hand.',
};

/**
 * The HTTP helper hands the node a NodeApiError whose payload is whatever the
 * server sent — and for a binary request that payload is a Buffer, which the
 * error panel renders as a few hundred decimal bytes. These pull the real
 * envelope back out, whatever wrapper it arrived in.
 */
function bufferFrom(value: unknown): Buffer | undefined {
	if (Buffer.isBuffer(value)) return value;
	if (value instanceof Uint8Array) return Buffer.from(value);
	if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
	// A Buffer that has been through JSON, as it is once n8n saves an execution.
	const serialised = value as { type?: string; data?: unknown };
	if (serialised?.type === 'Buffer' && Array.isArray(serialised.data)) {
		return Buffer.from(serialised.data as number[]);
	}
	return undefined;
}

interface DecodedBody {
	json?: IDataObject;
	text?: string;
}

function decodeBody(value: unknown): DecodedBody | undefined {
	if (value === undefined || value === null || value === '') return undefined;

	const buffer = bufferFrom(value);
	const text = buffer ? buffer.toString('utf8') : typeof value === 'string' ? value : undefined;

	if (text !== undefined) {
		try {
			const parsed = JSON.parse(text) as unknown;
			if (parsed && typeof parsed === 'object') return { json: parsed as IDataObject, text };
		} catch {
			// Not JSON — a proxy's HTML page, say. The text is still readable.
		}
		return { text };
	}
	if (typeof value === 'object') return { json: value as IDataObject };
	return undefined;
}

/** Every place an error body can hide, from the outermost wrapper inwards. */
function errorBody(error: unknown): DecodedBody | undefined {
	const err = (error ?? {}) as JsonObject & {
		cause?: JsonObject & { response?: JsonObject };
		context?: JsonObject;
		errorResponse?: JsonObject;
	};
	const response = (err.response ?? {}) as JsonObject;
	const causeResponse = (err.cause?.response ?? {}) as JsonObject;
	const candidates = [
		response.body,
		response.data,
		err.body,
		causeResponse.body,
		causeResponse.data,
		err.context?.data,
		err.errorResponse,
	];

	let fallback: DecodedBody | undefined;
	for (const candidate of candidates) {
		const decoded = decodeBody(candidate);
		if (decoded?.json?.error) return decoded;
		if (decoded && !fallback) fallback = decoded;
	}
	return fallback;
}

/** The status code, wherever the wrapper happened to keep it. */
function statusCodeOf(error: unknown): string {
	const err = (error ?? {}) as JsonObject & {
		httpCode?: string;
		cause?: JsonObject & { response?: JsonObject };
	};
	const response = (err.response ?? {}) as JsonObject;
	const causeResponse = (err.cause?.response ?? {}) as JsonObject;
	const code =
		err.httpCode ?? response.status ?? response.statusCode ?? causeResponse.status ?? err.statusCode;
	return code === undefined || code === null ? '' : String(code);
}

/** The parsed API error the node attaches to everything it throws. */
const API_ERROR_PROPERTY = 'pdfMintApiError';

/**
 * Reads the API's own error fields back off a thrown error, so Continue On Fail
 * can emit something an IF node can branch on rather than a sentence.
 */
function pdfMintApiError(error: unknown): IDataObject | undefined {
	const attached = (error as { [API_ERROR_PROPERTY]?: IDataObject })?.[API_ERROR_PROPERTY];
	if (attached) return attached;

	const apiError = errorBody(error)?.json?.error as IDataObject | undefined;
	if (!apiError?.message) return undefined;
	return compactApiError(apiError, statusCodeOf(error));
}

function compactApiError(apiError: IDataObject, httpCode: string): IDataObject {
	const info: IDataObject = { message: String(apiError.message) };
	if (apiError.code) info.code = String(apiError.code);
	if (apiError.hint) info.hint = String(apiError.hint);
	if (apiError.docs) info.docs = String(apiError.docs);
	if (apiError.request_id) info.request_id = String(apiError.request_id);
	if (apiError.details !== undefined) info.details = apiError.details;
	if (httpCode) info.httpCode = httpCode;
	return info;
}

/**
 * The item Continue On Fail emits. `error` is an object so a workflow can test
 * `$json.error.code` in an IF node; `errorMessage` keeps the plain sentence for
 * anything that only wants to print it.
 */
export function errorItemJson(error: unknown): IDataObject {
	const info = pdfMintApiError(error);
	const thrown = (error ?? {}) as { message?: string; description?: string };
	const message = String(info?.message ?? thrown.message ?? 'Unknown error');
	const details: IDataObject = { ...(info ?? {}), message };
	// A node-side error has no API hint, but its description is one.
	if (!info && thrown.description) details.hint = thrown.description;

	const json: IDataObject = { error: details, errorMessage: message };
	if (thrown.description) json.errorDescription = thrown.description;
	return json;
}

/**
 * NodeApiError hands back its second argument untouched when that argument is
 * already a NodeApiError, so an error can only be given a better message by
 * building it from a plain object. Annotating in place is the honest way to add
 * the item index to one the node already built.
 */
export function withItemIndex<T>(error: T, itemIndex: number): T {
	const context = (error as { context?: IDataObject })?.context;
	if (context && typeof context === 'object' && context.itemIndex === undefined) {
		context.itemIndex = itemIndex;
	}
	return error;
}

/**
 * The API answers every failure with
 *   { error: { code, message, hint?, docs?, request_id? } }
 * so the node can show the operator a sentence they can act on instead of
 * "Request failed with status code 400".
 */
function describeError(context: IExecuteFunctions | ILoadOptionsFunctions, error: JsonObject): never {
	const decoded = errorBody(error);
	const apiError = (decoded?.json?.error ?? {}) as IDataObject;
	const httpCode = statusCodeOf(error);

	if (apiError.message) {
		const info = compactApiError(apiError, httpCode);
		const parts: string[] = [];
		if (info.hint) parts.push(String(info.hint));
		const advice = N8N_ADVICE[String(info.code ?? '')];
		if (advice) parts.push(advice);
		if (info.docs) parts.push(`Docs: ${String(info.docs)}`);
		if (info.request_id) parts.push(`Request ID: ${String(info.request_id)}`);

		// The plain object is what stops NodeApiError from short-circuiting.
		const failure = new NodeApiError(context.getNode(), decoded?.json as JsonObject, {
			message: String(info.message),
			description: parts.join(' '),
			httpCode: httpCode || undefined,
		});
		// The decoded envelope, not the Buffer the transport happened to use.
		failure.context.data = decoded?.json as IDataObject;
		Object.assign(failure, { [API_ERROR_PROPERTY]: info });
		throw failure;
	}

	const code = String((error as JsonObject).code ?? '');
	if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT'].includes(code)) {
		throw new NodeApiError(
			context.getNode(),
			{ code, message: String((error as JsonObject).message ?? code) },
			{
				message: 'Could not reach the PDFMint API',
				description:
					'Check that this n8n instance has outbound internet access, and that the Base URL in the credential is correct.',
			},
		);
	}

	// Nothing recognisable in the body. Keep whatever n8n already worked out,
	// but never leave a Buffer behind for the panel to print as decimal bytes.
	const failure = new NodeApiError(context.getNode(), error);
	if (decoded?.text !== undefined) {
		failure.context.data = decoded.text.slice(0, 2000);
	}
	throw failure;
}

export async function pdfMintRequest(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject,
	binary = false,
): Promise<PdfMintResponse> {
	const options: IHttpRequestOptions = {
		method,
		url: `${await baseUrl(this)}${endpoint}`,
		headers: {
			'User-Agent': 'n8n-nodes-pdfmint',
			Accept: binary ? '*/*' : 'application/json',
		},
		json: !binary,
		returnFullResponse: true,
		ignoreHttpStatusErrors: false,
	};
	if (body !== undefined) options.body = body;
	if (binary) options.encoding = 'arraybuffer';

	try {
		const response = (await this.helpers.httpRequestWithAuthentication.call(
			this,
			'pdfMintApi',
			options,
		)) as unknown as PdfMintResponse;
		return response;
	} catch (error) {
		return describeError(this, error as JsonObject);
	}
}

export async function getTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const response = await pdfMintRequest.call(this, 'GET', '/v1/templates');
	const templates = ((response.body as IDataObject)?.templates ?? []) as IDataObject[];
	return templates.map((template) => ({
		name: String(template.name),
		value: String(template.name),
	}));
}

/** Turns "20mm" or {top:..} style user input into the API's margin shape. */
export function buildMargin(options: IDataObject): IDataObject | string | undefined {
	const perSide: IDataObject = {};
	for (const side of ['top', 'right', 'bottom', 'left'] as const) {
		const key = `margin${side[0].toUpperCase()}${side.slice(1)}`;
		if (options[key] !== undefined && options[key] !== '') perSide[side] = options[key];
	}
	if (Object.keys(perSide).length) {
		// An unset Margin means the operator never touched it, so the edges they
		// did not override keep the same default the Margin field shows.
		const all =
			options.margin === undefined || options.margin === '' ? DEFAULT_MARGIN : String(options.margin);
		return { top: all, right: all, bottom: all, left: all, ...perSide };
	}
	if (options.margin !== undefined && options.margin !== '') return options.margin as string;
	return undefined;
}

export function parseJsonParameter(
	context: IExecuteFunctions,
	value: unknown,
	field: string,
	itemIndex: number,
): IDataObject | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value === 'object') return value as IDataObject;
	try {
		return JSON.parse(String(value)) as IDataObject;
	} catch (error) {
		throw new NodeOperationError(context.getNode(), `"${field}" is not valid JSON`, {
			itemIndex,
			description: `Use an expression that yields an object, for example {{ $json }}, or fix the JSON by hand. The parser said: ${(error as Error).message}`,
		});
	}
}
