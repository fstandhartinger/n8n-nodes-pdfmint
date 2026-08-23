import type {
	IBinaryData,
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPairedItemData,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	buildMargin,
	errorItemJson,
	getTemplates,
	parseJsonParameter,
	pdfMintRequest,
	withItemIndex,
} from './GenericFunctions';
import {
	contentFields,
	fileNameField,
	outputField,
	pdfOptions,
	sourceField,
} from './descriptions/PdfDescription';
import {
	imageFileNameFields,
	imageFormatField,
	imageOptions,
	mergeFields,
} from './descriptions/OtherDescription';

export class PdfMint implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PDFMint',
		name: 'pdfMint',
		icon: { light: 'file:pdfmint.svg', dark: 'file:pdfmint.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] }}',
		description: 'Turn HTML, Markdown or a URL into a PDF and get the file back on this node',
		defaults: { name: 'PDFMint' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'pdfMintApi', required: true }],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'pdf',
				options: [
					{
						name: 'Generate PDF',
						value: 'pdf',
						description: 'Render HTML, Markdown, a URL or a saved template as a PDF',
						action: 'Generate a PDF',
					},
					{
						name: 'Generate Image',
						value: 'image',
						description: 'Render HTML, Markdown or a URL as a PNG or JPEG',
						action: 'Generate an image',
					},
					{
						name: 'Merge PDFs',
						value: 'merge',
						description: 'Join several PDFs into one document',
						action: 'Merge PDF files',
					},
					{
						name: 'Get Usage',
						value: 'usage',
						description: 'Read the plan, quota and remaining documents for this account',
						action: 'Get usage',
					},
				],
			},
			sourceField,
			...contentFields,
			outputField,
			fileNameField,
			imageFormatField,
			...imageFileNameFields,
			pdfOptions,
			imageOptions,
			...mergeFields,
		],
	};

	methods = {
		loadOptions: { getTemplates },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const operation = this.getNodeParameter('operation', 0) as string;
		const returnData: INodeExecutionData[] = [];

		// Merging consumes every input item at once, and usage describes the
		// account rather than an item, so both run once for the whole node —
		// inside the same error handling as everything else.
		if (operation === 'merge' || operation === 'usage') {
			const pairedItem: IPairedItemData[] = items.map((_, index) => ({ item: index }));
			try {
				if (operation === 'merge') return [await mergeAll.call(this, items)];
				const response = await pdfMintRequest.call(this, 'GET', '/v1/me');
				return [[{ json: response.body as IDataObject, pairedItem }]];
			} catch (error) {
				if (this.continueOnFail()) {
					return [[{ json: errorItemJson(error), pairedItem }]];
				}
				throw rethrow.call(this, error, 0);
			}
		}

		for (let i = 0; i < items.length; i++) {
			try {
				if (operation === 'pdf') {
					returnData.push(await generatePdf.call(this, i));
					continue;
				}
				if (operation === 'image') {
					returnData.push(await generateImage.call(this, i));
					continue;
				}
				throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`, { itemIndex: i });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: errorItemJson(error), pairedItem: { item: i } });
					continue;
				}
				throw rethrow.call(this, error, i);
			}
		}

		return [returnData];
	}
}

/**
 * n8n's NodeApiError returns its argument unchanged when handed another
 * NodeApiError, so re-wrapping one would be a no-op. The API's message, hint,
 * docs link and request id are already on the error the request helper built;
 * all that is missing is which item failed.
 */
function rethrow(this: IExecuteFunctions, error: unknown, itemIndex: number): Error {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) {
		return withItemIndex(error, itemIndex);
	}
	return new NodeOperationError(this.getNode(), error as Error, { itemIndex });
}

/* ------------------------------------------------------------------ helpers */

function collectPdfBody(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const source = this.getNodeParameter('source', itemIndex) as string;
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const body: IDataObject = {};

	if (source === 'html') body.html = this.getNodeParameter('html', itemIndex) as string;
	if (source === 'markdown') body.markdown = this.getNodeParameter('markdown', itemIndex) as string;
	if (source === 'url') body.url = this.getNodeParameter('url', itemIndex) as string;
	if (source === 'template') {
		body.template = this.getNodeParameter('template', itemIndex) as string;
		body.data = parseJsonParameter(this, this.getNodeParameter('data', itemIndex, {}), 'Data', itemIndex);
	} else if (options.data !== undefined && options.data !== '') {
		body.data = parseJsonParameter(this, options.data, 'Placeholder Data', itemIndex);
	}

	const pdfOpts: IDataObject = {};
	if (options.format) pdfOpts.format = options.format;
	if (options.landscape !== undefined) pdfOpts.landscape = options.landscape;
	const margin = buildMargin(options);
	if (margin !== undefined) pdfOpts.margin = margin;
	if (options.scale !== undefined) pdfOpts.scale = options.scale;
	if (options.printBackground !== undefined) pdfOpts.printBackground = options.printBackground;
	if (options.headerHtml) pdfOpts.headerHtml = options.headerHtml;
	if (options.footerHtml) pdfOpts.footerHtml = options.footerHtml;
	if (options.pageNumbers) pdfOpts.pageNumbers = (options.pageNumberFormat as string) || true;
	if (options.pageRanges) pdfOpts.pageRanges = options.pageRanges;
	if (options.mediaType) pdfOpts.mediaType = options.mediaType;
	if (options.preferCssPageSize !== undefined) pdfOpts.preferCssPageSize = options.preferCssPageSize;
	if (Object.keys(pdfOpts).length) body.options = pdfOpts;

	if (options.waitFor) body.waitFor = options.waitFor;
	if (options.timeout) body.timeout = options.timeout;
	if (options.password) body.password = options.password;
	if (options.strict) body.strict = options.strict;
	if (options.debug) body.debug = options.debug;
	if (options.webhookUrl) body.webhookUrl = options.webhookUrl;
	if (options.watermarkText) {
		body.watermark = {
			text: options.watermarkText,
			opacity: options.watermarkOpacity,
			color: options.watermarkColor,
		};
	}
	if (options.css) body.css = options.css;
	if (options.googleFonts) body.googleFonts = options.googleFonts;

	const metadata: IDataObject = {};
	if (options.title) metadata.title = options.title;
	if (options.author) metadata.author = options.author;
	if (Object.keys(metadata).length) body.metadata = metadata;

	return body;
}

async function generatePdf(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData> {
	const output = this.getNodeParameter('output', itemIndex) as string;
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const fileName = (this.getNodeParameter('fileName', itemIndex, 'document.pdf') as string) || 'document.pdf';

	const body = collectPdfBody.call(this, itemIndex);
	body.filename = fileName;
	body.output = output;
	if (output === 'url' && options.expiresInMinutes) body.expiresInMinutes = options.expiresInMinutes;

	// An async request never returns a file, so ask for JSON regardless of the
	// chosen output mode and hand the job back to the workflow.
	const isAsync = Boolean(body.webhookUrl);
	const response = await pdfMintRequest.call(this, 'POST', '/v1/pdf', body, !isAsync && output === 'binary');

	if (isAsync || output !== 'binary') {
		return { json: response.body as IDataObject, pairedItem: { item: itemIndex } };
	}
	return buildBinaryItem.call(
		this,
		response.body as Buffer,
		response.headers,
		fileName,
		'application/pdf',
		(options.binaryPropertyName as string) || 'data',
		itemIndex,
	);
}

async function generateImage(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData> {
	const source = this.getNodeParameter('source', itemIndex) as string;
	const output = this.getNodeParameter('output', itemIndex) as string;
	const options = this.getNodeParameter('imageOptions', itemIndex, {}) as IDataObject;
	// Format and File Name are top-level fields now. Workflows saved while they
	// lived in Options keep working, and keep winning.
	const type = (options.type as string) || (this.getNodeParameter('imageType', itemIndex, 'png') as string);
	const fileName =
		(options.fileName as string) ||
		(this.getNodeParameter('fileName', itemIndex, '') as string) ||
		`image.${type}`;

	const body: IDataObject = { type, output, filename: fileName };
	if (source === 'html') body.html = this.getNodeParameter('html', itemIndex) as string;
	if (source === 'markdown') body.markdown = this.getNodeParameter('markdown', itemIndex) as string;
	if (source === 'url') body.url = this.getNodeParameter('url', itemIndex) as string;
	for (const key of ['width', 'height', 'quality', 'deviceScaleFactor', 'fullPage', 'omitBackground', 'waitFor', 'timeout']) {
		if (options[key] !== undefined && options[key] !== '') body[key] = options[key];
	}

	const response = await pdfMintRequest.call(this, 'POST', '/v1/image', body, output === 'binary');
	if (output !== 'binary') {
		return { json: response.body as IDataObject, pairedItem: { item: itemIndex } };
	}
	return buildBinaryItem.call(
		this,
		response.body as Buffer,
		response.headers,
		fileName,
		`image/${type}`,
		(options.binaryPropertyName as string) || 'data',
		itemIndex,
	);
}

async function mergeAll(this: IExecuteFunctions, items: INodeExecutionData[]): Promise<INodeExecutionData[]> {
	const mergeSource = this.getNodeParameter('mergeSource', 0) as string;
	const output = this.getNodeParameter('output', 0) as string;
	const options = this.getNodeParameter('mergeOptions', 0, {}) as IDataObject;
	const fileName = (this.getNodeParameter('fileName', 0, 'merged.pdf') as string) || 'merged.pdf';

	const files: Array<string | IDataObject> = [];
	if (mergeSource === 'urls') {
		const raw = this.getNodeParameter('mergeUrls', 0) as string;
		for (const line of raw.split(/[\r\n,]+/).map((l) => l.trim()).filter(Boolean)) files.push(line);
	} else {
		const property = this.getNodeParameter('mergeBinaryProperty', 0) as string;
		for (let i = 0; i < items.length; i++) {
			const binary = items[i].binary?.[property];
			if (!binary) {
				throw new NodeOperationError(
					this.getNode(),
					`Item ${i + 1} has no binary field called "${property}"`,
					{
						itemIndex: i,
						description: `Fields on this item: ${Object.keys(items[i].binary ?? {}).join(', ') || 'none'}. Set "Input Binary Field" to the one holding the PDF.`,
					},
				);
			}
			const buffer = await this.helpers.getBinaryDataBuffer(i, property);
			files.push({ base64: buffer.toString('base64') });
		}
	}

	if (files.length < 2) {
		throw new NodeOperationError(this.getNode(), 'Merging needs at least two PDFs', {
			description:
				mergeSource === 'urls'
					? 'Put one URL per line in the URLs field.'
					: `This node received ${files.length} input item${files.length === 1 ? '' : 's'}. Connect a branch that produces several items, each carrying a PDF.`,
		});
	}

	const body: IDataObject = { files, output, filename: fileName };
	if (options.title) body.metadata = { title: options.title };
	if (output === 'url' && options.expiresInMinutes) body.expiresInMinutes = options.expiresInMinutes;

	const response = await pdfMintRequest.call(this, 'POST', '/v1/merge', body, output === 'binary');
	const pairedItem = items.map((_, index) => ({ item: index }));

	if (output !== 'binary') {
		return [{ json: response.body as IDataObject, pairedItem }];
	}
	const item = await buildBinaryItem.call(
		this,
		response.body as Buffer,
		response.headers,
		fileName,
		'application/pdf',
		(options.binaryPropertyName as string) || 'data',
		0,
	);
	return [{ ...item, pairedItem }];
}

async function buildBinaryItem(
	this: IExecuteFunctions,
	buffer: Buffer,
	headers: Record<string, string>,
	fileName: string,
	mimeType: string,
	binaryPropertyName: string,
	itemIndex: number,
): Promise<INodeExecutionData> {
	const data: IBinaryData = await this.helpers.prepareBinaryData(
		Buffer.from(buffer),
		fileName,
		mimeType,
	);
	const json: IDataObject = {
		fileName,
		mimeType,
		size: Buffer.from(buffer).length,
	};
	const pages = headers['x-pdfmint-pages'];
	const duration = headers['x-pdfmint-duration-ms'];
	const remaining = headers['x-pdfmint-credits-remaining'];
	const warning = headers['x-pdfmint-warning'];
	if (pages) json.pages = Number(pages);
	if (duration) json.durationMs = Number(duration);
	if (remaining) json.creditsRemaining = Number(remaining);
	if (warning) json.warning = warning;

	return {
		json,
		binary: { [binaryPropertyName]: data },
		pairedItem: { item: itemIndex },
	};
}
