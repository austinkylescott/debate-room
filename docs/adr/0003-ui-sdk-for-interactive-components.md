# Every interactive control is built on UI SDK

Every interactive control in the Vue app (selects, checkboxes, radios, sliders, toggles, dialogs, menus, popovers, toasts, tabs, sheets) is built from [UI SDK](https://ui-sdk.dev/docs) primitives (`@ui-sdk/core` + `@ui-sdk/vue`) and styled with our own CSS tokens. We chose this over native controls plus hand-built dialogs and menus: the redesign needs dialogs, menus and sheets that the browser doesn't provide, and hand-rolled keyboard and ARIA behaviour is where accessibility usually breaks. We chose it over mixing the two (UI SDK only where there's no native control) so that every control is built, styled and reviewed one way. Plain buttons, text inputs and layout stay ordinary HTML and CSS, as UI SDK expects.

The spike in [#41](https://github.com/austinkylescott/debate-room/issues/41) (findings in [`docs/spikes/ui-sdk/`](../spikes/ui-sdk/README.md)) showed it works with Vue 3.5, Vite+ and the Cloudflare Vite plugin, and matches native controls for keyboard and screen-reader use.

## Consequences

- The migration lands with the redesign, one component at a time. The one exception is the Spectrum slider, which moved early with its spike ([#45](https://github.com/austinkylescott/debate-room/issues/45), findings in [`docs/spikes/ui-sdk-spectrum/`](../spikes/ui-sdk-spectrum/README.md)). The rest of the UI stays native until its redesigned component lands, and we accept that mix until then. The spike's open questions (crowded name labels, held-key settles, `Field` labels) are settled by the redesign.
- About +50 kB gzip of shared UI SDK runtime on first load (measured with the Select entry); later components add less. Measure each new entry when it's added.
- UI SDK is in public beta. Pin the exact version (the spike used `0.1.0-beta.17`) and expect API changes on upgrade.
- Component styles are global `[data-slot]` CSS, one file per component in `src/styles/components/` (imported from `src/style.css`, which declares `@layer ui-sdk` first so ours win), not Vue scoped styles, which don't reach UI SDK's parts.
- We don't load UI SDK's default stylesheet (`@ui-sdk/core/web.css`). The design tokens supply every visual decision, its defaults fought custom layout ([#45](https://github.com/austinkylescott/debate-room/issues/45)), and it was about 13 kB gzip of CSS we overrode. Its touch-target and `touch-action` rules come with each component's own CSS instead ([#53](https://github.com/austinkylescott/debate-room/issues/53)).
- UI SDK's agent skill lives in `.claude/skills/ui-sdk`. Install it with `pnpm dlx skills@latest add vercel-labs/ui --skill ui-sdk --agent claude-code -y` (`npx` fails on this repo's pnpm `devEngines`).
- Component tests (jsdom + Vue Test Utils) come in with the first migrated component.
