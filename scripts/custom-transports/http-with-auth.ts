import { Wallet, id } from "ethers";
const DEFAULT_RPC_URL = "https://rpc-sepolia.flashbots.net";
const URL = process.env.COVERAGE_RPC_URL || DEFAULT_RPC_URL;

let _id = 0;

export default async (_: string, method: string, params: any): Promise<any> => {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: _id++,
    method,
    params,
  });
  if (process.env.ETHEREUM_PRIVATE_KEY) {
    const wallet = new Wallet(process.env.ETHEREUM_PRIVATE_KEY);
    const payload = id(body);
    const signedPayload = await wallet.signMessage(payload);
    const signature = `${wallet.address}:${signedPayload}`;
    const r = await fetch(URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Flashbots-Signature": signature,
      },
      body,
    })
    return r.json();
  }

  const result = await fetch(URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
  });
  return result.json();
};
