/**
 * Pure calculation functions for the posting engine.
 * Extracted for unit testability. No side effects, no dependencies.
 */

/**
 * Weighted average cost formula used when purchasing inventory.
 * Formula: round((preStock × oldAvg + newQty × unitCost) / (preStock + newQty))
 * Edge case: if total stock after purchase would be 0, return unitCost directly.
 */
export function calculateWeightedAvgCost(
  preStock: number,
  oldAvg: number,
  newQty: number,
  unitCost: number,
): number {
  if (preStock + newQty === 0) return unitCost;
  return Math.round((preStock * oldAvg + newQty * unitCost) / (preStock + newQty));
}

/**
 * Effective unit cost for return lines.
 * Uses floor(lineTotal / qty) to derive per-unit cost from the discount-adjusted line total.
 * Falls back to unitCost if qty is 0 to avoid division by zero.
 */
export function calculateEffectiveUnitCost(lineTotal: number, qty: number, fallbackUnitCost = 0): number {
  return qty > 0 ? Math.floor(lineTotal / qty) : fallbackUnitCost;
}

/**
 * Avg cost recalculation after a customer return.
 * Mathematically equivalent to oldAvg (returning units at same avg cost),
 * but written explicitly to match the formula and handle edge cases.
 * Edge case: if stockBeforeReturn + returnQty = 0, return oldAvg unchanged.
 */
export function calculateReturnAvgCost(
  stockBeforeReturn: number,
  oldAvg: number,
  returnQty: number,
): number {
  if (stockBeforeReturn + returnQty === 0) return oldAvg;
  return Math.round(
    (stockBeforeReturn * oldAvg + returnQty * oldAvg) / (stockBeforeReturn + returnQty),
  );
}
