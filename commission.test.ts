import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeBreakdown, toBps } from '../src/services/money';
import { toCsv, csvCell } from '../src/utils/csv';

describe('commission arithmetic (services/money.ts)', () => {
  it('the exact example: 10,000 ETB', () => {
    const b = computeBreakdown(10_000, 0.1, 0.05);
    assert.equal(b.priceETB, 10_000);
    assert.equal(b.sellerCommissionETB, 1_000); // 10% seller commission
    assert.equal(b.sellerNetETB, 9_000); // seller receives
    assert.equal(b.buyerFeeETB, 500); // 5% buyer fee
    assert.equal(b.buyerTotalETB, 10_500); // buyer pays
    assert.equal(b.revenueETB, 1_500); // total Truth Market commission revenue
  });

  it('the buyer fee is never taken from the seller and the commission is never taken twice', () => {
    const withFee = computeBreakdown(10_000, 0.1, 0.05);
    const noFee = computeBreakdown(10_000, 0.1, 0);
    assert.equal(withFee.sellerNetETB, noFee.sellerNetETB, 'the buyer fee must not change what the seller receives');
    assert.equal(withFee.sellerCommissionETB, noFee.sellerCommissionETB, 'the buyer fee must not change the seller commission');
    assert.notEqual(withFee.sellerNetETB, 10_000 - 1_000 - 500);
    assert.equal(withFee.sellerNetETB, withFee.priceETB - withFee.sellerCommissionETB); // exactly one deduction
  });

  it('what the buyer pays always equals seller net + Truth Market revenue, to the birr, for any price', () => {
    for (const price of [1, 7, 99, 100, 333, 1_234, 9_999, 10_001, 123_457, 99_999_999]) {
      const b = computeBreakdown(price, 0.1, 0.05);
      assert.equal(b.buyerTotalETB, b.sellerNetETB + b.revenueETB, `price ${price}`);
      assert.ok(Number.isInteger(b.sellerCommissionETB) && Number.isInteger(b.buyerFeeETB));
    }
  });

  it('rounds to whole birr and avoids floating point noise (0.1 * 3 style errors)', () => {
    assert.equal(toBps(0.1), 1000);
    assert.equal(toBps(0.05), 500);
    assert.equal(computeBreakdown(3, 0.1, 0.05).sellerCommissionETB, 0); // 0.3 -> 0
    assert.equal(computeBreakdown(5, 0.1, 0.05).sellerCommissionETB, 1); // 0.5 -> 1
    assert.equal(computeBreakdown(7_777, 0.1, 0.05).sellerCommissionETB, 778); // 777.7
    assert.equal(computeBreakdown(7_777, 0.1, 0.05).buyerFeeETB, 389); // 388.85
  });

  it('listings under 1,000 ETB carry a flat 100 ETB buyer fee; from 1,000 it is 5% again; the seller 10% is unchanged', () => {
    const a = computeBreakdown(150, 0.1, 0.05);
    assert.equal(a.buyerFeeETB, 100);
    assert.equal(a.buyerTotalETB, 250);
    assert.equal(a.buyerFeeFlat, true);
    assert.equal(a.sellerCommissionETB, 15);
    assert.equal(a.sellerNetETB, 135);
    assert.equal(a.revenueETB, 115);
    assert.equal(a.buyerTotalETB, a.sellerNetETB + a.revenueETB);
    assert.equal(computeBreakdown(999, 0.1, 0.05).buyerTotalETB, 1_099);
    assert.equal(computeBreakdown(1, 0.1, 0.05).buyerTotalETB, 101);
    const edge = computeBreakdown(1_000, 0.1, 0.05);
    assert.equal(edge.buyerFeeETB, 50);
    assert.equal(edge.buyerFeeFlat, false);
    assert.equal(computeBreakdown(10_000, 0.1, 0.05).buyerFeeETB, 500);
    assert.equal(computeBreakdown(150, 0.1, 0).buyerFeeETB, 0, 'a switched-off buyer fee stays off');
  });

  it('refuses nonsense input', () => {
    assert.throws(() => computeBreakdown(0, 0.1, 0.05), RangeError);
    assert.throws(() => computeBreakdown(100.5, 0.1, 0.05), RangeError);
    assert.throws(() => computeBreakdown(100, -0.1, 0.05), RangeError);
    assert.throws(() => computeBreakdown(100, 0.1, 0.9), RangeError);
  });

  it('other rates still reconcile (admin changed the settings)', () => {
    const b = computeBreakdown(10_000, 0.12, 0.03);
    assert.deepEqual([b.sellerCommissionETB, b.sellerNetETB, b.buyerFeeETB, b.buyerTotalETB, b.revenueETB], [1_200, 8_800, 300, 10_300, 1_500]);
  });
});

describe('CSV export safety', () => {
  it('neutralises spreadsheet formulas and quotes special characters', () => {
    assert.equal(csvCell('=HYPERLINK("http://evil","x")'), `"'=HYPERLINK(""http://evil"",""x"")"`);
    for (const bad of ['+1', '-1+2', '@SUM(A1)', '\tcmd']) assert.ok(csvCell(bad).startsWith("'"), bad);
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell(1500), '1500');
    assert.equal(csvCell(null), '');
    const csv = toCsv([{ key: 'a', header: 'A' }], [{ a: '=1+1' }]);
    assert.ok(csv.includes("'=1+1"));
  });
});
