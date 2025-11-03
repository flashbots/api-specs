import testCoverage from "@open-rpc/test-coverage";
import { OpenrpcDocument } from "@open-rpc/meta-schema"
import mm from '../dist/build/openrpc.json';
import { parseOpenRPCDocument } from '@open-rpc/schema-utils-js'

const URL = "https://rpc-sepolia.flashbots.net"

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
}

const OpenRPCDocument = mm as OpenrpcDocument;

const main = async () => {
  const openrpcDocument = await parseOpenRPCDocument(OpenRPCDocument);
  const results = await testCoverage({
    openrpcDocument,
    transport: customTransport,
    reporters: [
      'console-streaming',
      'html'
    ]
  })
  results.every((r) => r.valid)
}

main();
