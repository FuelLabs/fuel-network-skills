# TypeScript frontend with fuels-ts

Verified against `FuelLabs/fuels-ts` `v0.103.0` on 2026-07-23. Inspect the
project lockfile and current release before using these APIs in another version.

- [Pin one coherent SDK generation](#pin-one-coherent-sdk-generation)
- [Generate types from the shipping ABI](#generate-types-from-the-shipping-abi)
- [Keep Next.js boundaries explicit](#keep-nextjs-boundaries-explicit)
- [Bind provider, account and contract deliberately](#bind-provider-account-and-contract-deliberately)
- [Build safe UX](#build-safe-ux)

## Pin one coherent SDK generation

Prefer the top-level `fuels` package and compatible `@fuels/react`,
`@fuels/connectors` and related packages from one tested release family. Keep
the JavaScript lockfile. Do not mix snippets from old `@fuel-ts/*` package
layouts with a current project without checking exports.

Use the project package manager:

```sh
npm install fuels --save
npx fuels --help
```

At `v0.103.0`, supported Node engines were `^20 || ^22 || ^24`. A concrete
compatibility example from that snapshot: fuels-ts `v0.103.0` pinned Fuel Core
`0.47.1` (matching the live networks) while fuels-rs `v0.77.0` targeted the
`0.48` family — equal-looking or newest version numbers are not a
compatibility matrix.

`npm create fuels`/`pnpm create fuels` can scaffold a full-stack project, but
inspect generated toolchain, SDK and node pins before adopting it.

## Generate types from the shipping ABI

Define `fuels.config.ts` with `createConfig`. Prefer a workspace or explicit
program lists, not both. Generate into a dedicated checked or reproducibly
generated directory:

```ts
import { createConfig } from 'fuels';

export default createConfig({
  workspace: './sway',
  output: './src/generated',
  forcBuildFlags: ['--release', '--locked'],
});
```

Check the installed CLI's config schema; options change. Treat `privateKey` and
deployment hooks as privileged server/build inputs, never browser configuration:
never bundle private keys, mnemonics or deployment keys into the client bundle.
If generated bindings are committed, fail CI on unexpected diffs. Ensure the
ABI and deployed bytecode/contract ID come from the same release build.

## Keep Next.js boundaries explicit

Mark wallet/provider components as client components. At `v0.103.0`, the
official demo wraps React Query and Fuel's provider:

```tsx
'use client';

import { defaultConnectors } from '@fuels/connectors';
import { FuelProvider } from '@fuels/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <FuelProvider fuelConfig={{ connectors: defaultConnectors() }}>
        {children}
      </FuelProvider>
    </QueryClientProvider>
  );
}
```

Use current hooks such as `useConnectors`, `useConnect`, `useDisconnect`,
`useIsConnected`, `useAccount` and `useBalance` only after confirming their
installed signatures. Handle hydration and disconnected/loading/error states.
`devMode: true` is a `defaultConnectors()` option that enables the development
wallet; do not assume it is appropriate outside local development.

## Bind provider, account and contract deliberately

- Use a provider for read-only calls.
- Use a connected account for state-changing calls.
- Validate chain ID/provider URL against the selected deployment.
- Construct generated contract instances with the exact contract ID and
  provider/account expected by the call.
- Use `.get()` for read-only execution where supported, `.simulate()` for a
  transaction-like preview, and `.call()` only for intended submission. At
  `v0.103.0`, `.dryRun()` and `getTransactionCost()` are deprecated (prefer
  `.get()` and `fundWithRequiredCoins`), and `addSigners` is deprecated in
  favor of explicitly added witnesses.
- Await `waitForResult()` and inspect status, value, receipts, gas and
  transaction ID; do not treat transaction creation as confirmation.

For calls that touch external contracts, pass typed generated contract
instances to `addContracts` when external logs/reverts must decode; a bare
contract ID adds the required transaction I/O but does not register the
external ABI. For payable calls, specify call parameters and variable outputs
deliberately.

## Build safe UX

Differentiate connector rejection, simulation revert, submission failure and
final on-chain failure; they are four distinct states, and only
`waitForResult()` settles the last one.

Test with `launchTestNode` from `fuels/test-utils` for deterministic local
integration, then run a separate smoke test against the target network. Cover
wallet disconnect/network change, wrong contract ID, insufficient resources,
reverts, receipt decoding, pending refresh, reordered predicate inputs and
concurrent UTXO selection.
