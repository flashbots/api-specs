import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { JSONPath } from "jsonpath-plus";
import type { OpenrpcDocument } from "@open-rpc/meta-schema";

const OVERLAYS_ROOT_DIR = fileURLToPath(new URL("../overlays", import.meta.url));


export type OverlayAction =
  | { target: string; set: unknown }
  | { target: string; merge: Record<string, unknown> }
  | { target: string; remove: true };

export type ApplyExampleOverlayOptions = {
  rpcUrl?: string;
};

type JsonPathMatch = {
  parent: any;
  parentProperty: string | number;
  value: unknown;
};

export const DEFAULT_RPC_URL = "https://rpc-sepolia.flashbots.net";

const normalizeChainId = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Chain ID string cannot be empty");
  }

  try {
    return BigInt(trimmed).toString(10);
  } catch {
    return trimmed;
  }
};

const resolveOverlayChainId = async (
  rpcUrl?: string,
): Promise<string | undefined> => {
  if (!rpcUrl) {
    return undefined;
  }

  try {
    const rawChainId = await jsonRpcRequest<string>(rpcUrl, "eth_chainId", []);
    return normalizeChainId(rawChainId);
  } catch (error) {
    console.warn(
      `Failed to determine chainId from ${rpcUrl}, falling back to global overlays:`,
      error,
    );
    return undefined;
  }
};

const selectNodes = (doc: unknown, path: string): JsonPathMatch[] => {
  const results = JSONPath({
    json: doc,
    path,
    resultType: "all",
  }) as JsonPathMatch[];

  if (!results.length) {
    throw new Error(`JSONPath ${path} did not match anything`);
  }

  return results;
};

const applyAction = (match: JsonPathMatch, action: OverlayAction): void => {
  const { parent, parentProperty } = match;

  if (!parent || parentProperty === undefined) {
    throw new Error(`Cannot mutate root node for ${action.target}`);
  }

  if ("remove" in action) {
    if (Array.isArray(parent)) {
      parent.splice(Number(parentProperty), 1);
    } else {
      delete parent[parentProperty];
    }
    return;
  }

  if ("merge" in action) {
    if (Array.isArray(parent)) {
      throw new Error(`Cannot merge object into array at ${action.target}`);
    }
    const current = parent[parentProperty];
    parent[parentProperty] = {
      ...(typeof current === "object" && current ? current : {}),
      ...action.merge,
    };
    return;
  }

  if (Array.isArray(parent)) {
    parent[Number(parentProperty)] = action.set;
  } else {
    parent[parentProperty] = action.set;
  }
};

export const applyJsonPathOverlay = <T>(doc: T, actions: OverlayAction[]): T => {
  for (const action of actions) {
    const matches = selectNodes(doc, action.target);
    for (const match of matches) {
      applyAction(match, action);
    }
  }
  return doc;
};

const parseOverlayFile = (contents: string, ext: string): OverlayAction[] => {
  const parsed =
    ext === "json"
      ? (JSON.parse(contents) as OverlayAction | OverlayAction[])
      : (yaml.load(contents) as OverlayAction | OverlayAction[]);

  return Array.isArray(parsed) ? parsed : [parsed];
};

const loadOverlayActions = async (
  dir: string,
  recursive = false,
): Promise<OverlayAction[]> => {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const actions: OverlayAction[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }

      if (entry.isDirectory()) {
        if (recursive) {
          actions.push(...(await loadOverlayActions(join(dir, entry.name), true)));
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }
      const ext = entry.name.split(".").pop()?.toLowerCase();
      if (!ext || !["json", "yaml", "yml"].includes(ext)) {
        continue;
      }

      const raw = await readFile(join(dir, entry.name), "utf8");
      actions.push(...parseOverlayFile(raw, ext));
    }

    return actions;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

export const applyExampleOverlays = async (
  document: OpenrpcDocument,
  options: ApplyExampleOverlayOptions = {},
): Promise<OpenrpcDocument> => {
  const actions: OverlayAction[] = [];

  actions.push(...(await loadOverlayActions(OVERLAYS_ROOT_DIR)));

  const chainId = await resolveOverlayChainId(options.rpcUrl);
  if (chainId) {
    const chainDir = join(OVERLAYS_ROOT_DIR, chainId);
    actions.push(...(await loadOverlayActions(chainDir, true)));
  }

  if (actions.length === 0) {
    return document;
  }

  const clone = JSON.parse(JSON.stringify(document)) as OpenrpcDocument;
  return applyJsonPathOverlay(clone, actions);
};

export async function jsonRpcRequest<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC request to ${rpcUrl} failed with status ${response.status}: ${response.statusText}`);
  }

  const payload = (await response.json()) as { result?: T; error?: { code: number; message: string; data?: unknown } };
  if (payload.error) {
    const extra = payload.error.data ? `: ${JSON.stringify(payload.error.data)}` : "";
    throw new Error(`RPC error (${payload.error.code}) ${payload.error.message}${extra}`);
  }
  if (payload.result === undefined) {
    throw new Error(`RPC response from ${rpcUrl} missing result for method ${method}`);
  }
  return payload.result;
}

type ExampleParam = { name: string; value: unknown };
type OverlayExample = {
  params: ExampleParam[];
  resultName: string;
  resultValue: unknown;
  description?: string;
  target?: string;
};

type LogsContext = {
  blockNumber: string;
  request: Record<string, unknown>;
  logs: unknown[];
};

type NetworkContext = {
  rpcUrl: string;
  label: string;
  chainId: string;
  chainDir: string;
  blockNumber: string;
  blockHash: string;
  block: Record<string, unknown>;
  txHash: string;
  txIndex: string;
  sampleTx?: Record<string, unknown>;
  logs?: LogsContext;
};

export type BlockOverlayConfig = {
  rpcUrl: string;
  blockNumber?: string;
  label?: string;
};

export const generateBlockExampleOverlays = async (
  configs: BlockOverlayConfig[],
): Promise<void> => {
  for (const config of configs) {
    const ctx = await buildNetworkContext(config);
    await generateBlockExamples(ctx);
    await generateTransactionExamples(ctx);
    await generateLogsExample(ctx);
    await generateProofExample(ctx);
    await generateFilterExamples(ctx);
    await generateEstimateGasExample(ctx);
    await generateCreateAccessListExample(ctx);
  }
};

const buildNetworkContext = async (config: BlockOverlayConfig): Promise<NetworkContext> => {
  const rpcUrl = config.rpcUrl;
  const rawChainId = await jsonRpcRequest<string>(rpcUrl, "eth_chainId", []);
  const chainId = normalizeChainId(rawChainId);
  const label = config.label ?? `${rpcUrl} (chainId ${rawChainId})`;
  const headBlock =
    config.blockNumber ?? (await jsonRpcRequest<string>(rpcUrl, "eth_blockNumber", []));
  const blockCandidate = await findBlockWithTransactions(rpcUrl, headBlock);
  const hashValue = blockCandidate.block.hash;
  if (typeof hashValue !== "string") {
    throw new Error("Selected block is missing a hash");
  }
  const blockHash = hashValue;
  const txHash = extractTransactionHash(blockCandidate.block);
  const sampleTx = await jsonRpcRequest<Record<string, unknown>>(rpcUrl, "eth_getTransactionByHash", [
    txHash,
  ]);
  const logs = await findLogsCandidate(rpcUrl, blockCandidate.block, blockCandidate.number);

  return {
    rpcUrl,
    label,
    chainId,
    chainDir: join("overlays", chainId),
    blockNumber: blockCandidate.number,
    blockHash,
    block: blockCandidate.block,
    txHash,
    txIndex: "0x0",
    sampleTx,
    logs,
  };
};

const findBlockWithTransactions = async (
  rpcUrl: string,
  startBlock: string,
): Promise<{ number: string; block: Record<string, unknown> }> => {
  let current = hexToBigInt(startBlock);
  for (let i = 0; i < 64; i += 1) {
    if (current < 0n) {
      break;
    }
    const candidate = `0x${current.toString(16)}`;
    const block = await jsonRpcRequest<Record<string, unknown>>(rpcUrl, "eth_getBlockByNumber", [
      candidate,
      false,
    ]);
    const transactions = Array.isArray(block?.transactions) ? block.transactions : [];
    if (block && transactions.length) {
      return { number: block.number ?? candidate, block };
    }
    current -= 1n;
  }
  throw new Error(`Failed to find block with transactions near ${startBlock} (${rpcUrl})`);
};

const findLogsCandidate = async (
  rpcUrl: string,
  block: Record<string, unknown>,
  fallbackNumber: string,
): Promise<LogsContext | undefined> => {
  const hash = typeof block.hash === "string" ? block.hash : undefined;
  if (!hash) {
    return undefined;
  }

  const request = { blockHash: hash };
  const logs = await safeGetLogs(rpcUrl, request);
  if (logs.length) {
    return { blockNumber: block.number ?? fallbackNumber, request, logs };
  }

  let current = hexToBigInt(fallbackNumber) - 1n;
  for (let i = 0; i < 64; i += 1) {
    if (current < 0n) {
      return undefined;
    }
    const candidate = `0x${current.toString(16)}`;
    const nextBlock = await jsonRpcRequest<Record<string, unknown>>(rpcUrl, "eth_getBlockByNumber", [
      candidate,
      false,
    ]);
    if (!nextBlock?.hash) {
      current -= 1n;
      continue;
    }
    const nextRequest = { blockHash: nextBlock.hash as string };
    const nextLogs = await safeGetLogs(rpcUrl, nextRequest);
    if (nextLogs.length) {
      return {
        blockNumber: nextBlock.number ?? candidate,
        request: nextRequest,
        logs: nextLogs,
      };
    }
    current -= 1n;
  }

  return undefined;
};

const safeGetLogs = async (
  rpcUrl: string,
  filter: Record<string, unknown>,
): Promise<unknown[]> => {
  try {
    const logs = await jsonRpcRequest<unknown[]>(rpcUrl, "eth_getLogs", [filter]);
    return Array.isArray(logs) ? logs : [];
  } catch {
    return [];
  }
};


const extractTransactionHash = (block: Record<string, unknown>): string => {
  const transactions = Array.isArray(block.transactions) ? block.transactions : [];
  const first = transactions.find((tx) => typeof tx === "string");
  if (typeof first === "string") {
    return first;
  }
  throw new Error("Selected block does not expose transaction hashes");
};

const hexToBigInt = (value: string): bigint => {
  try {
    return BigInt(value);
  } catch {
    throw new Error(`Invalid hex value: ${value}`);
  }
};

const generateBlockExamples = async (ctx: NetworkContext): Promise<void> => {
  await writeOverlay(ctx, "eth_getBlockByNumber", {
    params: [
      { name: "Block", value: ctx.blockNumber },
      { name: "Hydrated transactions", value: false },
    ],
    resultName: "Block information",
    resultValue: ctx.block,
  });

  const blockByHash = await jsonRpcRequest<Record<string, unknown>>(ctx.rpcUrl, "eth_getBlockByHash", [
    ctx.blockHash,
    false,
  ]);

  await writeOverlay(ctx, "eth_getBlockByHash", {
    params: [
      { name: "Block hash", value: ctx.blockHash },
      { name: "Hydrated transactions", value: false },
    ],
    resultName: "Block information",
    resultValue: blockByHash,
  });
};

const generateTransactionExamples = async (ctx: NetworkContext): Promise<void> => {
  const byNumber = await jsonRpcRequest<Record<string, unknown>>(
    ctx.rpcUrl,
    "eth_getTransactionByBlockNumberAndIndex",
    [ctx.blockNumber, ctx.txIndex],
  );

  await writeOverlay(ctx, "eth_getTransactionByBlockNumberAndIndex", {
    params: [
      { name: "Block", value: ctx.blockNumber },
      { name: "Transaction index", value: ctx.txIndex },
    ],
    resultName: "Transaction",
    resultValue: byNumber,
  });

  const byHashAndIndex = await jsonRpcRequest<Record<string, unknown>>(
    ctx.rpcUrl,
    "eth_getTransactionByBlockHashAndIndex",
    [ctx.blockHash, ctx.txIndex],
  );

  await writeOverlay(ctx, "eth_getTransactionByBlockHashAndIndex", {
    params: [
      { name: "Block hash", value: ctx.blockHash },
      { name: "Transaction index", value: ctx.txIndex },
    ],
    resultName: "Transaction",
    resultValue: byHashAndIndex,
  });

  const tx = await jsonRpcRequest<Record<string, unknown>>(ctx.rpcUrl, "eth_getTransactionByHash", [
    ctx.txHash,
  ]);

  await writeOverlay(ctx, "eth_getTransactionByHash", {
    params: [{ name: "Transaction hash", value: ctx.txHash }],
    resultName: "Transaction",
    resultValue: tx,
  });
};

const generateLogsExample = async (ctx: NetworkContext): Promise<void> => {
  if (!ctx.logs) {
    console.warn(`Skipping eth_getLogs for ${ctx.rpcUrl} (no logs found)`);
    return;
  }

  await writeOverlay(ctx, "eth_getLogs", {
    params: [{ name: "Filter", value: ctx.logs.request }],
    description: `Logs fetched for block ${ctx.logs.blockNumber} from ${ctx.label}`,
    resultName: "Logs",
    resultValue: ctx.logs.logs,
  });
};

const generateProofExample = async (ctx: NetworkContext): Promise<void> => {
  const account = typeof ctx.block.miner === "string" ? ctx.block.miner : undefined;
  if (!account) {
    console.warn(`Skipping eth_getProof for ${ctx.rpcUrl} (missing miner address)`);
    return;
  }

  const proof = await jsonRpcRequest<Record<string, unknown>>(ctx.rpcUrl, "eth_getProof", [
    account,
    [],
    ctx.blockNumber,
  ]);

  await writeOverlay(ctx, "eth_getProof", {
    params: [
      { name: "Address", value: account },
      { name: "Storage keys", value: [] },
      { name: "Block", value: ctx.blockNumber },
    ],
    resultName: "Account proof",
    resultValue: proof,
  });
};

const generateFilterExamples = async (ctx: NetworkContext): Promise<void> => {
  if (!ctx.logs?.logs.length) {
    console.warn(`Skipping filter examples for ${ctx.rpcUrl} (no logs to anchor filter)`);
    return;
  }

  const firstLog = ctx.logs.logs[0] as Record<string, unknown>;
  const filterParams: Record<string, unknown> = {
    fromBlock: ctx.logs.blockNumber,
    toBlock: ctx.logs.blockNumber,
  };

  if (typeof firstLog.address === "string") {
    filterParams.address = firstLog.address;
  }
  const topics = Array.isArray(firstLog.topics) && firstLog.topics.length ? [firstLog.topics[0]] : undefined;
  if (topics) {
    filterParams.topics = topics;
  }

  const filterId = await jsonRpcRequest<string>(ctx.rpcUrl, "eth_newFilter", [filterParams]);
  const changes = await jsonRpcRequest<unknown[]>(ctx.rpcUrl, "eth_getFilterChanges", [filterId]);
  await writeOverlay(ctx, "eth_getFilterChanges", {
    params: [{ name: "Filter id", value: filterId }],
    description: `Filter changes for block ${ctx.logs.blockNumber}`,
    resultName: "Filter changes",
    resultValue: changes,
  });

  const logs = await jsonRpcRequest<unknown[]>(ctx.rpcUrl, "eth_getFilterLogs", [filterId]);
  await writeOverlay(ctx, "eth_getFilterLogs", {
    params: [{ name: "Filter id", value: filterId }],
    description: `Filter logs for block ${ctx.logs.blockNumber}`,
    resultName: "Filter logs",
    resultValue: logs,
  });
};

const generateEstimateGasExample = async (ctx: NetworkContext): Promise<void> => {
  const sender = typeof ctx.block.miner === "string" ? ctx.block.miner : undefined;
  if (!sender) {
    console.warn(`Skipping eth_estimateGas for ${ctx.rpcUrl} (missing miner address)`);
    return;
  }

  const tx = {
    from: sender,
    to: sender,
    value: "0x0",
  };

  const estimate = await jsonRpcRequest<string>(ctx.rpcUrl, "eth_estimateGas", [tx]);

  await writeOverlay(ctx, "eth_estimateGas", {
    params: [{ name: "Transaction", value: tx }],
    resultName: "Estimated gas",
    resultValue: estimate,
  });
};

const generateCreateAccessListExample = async (ctx: NetworkContext): Promise<void> => {
  const baseTx = ctx.sampleTx;
  if (!baseTx) {
    console.warn(`Skipping eth_createAccessList for ${ctx.rpcUrl} (no sample transaction available)`);
    return;
  }

  const tx: Record<string, unknown> = {};
  const graft = [
    "from",
    "to",
    "gas",
    "gasPrice",
    "maxFeePerGas",
    "maxPriorityFeePerGas",
    "value",
    "data",
  ];
  for (const field of graft) {
    if (typeof baseTx[field] === "string" && baseTx[field] !== "0x") {
      tx[field] = baseTx[field];
    }
  }

  if (tx.gasPrice && (tx.maxFeePerGas || tx.maxPriorityFeePerGas)) {
    delete tx.gasPrice;
  }

  if (!tx.from || !tx.to) {
    console.warn(`Skipping eth_createAccessList for ${ctx.rpcUrl} (sample transaction missing required fields)`);
    return;
  }

  const result = await jsonRpcRequest<Record<string, unknown>>(ctx.rpcUrl, "eth_createAccessList", [
    tx,
    ctx.blockNumber,
  ]);

  await writeOverlay(ctx, "eth_createAccessList", {
    params: [
      { name: "Transaction", value: tx },
      { name: "Block", value: ctx.blockNumber },
    ],
    resultName: "Access list information",
    resultValue: result,
  });
};

const writeOverlay = async (
  ctx: NetworkContext,
  methodName: string,
  example: OverlayExample,
): Promise<void> => {
  const overlayAction: OverlayAction = {
    target: example.target ?? defaultTargetForMethod(methodName),
    set: {
      name: methodName,
      description:
        example.description ?? `Example generated from ${ctx.label} at block ${ctx.blockNumber}`,
      params: example.params,
      result: {
        name: example.resultName,
        value: example.resultValue,
      },
    },
  };

  const filePath = join(ctx.chainDir, `${sanitizeMethodName(methodName)}.yaml`);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, yaml.dump(overlayAction, { lineWidth: -1 }), "utf8");
  console.log(`Wrote overlay for ${methodName} -> ${filePath}`);
};

const defaultTargetForMethod = (methodName: string): string =>
  `$.methods[?(@.name=='${methodName}')].examples[0]`;

const sanitizeMethodName = (methodName: string): string =>
  methodName.replace(/[^A-Za-z0-9_.-]/g, "_");

if (import.meta.main) {
  const raw = process.env.OVERLAY_NETWORKS;
  let configs: BlockOverlayConfig[] = [];

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as BlockOverlayConfig | BlockOverlayConfig[];
      configs = Array.isArray(parsed) ? parsed : [parsed];
    } catch (error) {
      console.error("Failed to parse OVERLAY_NETWORKS JSON:", error);
      process.exitCode = 1;
      process.exit();
    }
  }

  if (configs.length === 0) {
    configs = [
      {
        rpcUrl: process.env.COVERAGE_RPC_URL || DEFAULT_RPC_URL,
      },
    ];
  }

  generateBlockExampleOverlays(configs).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
