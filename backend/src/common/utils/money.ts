import { InternalServerErrorException } from '@nestjs/common';

const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const MIN = BigInt(-Number.MAX_SAFE_INTEGER);

/**
 * Converts a SQL bigint aggregate to a JavaScript number.
 *
 * Invariant: monetary values must be representable as exact integers in JS.
 * If the value exceeds Number.MAX_SAFE_INTEGER (±9,007,199,254,740,991),
 * silent precision loss would occur — throw instead.
 */
export function safeMoney(value: bigint | null | undefined): number {
  const v = value ?? 0n;
  if (v > MAX || v < MIN) {
    throw new InternalServerErrorException('Monetary value exceeds safe precision range');
  }
  return Number(v);
}
