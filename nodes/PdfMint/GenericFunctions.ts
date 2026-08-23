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

const DEFAULT_BASE_URL = 'https://pdfmint-b9tt.onrender.com';

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
 * The API answers every failure with
 *   { error: { code, message, hint?, docs?, request_id? } }
 * so the node can show the operator a sentence they can act on instead of
 * "Request failed with status code 400".
 */
function describeError(context: IExecuteFunctions | ILoadOptionsFunctions, error: JsonObject): never {
	const response = (error.response ?? {}) as JsonObject;
	const payload = (response.body ?? error.body ?? {}) as JsonObject;
	let apiError = (payload.error ?? {}) as JsonObject;

	// A binary request returns the error body as a Buffer, so decode it first.
	if (!apiError.message && Buffer.isBuffer(payload)) {
		try {
			apiError = (JSON.parse((payload as unknown as Buffer).toString('utf8')).error ?? {}) as JsonObject;
		} catch {
			apiError = {};
		}
	}
	if (!apiError.message && Buffer.isBuffer(response.body)) {
		try {
			apiError = (JSON.parse((response.body as unknown as Buffer).toString('utf8')).error ?? {}) as JsonObject;
		} catch {
			apiError = {};
		}
	}

	if (apiError.message) {
		const parts: string[] = [];
		if (apiError.hint) parts.push(String(apiError.hint));
		if (apiError.docs) parts.push(`Docs: ${String(apiError.docs)}`);
		if (apiError.request_id) parts.push(`Request ID: ${String(apiError.request_id)}`);
		throw new NodeApiError(context.getNode(), error, {
			message: String(apiError.message),
			description: parts.join(' '),
			httpCode: String(response.statusCode ?? error.statusCode ?? ''),
		});
	}

	const code = String((error as JsonObject).code ?? '');
	if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT'].includes(code)) {
		throw new NodeApiError(context.getNode(), error, {
			message: 'Could not reach the PDFMint API',
			description:
				'Check that this n8n instance has outbound internet access, and that the Base URL in the credential is correct.',
		});
	}

	throw new NodeApiError(context.getNode(), error);
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
		const all = (options.margin as string) || '0';
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
