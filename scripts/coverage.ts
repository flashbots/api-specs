import testCoverage from "@open-rpc/test-coverage";
import ExamplesRule from "@open-rpc/test-coverage/build/rules/examples-rule";
import JsonSchemaFakerRule from "@open-rpc/test-coverage/build/rules/json-schema-faker-rule";
import HtmlReporter from '@open-rpc/test-coverage/build/reporters/html-reporter';
import { OpenrpcDocument } from "@open-rpc/meta-schema";
import { parseOpenRPCDocument } from "@open-rpc/schema-utils-js";
import mm from "../dist/build/openrpc.json";
import SendRawTransactionRule from "./custom-rules/send-raw-transaction-rule";
import { applyExampleOverlays } from "./overlay";

const DEFAULT_RPC_URL = "https://rpc-sepolia.flashbots.net";
const URL = process.env.COVERAGE_RPC_URL || DEFAULT_RPC_URL;

let id = 0;
const customTransport = async (_: string, method: string, params: any): Promise<any> => {
  return fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: id++,
      method,
      params,
    }),
  }).then((r: any) => {
    return r.json();
  });
};

const OpenRPCDocument = mm as OpenrpcDocument;
if (!OpenRPCDocument) {
  throw new Error("No OpenRPC Document at dist/build/openrpc.json");
}

const rules = [
  new SendRawTransactionRule(),
  new JsonSchemaFakerRule(),
  new ExamplesRule({
    only: [],
    skip: ['eth_sendRawTransaction']
  }),
];

const main = async () => {
  const workingDocument = await applyExampleOverlays(OpenRPCDocument, {
    rpcUrl: URL,
  });
  const openrpcDocument = await parseOpenRPCDocument(workingDocument);
  const results = await testCoverage({
    openrpcDocument,
    transport: customTransport,
    reporters: [
      "console-streaming",
      new HtmlReporter({
        autoOpen: false
      }),
    ],
    rules,
    skip: ['eth_getBlockReceipts', 'eth_getFilterLogs', 'eth_getFilterChanges', 'eth_getProof']
  });
  const passed = results.every((r) => r.valid);
  if (!passed) {
    process.exit(1);
  }

  // happy path
  process.exit(0)
};

main();
