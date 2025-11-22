export function computePartialFill(requested, remaining) {
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
