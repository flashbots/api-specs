import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import mergeOpenRPC, { type MergeableDocument, type MergeableMethod } from "./merge-utils";

const ETHEREUM_DOC_URL =
  "https://raw.githubusercontent.com/ethereum/execution-apis/337eec34772dc15228092e032fd299042e1ece99/refs-openrpc.json";

const UNNEEDED_METHODS = [
  /eth_signTransaction/, // remove wallet specific methods
  /eth_sendTransaction/,
  /eth_sign/,
  /eth_accounts/,
  /debug_.*/, // remove debug namespace
  /engine_.*/, // remove engine namespace
];

const ETHEREUM_TAG = {
  name: "Ethereum API",
  description: "Ethereum Node JSON-RPC method",
};

const openRPCYamlPath = fileURLToPath(new URL("../openrpc.yaml", import.meta.url));
const buildDirPath = fileURLToPath(new URL("../src/build", import.meta.url));
const buildOutputPath = fileURLToPath(new URL("../src/build/openrpc.json", import.meta.url));

const loadLocalDocument = async (): Promise<MergeableDocument> => {
  const file = await readFile(openRPCYamlPath, "utf8");
  return yaml.load(file) as MergeableDocument;
};

const filterExecutionAPIs = (document: MergeableDocument): MergeableDocument => {
  const methods = document.methods ?? [];
  const filteredMethods = methods.filter((method) => {
    if (!method?.name) {
      return false;
    }
    return !UNNEEDED_METHODS.some((regex) => regex.test(method.name!));
  });
  return {
    ...document,
    methods: filteredMethods,
  };
};

const withEthereumTag = (methods: MergeableMethod[] = []): MergeableMethod[] =>
  methods.map((method) => ({
    ...method,
    tags: [ETHEREUM_TAG, ...(method.tags ?? [])],
  }));

const getFilteredExecutionAPIs = async (): Promise<MergeableDocument> => {
  const response = await fetch(ETHEREUM_DOC_URL);

  if (!response.ok) {
    throw new Error(`Failed to fetch Ethereum API OpenRPC document: ${response.statusText}`);
  }

  const payload = (await response.json()) as MergeableDocument;
  return {
    ...payload,
    methods: withEthereumTag(filterExecutionAPIs(payload).methods ?? []),
  };
};

export const generateOpenRPC = async (): Promise<void> => {
  const baseDocument = await loadLocalDocument();
  const ethereumDocument = await getFilteredExecutionAPIs();

  const mergedDocument = mergeOpenRPC(baseDocument, ethereumDocument);

  await mkdir(buildDirPath, { recursive: true });
  await writeFile(buildOutputPath, `${JSON.stringify(mergedDocument, null, 2)}\n`, "utf8");
};

if (import.meta.main) {
  generateOpenRPC().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
