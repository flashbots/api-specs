import testCoverage from "@open-rpc/test-coverage";
import ExamplesRule from "@open-rpc/test-coverage/build/rules/examples-rule";
import JsonSchemaFakerRule from "@open-rpc/test-coverage/build/rules/json-schema-faker-rule";
import { OpenrpcDocument } from "@open-rpc/meta-schema";
import { parseOpenRPCDocument } from "@open-rpc/schema-utils-js";
import mm from "../dist/build/openrpc.json";
import SendRawTransactionRule from "./custom-rules/send-raw-transaction-rule";

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
  new ExamplesRule(),
];

const main = async () => {
  const openrpcDocument = await parseOpenRPCDocument(OpenRPCDocument);
  const results = await testCoverage({
    openrpcDocument,
    transport: customTransport,
    reporters: ["console-streaming", "html"],
    rules,
  });
  results.every((r) => r.valid);
};

main();
