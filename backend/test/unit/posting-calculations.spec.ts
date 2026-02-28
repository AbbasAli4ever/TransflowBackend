import {
  calculateWeightedAvgCost,
  calculateEffectiveUnitCost,
  calculateReturnAvgCost,
} from '../../src/transactions/posting-calculations';

describe('calculateWeightedAvgCost', () => {
  it('first purchase on zero stock uses unit cost directly', () => {
    expect(calculateWeightedAvgCost(0, 0, 10, 1000)).toBe(1000);
  });

  it('second purchase blends correctly: (10×1000 + 10×2000) / 20 = 1500', () => {
    expect(calculateWeightedAvgCost(10, 1000, 10, 2000)).toBe(1500);
  });

  it('rounds down when fraction < 0.5: (2×1000 + 1×1001) / 3 = 1000.33 → 1000', () => {
    expect(calculateWeightedAvgCost(2, 1000, 1, 1001)).toBe(1000);
  });

  it('rounds up when fraction >= 0.5: (2×1000 + 1×1002) / 3 = 1000.67 → 1001', () => {
    expect(calculateWeightedAvgCost(2, 1000, 1, 1002)).toBe(1001);
  });

  it('rounds at exactly 0.5: (2×1000 + 1×1001.5-equivalent) → rounds up', () => {
    // (2*1000 + 2*1001) / 4 = 4002/4 = 1000.5 → 1001
    expect(calculateWeightedAvgCost(2, 1000, 2, 1001)).toBe(1001);
  });

  it('single unit purchase with zero pre-stock sets avg exactly', () => {
    expect(calculateWeightedAvgCost(0, 0, 1, 500)).toBe(500);
  });

  it('large stock quantities do not lose precision', () => {
    // preStock=9999, oldAvg=1000, qty=1, cost=1 → (9999000+1)/10000 = 999.9001 → 1000
    expect(calculateWeightedAvgCost(9999, 1000, 1, 1)).toBe(1000);
  });

  it('unequal quantities: 10 @ 1000 + 5 @ 400 → (10000+2000)/15 = 800', () => {
    expect(calculateWeightedAvgCost(10, 1000, 5, 400)).toBe(800);
  });

  it('returns unitCost when both preStock and newQty are 0 (guard against div-by-zero)', () => {
    // Edge: if somehow called with qty=0 and preStock=0
    expect(calculateWeightedAvgCost(0, 0, 0, 999)).toBe(999);
  });
});

describe('calculateEffectiveUnitCost', () => {
  it('no discount: lineTotal = qty × unitCost → exact division', () => {
    expect(calculateEffectiveUnitCost(10000, 10)).toBe(1000);
  });

  it('with discount: lineTotal = 9000 (10×1000 - 1000 discount), qty=10 → floor(900) = 900', () => {
    expect(calculateEffectiveUnitCost(9000, 10)).toBe(900);
  });

  it('non-divisible: floor(10001/3) = 3333', () => {
    expect(calculateEffectiveUnitCost(10001, 3)).toBe(3333);
  });

  it('zero qty returns fallback to avoid divide-by-zero', () => {
    expect(calculateEffectiveUnitCost(5000, 0)).toBe(0);
    expect(calculateEffectiveUnitCost(5000, 0, 1200)).toBe(1200);
  });

  it('lineTotal=0 with valid qty returns 0', () => {
    expect(calculateEffectiveUnitCost(0, 5)).toBe(0);
  });

  it('single unit: lineTotal = unitCost exactly', () => {
    expect(calculateEffectiveUnitCost(1500, 1)).toBe(1500);
  });
});

describe('calculateReturnAvgCost', () => {
  it('returning units keeps avg cost unchanged (mathematically neutral)', () => {
    // (5 × 1500 + 5 × 1500) / (5+5) = 1500
    expect(calculateReturnAvgCost(5, 1500, 5)).toBe(1500);
  });

  it('partial return keeps avg cost unchanged', () => {
    expect(calculateReturnAvgCost(8, 1200, 2)).toBe(1200);
  });

  it('returns oldAvg when stockBeforeReturn + returnQty = 0 (guard)', () => {
    // stockBefore=0, return 5 would make denominator 5 (not 0), so guard doesn't apply
    // Real guard case: stockBefore=0, returnQty=0 → denominator=0
    expect(calculateReturnAvgCost(0, 1500, 0)).toBe(1500);
  });

  it('full return (stockBefore=0, returnQty=qty) still returns oldAvg', () => {
    // All stock was sold, customer returns everything
    // stockBefore=0 (no stock left), returnQty=10
    // (0 * oldAvg + 10 * oldAvg) / 10 = oldAvg ✓
    expect(calculateReturnAvgCost(0, 1500, 10)).toBe(1500);
  });
});
