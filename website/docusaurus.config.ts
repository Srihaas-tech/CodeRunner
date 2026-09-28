import type * as Preset from '@docusaurus/preset-classic';
import type {Config} from '@docusaurus/types';
import {themes as prismThemes} from 'prism-react-renderer';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'CodeRunner Docs',
  tagline: 'Browser-based IDE, simulator, telemetry, and path planning for FRC programming training',
  favicon: 'img/coderunner-icon.png',

  future: {
    v4: true,
  },

  // Deployed to GitHub Pages (see .github/workflows/deploy-docs.yml)
  url: 'https://mathewdunne.github.io',
  baseUrl: '/CodeRunner/',

  // GitHub Pages deployment config (used by `docusaurus deploy` and for metadata).
  organizationName: 'mathewdunne',
  projectName: 'CodeRunner',
  trailingSlash: false,

  // Proves site ownership to the Algolia crawler. Injected into every page's
  // <head>; the crawler reads it from the site root.
  headTags: [
    {
      tagName: 'meta',
      attributes: {
        name: 'algolia-site-verification',
        content: '772853D21F365831',
      },
    },
  ],

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          path: '../docs',
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          // Decision logs and implementation plans are maintainer/agent
          // records, not site content.
          exclude: [
            'decisions/**',
            'superpowers/**',
          ],
          editUrl: 'https://github.com/mathewdunne/CodeRunner/tree/main/docs/',
        },
        blog: false,
        pages: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // DocSearch, via the theme-search-algolia bundled in preset-classic. The
    // apiKey here is Algolia's public search-only key and is safe to commit;
    // the write/admin key is not and must never land in this repo.
    algolia: {
      appId: '5BW22U91EM',
      apiKey: 'cfbf90d7a19db5b9dfa3397952873270',
      indexName: 'CodeRunner Docs',
      contextualSearch: false,
      searchPagePath: 'search',
    },
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: 'CodeRunner',
      logo: {
        alt: 'CodeRunner logo',
        src: 'img/coderunner-header.png',
      },
      items: [
        {
          href: 'https://github.com/mathewdunne/CodeRunner',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    // The footer renders on every page, including the site root, which is how
    // the Legal pages stay reachable without a navbar slot. Most CodeRunner
    // users are minors at schools, so keep the privacy policy one click away
    // from anywhere on the site. See docs/legal/.
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Using CodeRunner', to: '/using-coderunner'},
            {label: 'Quick Start (Installation)', to: '/quick-start'},
            {label: 'Architecture', to: '/about/architecture'},
            {label: 'Deploying', to: '/deploying/overview'},
          ],
        },
        {
          title: 'Legal',
          items: [
            {label: 'Privacy Policy', to: '/legal/privacy'},
            {label: 'Terms of Service', to: '/legal/terms'},
            {label: 'Licenses', to: '/legal/licenses'},
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/mathewdunne/CodeRunner',
            },
            {
              label: 'Issues',
              href: 'https://github.com/mathewdunne/CodeRunner/issues',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} CodeRunner contributors. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['java', 'bash', 'json', 'groovy', 'docker', 'hcl'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
