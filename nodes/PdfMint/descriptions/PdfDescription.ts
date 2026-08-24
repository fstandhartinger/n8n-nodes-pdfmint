import type { INodeProperties } from 'n8n-workflow';

import { DEFAULT_MARGIN } from '../constants';

/**
 * A node dragged onto the canvas has to render on the first Execute, with no
 * decisions to make. Kept short so it reads as a starting point rather than an
 * example to study, and free of {{ }} because the API substitutes those.
 */
const STARTER_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font: 16px/1.6 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1f2933; }
      h1 { font-size: 28px; margin: 0 0 12px; }
      p { margin: 0; color: #52606d; }
    </style>
  </head>
  <body>
    <h1>Hello from PDFMint</h1>
    <p>Replace this HTML with your own, or drop in an expression to use data from an earlier node.</p>
  </body>
</html>`;

const showFor = (operations: string[], extra: Record<string, unknown> = {}) => ({
	show: { operation: operations, ...extra },
});

export const sourceField: INodeProperties = {
	displayName: 'Source',
	name: 'source',
	type: 'options',
	noDataExpression: true,
	default: 'html',
	description: 'Where the content comes from',
	displayOptions: showFor(['pdf', 'image']),
	options: [
		{
			name: 'HTML',
			value: 'html',
			description: 'Send HTML you already have in the workflow. No template needs to be registered anywhere.',
		},
		{
			name: 'Markdown',
			value: 'markdown',
			description: 'Send Markdown and get a typeset document back. Useful for LLM output.',
		},
		{
			name: 'URL',
			value: 'url',
			description: 'Render a publicly reachable web page',
		},
		{
			name: 'Saved Template',
			value: 'template',
			description: 'Use HTML you stored on your PDFMint account, filled with data from this item',
		},
	],
};

export const contentFields: INodeProperties[] = [
	{
		displayName: 'HTML',
		name: 'html',
		type: 'string',
		typeOptions: { rows: 8 },
		default: STARTER_HTML,
		required: true,
		placeholder: '<h1>Invoice {{ $json.number }}</h1>',
		description: 'The HTML to render. A full document or a fragment both work. Reference workflow data with an expression, for example {{ $JSON.html }}.',
		displayOptions: showFor(['pdf', 'image'], { source: ['html'] }),
	},
	{
		displayName: 'Markdown',
		name: 'markdown',
		type: 'string',
		typeOptions: { rows: 8 },
		default: '',
		required: true,
		placeholder: '# Report\n\nSome **text**.',
		description: 'The Markdown to typeset. Tables, code blocks and task lists are supported, and a print stylesheet is applied for you.',
		displayOptions: showFor(['pdf', 'image'], { source: ['markdown'] }),
	},
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'https://example.com/report',
		description: 'The page to render. It has to be reachable from the public internet — pages behind a login will not work, fetch those in the workflow and pass the HTML instead.',
		displayOptions: showFor(['pdf', 'image'], { source: ['url'] }),
	},
	{
		displayName: 'Template Name or ID',
		name: 'template',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getTemplates' },
		default: '',
		required: true,
		description: 'A template saved on your PDFMint account. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: showFor(['pdf'], { source: ['template'] }),
	},
	{
		displayName: 'Data',
		name: 'data',
		type: 'json',
		default: '={{ $json }}',
		description: 'Values for the {{placeholders}} in the template. PDFMint tells you which placeholders had no value instead of quietly rendering a blank page.',
		displayOptions: showFor(['pdf'], { source: ['template'] }),
	},
];

export const outputField: INodeProperties = {
	displayName: 'Output',
	name: 'output',
	type: 'options',
	noDataExpression: true,
	default: 'binary',
	description: 'How you want the finished file back',
	displayOptions: showFor(['pdf', 'image', 'merge']),
	options: [
		{
			name: 'File (Binary)',
			value: 'binary',
			description: 'The file itself, attached to this item. No second HTTP Request node needed.',
		},
		{
			name: 'Hosted URL',
			value: 'url',
			description: 'A temporary link to the file, returned as JSON',
		},
		{
			name: 'Base64 in JSON',
			value: 'base64',
			description: 'The file encoded as base64 inside the JSON output',
		},
	],
};

export const fileNameField: INodeProperties = {
	displayName: 'File Name',
	name: 'fileName',
	type: 'string',
	default: 'document.pdf',
	description: 'Name given to the generated file',
	displayOptions: showFor(['pdf', 'merge']),
};

export const pdfOptions: INodeProperties = {
	displayName: 'Options',
	name: 'options',
	type: 'collection',
	placeholder: 'Add option',
	default: {},
	displayOptions: showFor(['pdf']),
	options: [
		{
			displayName: 'Author',
			name: 'author',
			type: 'string',
			default: '',
			description: 'Author recorded in the PDF metadata',
		},
		{
			displayName: 'CSS',
			name: 'css',
			type: 'string',
			typeOptions: { rows: 4 },
			default: '',
			description: 'Extra CSS appended to the built-in Markdown stylesheet. Only applies when the source is Markdown.',
		},
		{
			displayName: 'Footer HTML',
			name: 'footerHtml',
			type: 'string',
			default: '',
			placeholder: '<span>Confidential</span>',
			description: 'Repeated at the bottom of every page. PDFMint reserves bottom margin for it automatically, so it will not be clipped.',
		},
		{
			displayName: 'Google Font',
			name: 'googleFonts',
			type: 'string',
			default: '',
			placeholder: 'Playfair Display:wght@400;700',
			description: 'Load a Google Font for Markdown output. Give the family exactly as it appears in the Google Fonts URL.',
		},
		{
			displayName: 'Header HTML',
			name: 'headerHtml',
			type: 'string',
			default: '',
			placeholder: '<span>ACME Inc.</span>',
			description: 'Repeated at the top of every page. PDFMint reserves top margin for it automatically, so it will not be clipped.',
		},
		{
			displayName: 'Margin',
			name: 'margin',
			type: 'string',
			default: DEFAULT_MARGIN,
			placeholder: '20mm',
			description: 'Margin on all four sides, as a CSS length such as 20mm, 0.5in or 24px. Set it to 0 for a full-bleed design whose own CSS controls the spacing.',
		},
		{
			displayName: 'Margin Bottom',
			name: 'marginBottom',
			type: 'string',
			default: '',
			placeholder: '25mm',
			description: 'Overrides Margin for the bottom edge only',
		},
		{
			displayName: 'Margin Left',
			name: 'marginLeft',
			type: 'string',
			default: '',
			placeholder: '15mm',
			description: 'Overrides Margin for the left edge only',
		},
		{
			displayName: 'Margin Right',
			name: 'marginRight',
			type: 'string',
			default: '',
			placeholder: '15mm',
			description: 'Overrides Margin for the right edge only',
		},
		{
			displayName: 'Margin Top',
			name: 'marginTop',
			type: 'string',
			default: '',
			placeholder: '25mm',
			description: 'Overrides Margin for the top edge only',
		},
		{
			displayName: 'Media Type',
			name: 'mediaType',
			type: 'options',
			default: 'print',
			description: 'Which CSS media rules apply. Choose Screen when your stylesheet was written for the browser and @media print would hide things.',
			options: [
				{ name: 'Print', value: 'print' },
				{ name: 'Screen', value: 'screen' },
			],
		},
		{
			displayName: 'Orientation',
			name: 'landscape',
			type: 'options',
			default: false,
			description: 'Which way round the page is',
			options: [
				{ name: 'Portrait', value: false },
				{ name: 'Landscape', value: true },
			],
		},
		{
			displayName: 'Page Format',
			name: 'format',
			type: 'options',
			default: 'A4',
			description: 'Paper size to print on',
			options: [
				{ name: 'A3', value: 'A3' },
				{ name: 'A4', value: 'A4' },
				{ name: 'A5', value: 'A5' },
				{ name: 'Ledger', value: 'Ledger' },
				{ name: 'Legal', value: 'Legal' },
				{ name: 'Letter', value: 'Letter' },
				{ name: 'Tabloid', value: 'Tabloid' },
			],
		},
		{
			displayName: 'Page Number Format',
			name: 'pageNumberFormat',
			type: 'string',
			default: 'Page {page} of {total}',
			description: 'Text for the automatic footer. {page} and {total} are replaced by Chrome while printing. Only used when Page Numbers is on.',
		},
		{
			displayName: 'Page Numbers',
			name: 'pageNumbers',
			type: 'boolean',
			default: false,
			description: 'Whether to add a centred "Page X of Y" footer, with the bottom margin adjusted so it fits',
		},
		{
			displayName: 'Page Ranges',
			name: 'pageRanges',
			type: 'string',
			default: '',
			placeholder: '1-3, 8',
			description: 'Keep only these pages in the output. Leave empty for the whole document.',
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'Encrypt the PDF with AES-256 and require this password to open it. Included on every plan.',
		},
		{
			displayName: 'Placeholder Data',
			name: 'data',
			type: 'json',
			default: '',
			description: 'Values for {{placeholders}} in your HTML or Markdown. Leave empty if your content has none.',
		},
		{
			displayName: 'Prefer CSS Page Size',
			name: 'preferCssPageSize',
			type: 'boolean',
			default: false,
			description: 'Whether an @page rule in your CSS should win over the Page Format setting',
		},
		{
			displayName: 'Print Background',
			name: 'printBackground',
			type: 'boolean',
			default: true,
			description: 'Whether background colours and images are printed. Chrome leaves these out by default; PDFMint includes them.',
		},
		{
			displayName: 'Put Output File in Field',
			name: 'binaryPropertyName',
			type: 'string',
			default: 'data',
			description: 'Name of the binary field to write the file to',
		},
		{
			displayName: 'Return Debug Info',
			name: 'debug',
			type: 'boolean',
			default: false,
			description: 'Whether to also return the HTML that was actually rendered and any JavaScript errors the page threw. Use this when the PDF comes out wrong and you cannot see why.',
		},
		{
			displayName: 'Scale',
			name: 'scale',
			type: 'number',
			typeOptions: { minValue: 0.1, maxValue: 2, numberPrecision: 2 },
			default: 1,
			description: 'Print scale, between 0.1 and 2. Use 0.8 to fit a wide table on one page.',
		},
		{
			displayName: 'Strict Placeholders',
			name: 'strict',
			type: 'boolean',
			default: false,
			description: 'Whether to fail the item when a {{placeholder}} has no value, instead of rendering it empty',
		},
		{
			displayName: 'Timeout (Ms)',
			name: 'timeout',
			type: 'number',
			typeOptions: { minValue: 1000, maxValue: 120000 },
			default: 30000,
			description: 'How long the renderer may spend on this document before giving up',
		},
		{
			displayName: 'Title',
			name: 'title',
			type: 'string',
			default: '',
			description: 'Title recorded in the PDF metadata, shown in the viewer tab',
		},
		{
			displayName: 'URL Expires After (Minutes)',
			name: 'expiresInMinutes',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: 10080 },
			default: 60,
			description: 'How long a hosted URL stays valid, up to 7 days. Only used when Output is Hosted URL.',
		},
		{
			displayName: 'Wait For',
			name: 'waitFor',
			type: 'string',
			default: '',
			placeholder: '2000  or  #chart-ready  or  networkidle',
			description: 'Wait before printing: a number of milliseconds, a CSS selector to appear, or "networkidle". Use this when a chart or web font renders late.',
		},
		{
			displayName: 'Watermark Colour',
			name: 'watermarkColor',
			type: 'color',
			default: '#9AA3B2',
			description: 'Colour of the watermark text. Only used when Watermark Text is set.',
		},
		{
			displayName: 'Watermark Opacity',
			name: 'watermarkOpacity',
			type: 'number',
			typeOptions: { minValue: 0.01, maxValue: 1, numberPrecision: 2 },
			default: 0.18,
			description: 'How strong the watermark is, from 0.01 to 1. Only used when Watermark Text is set.',
		},
		{
			displayName: 'Watermark Text',
			name: 'watermarkText',
			type: 'string',
			default: '',
			placeholder: 'DRAFT',
			description: 'Stamp this text diagonally across every page, sized automatically to fit',
		},
		{
			displayName: 'Webhook URL (Async)',
			name: 'webhookUrl',
			type: 'string',
			default: '',
			placeholder: 'https://your-n8n.example.com/webhook/pdf-ready',
			description: 'Set this to render in the background instead of waiting. The node returns a job ID straight away and PDFMint POSTs the finished document to this URL, retrying up to three times. Use the Production URL of a Webhook node. Only worth it for documents that take longer than the timeout.',
		},
	],
};
