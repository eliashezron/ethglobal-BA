export interface PartialFillComputation {
  readonly requested: bigint;
  readonly remainingBefore: bigint;
  readonly executed: bigint;
  readonly remainingAfter: bigint;
}

export function computePartialFill(requested: bigint, remaining: bigint): PartialFillComputation {
  if (requested <= 0n) {
    throw new Error('Requested quantity must be positive');
  }
  if (remaining <= 0n) {
    throw new Error('Order has no remaining size');
  }

  const executed = requested > remaining ? remaining : requested;
  const remainingAfter = remaining - executed;

  return {
    requested,
    remainingBefore: remaining,
    executed,
    remainingAfter,
  };
}

export const partialFillMath = {
  computePartialFill,
};

export default partialFillMath;
