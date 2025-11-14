# Flashbots JSON-RPC API Specification

This repository contains the OpenRPC specification for Flashbots' JSON-RPC API.
You can view the specs in the following formats:

- [Latest build](https://flashbots.github.io/api-specs/latest/openrpc.json)
- [Playground With latest build](https://playground.open-rpc.org/?schemaUrl=https://flashbots.github.io/api-specs/latest/openrpc.json&uiSchema[appBar][ui:splitView]=false&uiSchema[appBar][ui:input]=false&uiSchema[appBar][ui:examplesDropdown]=false&uiSchema[appBar][ui:transports]=false&uiSchema[appBar][ui:edit]=false&uiSchema[appBar][ui:title]=Flashbots&uiSchema[appBar][ui:logoUrl]=https://docs.flashbots.net/img/brand-assets/flashbots_icon.png)

[OpenRPC](https://open-rpc.org/) is way to specify JSON-RPC APIs that is versionable,
human-readable, and machine-readable.
It improves the accuracy of documentation, APIs, and clients.

## Contribute

You can contribute to the API specs using the following steps.

1. Edit the API specs in the `openrpc.yaml` file.
   See the [OpenRPC](https://open-rpc.org/) docs for more information on how to format the specs.
2. Run `bun install` if you haven't previously set up the repository.
3. Run `bun run build` to re-generate the output file: `dist/build/openrpc.json`.
4. To view the result, paste that file's contents into the
 [OpenRPC playground](https://playground.open-rpc.org/).

Run `bun test` to execute the unit tests, or `bun run build:watch` to rebuild whenever sources change. Run `bun run coverage` to execute `scripts/coverage.ts`, which drives the OpenRPC coverage suite, streams results to the console, and refreshes the HTML report (requires network access).

### Coverage sendRawTransaction rule

The coverage runner can optionally broadcast a real `eth_sendRawTransaction` call using `ethers`. Set `ETHEREUM_PRIVATE_KEY` (hex string) before running `bun run coverage` to enable it. The transaction uses the same account as sender and recipient, a 0 wei value, 21,000 gas limit, and the standard coverage RPC URL unless overridden globally via `COVERAGE_RPC_URL`. Without the private key the rule is skipped and coverage falls back to the default example/schema-based tests.

## Build process

When you build the project, the following happens:

1. The API specs `openrpc.yaml` are loaded from the local file system.
2. The [Ethereum Execution API specs](https://github.com/ethereum/execution-apis) are
   fetched from a remote URL and methods not supported/implemented by Flashbots are filtered out.
3. The local Flashbots specs are merged with the Ethereum specs.
4. Each Ethereum method is tagged with the "Ethereum API" tag.
5. The merged and filtered specs are written out to temporary files:

- `src/build/openrpc.json`

6. These files are output to the `dist` folder and the `src/build` contents are deleted.

## Running the api spec tests via actions
If you have permissions you can follow the guide here: https://www.notion.so/flashbots/Running-API-Spec-Tests-for-protect-2ab6b4a0d876800b9be5f57233fc6a4a?showMoveTo=true&saveParent=true

## Publishing process

On release, the specs are published to npm at `@flashbots/api-specs` and to
[GitHub Pages](https://flashbots.github.io/api-specs/latest/openrpc.json).

## Resources

This is based on the [MetaMask API specs repo](https://github.com/MetaMask/api-specs).
