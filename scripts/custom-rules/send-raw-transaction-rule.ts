import type { Call } from "@open-rpc/test-coverage/build/coverage";
import type Rule from "@open-rpc/test-coverage/build/rules/rule";
import type { MethodObject, OpenrpcDocument } from "@open-rpc/meta-schema";
import { JsonRpcProvider, Wallet, parseUnits } from "ethers";

const DEFAULT_RPC_URL = "https://rpc-sepolia.flashbots.net";
const DEFAULT_GAS_LIMIT = BigInt(21000);
const DEFAULT_VALUE_WEI = BigInt(0);
const TX_HASH_REGEX = /^0x([A-Fa-f0-9]{64})$/;

const missingConfigMessage =
  "[SendRawTransactionRule] Missing ETHEREUM_PRIVATE_KEY; rule disabled.";

export default class SendRawTransactionRule implements Rule {
  private readonly privateKey?: string;
  private readonly rpcUrl: string;
  private readonly valueWei: bigint;
  private readonly gasLimit: bigint;
  private readonly isEnabled: boolean;
  private provider?: JsonRpcProvider;
  private wallet?: Wallet;
  private warned = false;

  constructor() {
    this.privateKey = process.env.ETHEREUM_PRIVATE_KEY;
    this.rpcUrl = process.env.COVERAGE_RPC_URL || DEFAULT_RPC_URL;

    this.valueWei = DEFAULT_VALUE_WEI;
    this.gasLimit = DEFAULT_GAS_LIMIT;
    this.isEnabled = Boolean(this.privateKey);
  }

  public getTitle(): string {
    return "Send raw transaction via ethers";
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
      throw new Error("SendRawTransactionRule requires ETHEREUM_PRIVATE_KEY");
    }
    if (!this.wallet) {
      this.wallet = new Wallet(this.privateKey, this.getProvider());
    }
    return this.wallet;
  }

  private async buildSignedTransaction(): Promise<{ signedTransaction: string; from: string }> {
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

    return {
      signedTransaction: await wallet.signTransaction(populated),
      from: wallet.address,
    };
  }

  public async getCalls(
    _openrpcDocument: OpenrpcDocument,
    method: MethodObject,
  ): Promise<Call[]> {
    if (method.name !== "eth_sendRawTransaction") {
      return [];
    }

    if (!this.isEnabled) {
      this.logMissingConfig();
      return [];
    }

    const { signedTransaction, from } = await this.buildSignedTransaction();

    return [
      {
        methodName: method.name,
        params: [signedTransaction],
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
                value: this.valueWei.toString(),
                gasLimit: this.gasLimit.toString(),
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
    if (call.methodName !== "eth_sendRawTransaction") {
      return call;
    }

    if (call.error) {
      call.valid = false;
      call.reason = `RPC error: ${JSON.stringify(call.error)}`;
      return call;
    }

    if (typeof call.result === "string" && TX_HASH_REGEX.test(call.result)) {
      call.valid = true;
      return call;
    }

    call.valid = false;
    call.reason = "Expected transaction hash string in result.";
    return call;
  }
}
