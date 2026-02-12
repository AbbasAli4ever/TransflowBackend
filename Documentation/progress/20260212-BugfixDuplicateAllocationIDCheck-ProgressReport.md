# Progress Report - Bugfix: Duplicate Allocation ID Check - 2026-02-12

## Phase/Feature: Bugfix: Duplicate Allocation ID Check

## Reporting Period: 2026-02-12

## Status:
- [ ] On Track
- [ ] At Risk
- [ ] Delayed
- [x] Completed

## Achievements in this Period:
- Identified a bug where the `applyManualAllocations` function in `posting.service.ts` allowed multiple allocations to the same `transactionId` within a single request, leading to incorrect outstanding amounts.
- Implemented a 5-line duplicate-ID check at the top of `applyManualAllocations` to prevent this issue.
- The fix correctly throws a `422 Unprocessable Entity` error with the message 'Duplicate transactionId in allocations array' when duplicates are found.

## Blockers/Challenges:
- None

## Decisions Made:
- The fix involved adding a 5-line duplicate-ID check at the top of `applyManualAllocations` in `backend/src/transactions/posting.service.ts`. This check builds a `Set` of `transactionId`s from the input `allocations` array and throws a `422 Unprocessable Entity` error if the `Set` size does not match the array length. This runs before any database work, ensuring efficiency and immediate error detection for duplicate allocation attempts.

## Next Steps (for next reporting period):
- None specified.

## Metrics/Key Performance Indicators (if applicable):
- All tests passed, including the new test case specifically designed to reject allocating to the same invoice twice in one request.
- No regressions were introduced in other tests.

## Created By: zTracker (Progress Reporting Agent)
