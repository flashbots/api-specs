import type { Call } from "@open-rpc/test-coverage/build/coverage";
import type Rule from "@open-rpc/test-coverage/build/rules/rule";
import type { MethodObject, OpenrpcDocument } from "@open-rpc/meta-schema";
import Ajv from "ajv";
import { JsonRpcProvider, Wallet, parseUnits, toBeHex } from "ethers";

const DEFAULT_RPC_URL = "https://rpc-sepolia.flashbots.net";
const DEFAULT_GAS_LIMIT = BigInt(21000);
const DEFAULT_VALUE_WEI = BigInt(0);
const missingConfigMessage =
  "[SendBundleRule] Missing ETHEREUM_PRIVATE_KEY; rule disabled.";

type BundleParams = {
  txs: string[];
  blockNumber: string;
};

export default class SendBundleRule implements Rule {
  private readonly privateKey?: string;
  private readonly rpcUrl: string;
  private readonly valueWei: bigint;
  private readonly gasLimit: bigint;
  private readonly isEnabled: boolean;
  private provider?: JsonRpcProvider;
  private wallet?: Wallet;
  private readonly ajv = new Ajv({ allErrors: true });
  private warned = false;

  constructor() {
    this.privateKey = process.env.ETHEREUM_PRIVATE_KEY;
    this.rpcUrl = process.env.COVERAGE_RPC_URL || DEFAULT_RPC_URL;

    this.valueWei = DEFAULT_VALUE_WEI;
    this.gasLimit = DEFAULT_GAS_LIMIT;
    this.isEnabled = Boolean(this.privateKey);
  }

  public getTitle(): string {
    return "Send bundle via ethers";
  }

  private logMissingConfig(): void {
    if (!this.warned) {
      this.warned = true;
      console.warn(missingConfigMessage);
    }
  }

  private getProvider(): JsonRpcProvider {
    if (!this.provider) {
      this.provider = new JsonRpcProvider(this.rpcUrl);
    }
    return this.provider;
  }

  private getWallet(): Wallet {
    if (!this.privateKey) {
      throw new Error("SendBundleRule requires ETHEREUM_PRIVATE_KEY");
    }
    if (!this.wallet) {
      this.wallet = new Wallet(this.privateKey, this.getProvider());
    }
    return this.wallet;
  }

  private async buildBundle(): Promise<{ bundle: BundleParams; from: string }> {
    const wallet = this.getWallet();
    const targetAddress = wallet.address;
    const feeData = await this.getProvider().getFeeData();
    const fallbackPriority = parseUnits("1", "gwei");
    const fallbackFee = parseUnits("2", "gwei");

    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? fallbackPriority;
    const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? maxPriorityFeePerGas + fallbackFee;

    const populated = await wallet.populateTransaction({
      to: targetAddress,
      value: this.valueWei,
      gasLimit: this.gasLimit,
      maxPriorityFeePerGas,
      maxFeePerGas: maxFeePerGas >= maxPriorityFeePerGas ? maxFeePerGas : maxPriorityFeePerGas,
    });

    const currentBlock = await this.getProvider().getBlockNumber();
    const blockNumber = toBeHex(currentBlock + 1);
    const signedTransaction = await wallet.signTransaction(populated);

    return {
      bundle: {
        txs: [signedTransaction],
        blockNumber,
      },
      from: wallet.address,
    };
  }

  public async getCalls(
    _openrpcDocument: OpenrpcDocument,
    method: MethodObject,
  ): Promise<Call[]> {
    if (method.name !== "eth_sendBundle") {
      return [];
    }

    if (!this.isEnabled) {
      this.logMissingConfig();
      return [];
    }

    const { bundle, from } = await this.buildBundle();

    return [
      {
        methodName: method.name,
        params: [bundle],
        url: this.rpcUrl,
        title: this.getTitle(),
        resultSchema: method.result?.schema,
        rule: this,
        attachments: [
          {
            type: "text",
            data: JSON.stringify(
              {
                from,
                to: from,
                blockNumber: bundle.blockNumber,
                value: this.valueWei.toString(),
                gasLimit: this.gasLimit.toString(),
                txCount: bundle.txs.length,
              },
              null,
              2,
            ),
          },
        ],
      },
    ];
  }

  public validateCall(call: Call): Call {
    if (call.methodName !== "eth_sendBundle") {
      return call;
    }

    if (call.error) {
      call.valid = false;
      call.reason = `RPC error: ${JSON.stringify(call.error)}`;
      return call;
    }

    if (call.resultSchema) {
      const validSchema = this.ajv.validate(call.resultSchema as Record<string, unknown>, call.result);
      if (!validSchema) {
        call.valid = false;
        call.reason = `Result schema validation failed: ${this.ajv.errorsText(this.ajv.errors)}`;
        return call;
      }
    }

    call.valid = true;
    return call;
  }
}
