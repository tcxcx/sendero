import { parseGwei, type PublicClient } from 'viem';

const DEFAULT_MIN_PRIORITY_FEE = parseGwei('1');
const DEFAULT_MIN_MAX_FEE = parseGwei('15');

function envGwei(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  if (!raw) return fallback;

  try {
    return parseGwei(raw);
  } catch {
    return fallback;
  }
}

function maxBigInt(...values: bigint[]): bigint {
  return values.reduce((max, value) => (value > max ? value : max), values[0] ?? 0n);
}

/**
 * Arc's bundler precheck rejects stale fee caps. Keep the priority fee
 * at the documented floor, but source maxFeePerGas from the live Arc RPC
 * gas price and fall back above the current observed bundler floor.
 */
export function createArcUserOperationFeesEstimator(publicClient: PublicClient) {
  return async () => {
    const minPriorityFee = envGwei(
      'SENDERO_ARC_USEROP_MIN_PRIORITY_FEE_GWEI',
      DEFAULT_MIN_PRIORITY_FEE
    );
    const minMaxFee = envGwei('SENDERO_ARC_USEROP_MIN_MAX_FEE_GWEI', DEFAULT_MIN_MAX_FEE);

    let gasPrice = minMaxFee;
    try {
      gasPrice = await publicClient.getGasPrice();
    } catch {
      // Keep channel flow fail-soft; the bundler will surface a precise
      // precheck error if Arc's floor moves beyond our fallback.
    }

    return {
      maxFeePerGas: maxBigInt(gasPrice * 2n, minMaxFee, minPriorityFee * 2n),
      maxPriorityFeePerGas: minPriorityFee,
    };
  };
}
