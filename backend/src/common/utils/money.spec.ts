import { InternalServerErrorException } from '@nestjs/common';
import { safeMoney } from './money';

describe('safeMoney', () => {
  it('converts a positive bigint to number', () => {
    expect(safeMoney(1000n)).toBe(1000);
  });

  it('converts a negative bigint to number', () => {
    expect(safeMoney(-500n)).toBe(-500);
  });

  it('converts zero bigint to 0', () => {
    expect(safeMoney(0n)).toBe(0);
  });

  it('returns 0 for null', () => {
    expect(safeMoney(null)).toBe(0);
  });

  it('returns 0 for undefined', () => {
    expect(safeMoney(undefined)).toBe(0);
  });

  it('accepts MAX_SAFE_INTEGER exactly', () => {
    expect(safeMoney(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('accepts -MAX_SAFE_INTEGER exactly', () => {
    expect(safeMoney(BigInt(-Number.MAX_SAFE_INTEGER))).toBe(-Number.MAX_SAFE_INTEGER);
  });

  it('throws InternalServerErrorException when value exceeds MAX_SAFE_INTEGER', () => {
    expect(() => safeMoney(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(InternalServerErrorException);
  });

  it('throws InternalServerErrorException when value is below -MAX_SAFE_INTEGER', () => {
    expect(() => safeMoney(BigInt(-Number.MAX_SAFE_INTEGER) - 1n)).toThrow(InternalServerErrorException);
  });
});
