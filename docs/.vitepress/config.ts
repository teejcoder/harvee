import { withMermaid } from 'vitepress-plugin-mermaid';

export default withMermaid({
	title: 'harvest-clone',
	description: 'Internal documentation for the single-user time tracking and invoicing tool.',
	cleanUrls: true,
	themeConfig: {
		nav: [
			{ text: 'Architecture', link: '/architecture/overview' },
			{ text: 'Guides', link: '/guides/running-locally' },
			{ text: 'Decisions', link: '/decisions/' },
			{ text: 'Changelog', link: '/changelog' }
		],
		sidebar: {
			'/architecture/': [
				{
					text: 'Architecture',
					items: [
						{ text: 'Overview', link: '/architecture/overview' },
						{ text: 'State machines', link: '/architecture/state-machines' },
						{ text: 'Data model', link: '/architecture/data-model' }
					]
				}
			],
			'/guides/': [
				{
					text: 'Guides',
					items: [
						{ text: 'Running locally', link: '/guides/running-locally' },
						{ text: 'Generating an invoice', link: '/guides/generating-an-invoice' },
						{ text: 'Editing time entries', link: '/guides/editing-time-entries' }
					]
				}
			],
			'/decisions/': [
				{
					text: 'Decisions',
					items: [{ text: 'Index', link: '/decisions/' }]
				}
			]
		}
	}
});
