import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class PdfMintApi implements ICredentialType {
	name = 'pdfMintApi';

	icon = { light: 'file:pdfmint.svg', dark: 'file:pdfmint.dark.svg' } as const;

	displayName = 'PDFMint API';

	documentationUrl = 'https://pdf.mintapis.com/docs#authentication';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: 'pm_live_...',
			description:
				'Create a free account at https://pdf.mintapis.com/signup and copy the key shown on your dashboard. The free plan is 10 documents a month and needs no card; Starter is $9 a month for 5,000.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://pdf.mintapis.com',
			description: 'Only change this if you run your own PDFMint instance',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/v1/me',
		},
	};
}
