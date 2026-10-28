/**
 * Host half: inert by design.
 *
 * Everything this package presents lives in the browser half: it replaces the
 * composer's model seat, exposes the thinking-strength slider and renders the
 * subscription usage block. The node side exists only so the Loader has a row
 * to mount for this package.
 *
 * The subscription stack itself is not behind this row. `cordis.patch.yml`
 * mounts a second row pointing at the MIT `dsh-plugin-subscriptions` code
 * vendored under `vendor/`; that row registers the provider adapters, owns the
 * OAuth credential store and serves the `subscriptions-auth.*` RPC endpoints the
 * browser half reads usage from. Mounting it from the same bundle is what makes
 * a plain `dsh plugin add dsh-enhanced-model-support` enough — no separate
 * subscription plugin, and no peer-range mismatch that would get the row
 * dropped at boot.
 *
 * Keep this module free of side effects: importing it must never touch network,
 * credentials or model state.
 */
export function apply() {}
