import testCoverage from "@open-rpc/test-coverage";
import ExamplesRule from "@open-rpc/test-coverage/build/rules/examples-rule";
import JsonSchemaFakerRule from "@open-rpc/test-coverage/build/rules/json-schema-faker-rule";
import HtmlReporter from '@open-rpc/test-coverage/build/reporters/html-reporter';
import { OpenrpcDocument } from "@open-rpc/meta-schema";
import { parseOpenRPCDocument } from "@open-rpc/schema-utils-js";
import mm from "../dist/build/openrpc.json";
import SendBundleRule from "./custom-rules/send-bundle-rule";
import SendRawTransactionRule from "./custom-rules/send-raw-transaction-rule";
import { applyExampleOverlays } from "./overlay";
import httpWithAuth from "./custom-transports/http-with-auth";

const DEFAULT_RPC_URL = "https://rpc-sepolia.flashbots.net";
const URL = process.env.COVERAGE_RPC_URL || DEFAULT_RPC_URL;

const OpenRPCDocument = mm as OpenrpcDocument;
if (!OpenRPCDocument) {
  throw new Error("No OpenRPC Document at dist/build/openrpc.json");
}

const rules = [
  new SendRawTransactionRule(),
  new SendBundleRule(),
  new JsonSchemaFakerRule(),
  new ExamplesRule({
    only: [],
    skip: ['eth_sendRawTransaction', 'eth_sendBundle']
  }),
];

const main = async () => {
  const workingDocument = await applyExampleOverlays(OpenRPCDocument, {
    rpcUrl: URL,
  });
  const openrpcDocument = await parseOpenRPCDocument(workingDocument);
  const results = await testCoverage({
    openrpcDocument,
    transport: httpWithAuth,
    reporters: [
      "console-streaming",
      new HtmlReporter({
        autoOpen: false
      }),
    ],
    rules,
    skip: [
      'eth_coinbase', // old deprecated -- for mining
      'eth_getBlockReceipts', // new method -- something going on with spec itself -- oneOf error
      'eth_getFilterLogs', // log ids are stateful -- not great to test
      'eth_getFilterChanges', // log ids are stateful -- not great to test
      'eth_getProof', // gets pruned
      'eth_getLogs', // gets pruned
      'eth_createAccessList', // gets pruned
    ]
  });
  const passed = results.every((r) => r.valid);
  if (!passed) {
    process.exit(1);
  }

  // happy path
  process.exit(0)
};

main();
