# Forma / CMS Light

English | [Русский](README.ru.md)

A local MVP of an agent-driven CMS for small websites. Owners can edit content manually or ask AI to add a form, an interactive block, CSS/JavaScript, or a webhook integration. Changes are saved to a draft first and published through a separate action.

The detailed [product and architecture plan](docs/product-plan.md) (in Russian) covers the CMS approach, planned adapters, the runner, GitLab, and development stages.

## Getting started

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run dev
```

- Studio: http://127.0.0.1:4310
- Isolated preview: http://127.0.0.1:4311/preview
- Locally published website: http://127.0.0.1:4311/published

```sh
npm test
npm run build
npm start
```

The server listens on loopback only. A second instance using the same data directory is blocked. After a crash, remove `.data/.forma-instance.lock` only after confirming that the previous process has stopped. This is a local, single-user tool, not a public SaaS. Keep Studio on port 4310 for the OAuth callback. Export variables from `.env.example` into the process environment; `.env` files are not loaded automatically.

## Implemented features

- Vue Studio with a live preview, section selection, and desktop/mobile views.
- Manual editing of text, images, cards, form fields, and HTML blocks.
- A source editor for `content.json`, `styles.css`, and `script.js`.
- Chat connected to the real Responses API, with tools for reading and editing source files. No simulated AI responses or automatic paid fallback.
- Connection to your own ChatGPT account through official Sign in with ChatGPT, or through an OpenAI API key.
- Attachments: PNG/JPEG/WebP, PDF, TXT, Markdown, CSV, and JSON, up to 10 MB per file. Text is read in pages; images and PDFs are sent as multimodal input.
- Server-side drafts, revision checks, atomic application of agent changes, and task cancellation.
- Forms with persistent submissions, validation, and rate limiting.
- HTTPS webhook integrations with a server-side Bearer secret. New integrations created by the agent remain disabled until the owner reviews them.
- Custom scripts and interactivity. Integration scripts are enabled separately and run in the published version.
- Local publishing, version history, and restoration to a draft.
- ZIP export of standalone Nuxt and Next starter projects with editable source files and media.

To try the workflow without AI, click «Добавить форму» (Add a form) in the interface. This is explicitly labeled as a template rather than a model-generated result. Publish locally, open the published website, submit the form, and find the saved entry in the submissions section. The preview does not send real submissions.

## Connecting AI

Open the AI settings in Studio. ChatGPT sign-in performs application registration with PKCE, `state`, `nonce`, JWKS/ID token verification, and granted-permission checks. Tokens are stored only on the server in `.data/auth.json`, with `0600` permissions, and refreshed sequentially. A subscription does not guarantee access to a particular model; the model catalog and permissions are checked through OpenAI.

The implementation uses the public Responses API with `store: false`, `stream: true`, and a bounded tool loop. Access is limited to the three website source files and integration declarations. The model has no shell access, GitLab credentials, webhook keys, or access to arbitrary files on the computer. Each task is limited to 12 model requests and 48 tool calls. The stream must complete and validation must pass before changes are applied.

Live OAuth and inference require the owner to sign in. Tests check the protocol using mocked responses and signed test tokens; they do not verify a real account or consume its allowance.

Official references:

- [SIWC registration and OAuth](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Accounts and token refresh](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Current limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

The documented OSS OAuth flow applies to local/open-source use. Access for a commercial or hosted product needs to be confirmed separately with OpenAI. This repository contains a prototype; its license and distribution model have not yet been decided.

## Files and publishing

`server/site.ts` provides the shared renderer for the website and exports. JSON stores stable section IDs and editable fields. New client-side functionality is added through `custom` HTML sections, CSS, and JavaScript. Forms are a separate section type with declarative fields.

`server/store.ts` saves state atomically. Mutations are serialized; the agent works on a copy and applies it only if the original revision still matches. Publishing saves an immutable snapshot of the source files and integrations. Restoring a version changes only the draft; publishing again remains an explicit action.

State, tokens, the secret-encryption key, attachments, and submissions are stored in `.data/`. Back up the entire directory securely. `.credentials/`, `.data/`, and `.env` are excluded from Git. Webhook secrets are encrypted and bound to the integration ID and destination URL. The encryption key is stored locally; this protects against accidental disclosure but is not a full external vault.

Publishing in the MVP creates a version accessible on the local machine. External hosting, domains, and website CI/CD are not connected yet. GitLab versions the product itself; separate branches and repositories for customer websites are planned for a later stage.

## Nuxt and Next exports

Download a ZIP from the export menu. It contains a starter project with content source files, the shared renderer, CSS/JS, and images. It is a portable starting point, not automatic integration with any existing application or bidirectional synchronization with the CMS.

Exports have been verified with production builds: Nuxt 4.6.2 and Next 16.4.2 on Node 22.22.3. Nuxt requires a Node version within the range specified in the exported `package.json`; `.nvmrc` specifies the verified version. Nuxt dependencies still have upstream `braces`/`node-forge` audit warnings documented inside the ZIP; the Next audit was clean at the time of verification.

Forms on an exported website require your own public backend endpoint, described in the README inside the ZIP. Local form tokens and webhook secrets are not exported. Before enabling external browser integrations, explicitly configure the exported project's environment variable.

## Current MVP limits

- One local website and one page made of sections; no team authorization, billing, or multi-user isolation.
- AI edits real JSON/HTML/CSS/JS source files. Direct changes to arbitrary Vue/TSX server modules, package installation, and shell execution require a separate sandbox runner.
- Preview is restricted by CSP: external connections, external scripts, and form submissions are blocked. Client-side `script.js` runs in an isolated iframe/origin; this is not a server sandbox for arbitrary applications.
- Schema and JavaScript syntax are validated. A full browser check of every generation and automated security analysis of published JavaScript are planned for a later stage. The owner reviews the result before publishing.
- PDFs are passed directly to the model. DOCX/XLSX/OCR, antivirus checks, and large documents are not supported yet.
- Webhooks use HTTPS/443 and public IPv4 only. The DNS address is pinned for the request, and redirects are blocked. Retries and a dead-letter queue are not implemented yet; delivery status is saved with the submission.

## Next steps

1. Verify live OAuth and AI workflows with the owner's account.
2. Add pages/routes and extensible component schemas.
3. Connect GitLab repositories for customer websites and adapters for live Nuxt/Next projects.
4. Add a separate runner for dependency installation, builds, and Vue/TSX/backend changes.
5. Add cloud publishing, a webhook delivery queue, and secret-management infrastructure.

This GitHub portfolio copy excludes CI configuration and deployment files. Run the checks above locally. The original GitLab configuration remains in the working project; the CMS's local publishing and export features are preserved.
