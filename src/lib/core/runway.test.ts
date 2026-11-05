import { describe, expect, it } from "vitest";
import { computeBurn, computeRunway, expandPlanned } from "./runway";

const semester = expandPlanned(
  [{ label: "Biaya semester", amount: 9_000_000, due_on: "2027-02-14", repeat_months: 6, repeat_until: "2028-02-14", paid_occurrences: [] }],
  "2028-07-14",
);

describe("expandPlanned (F-06.2)", () => {
  it("repeats every 6 months until the stop date: 3 occurrences, Rp 27.000.000", () => {
    expect(semester.map((o) => o.date)).toEqual(["2027-02-14", "2027-08-14", "2028-02-14"]);
    expect(semester.reduce((a, o) => a + o.amount, 0)).toBe(27_000_000);
  });
  it("without a stop date, stops at graduation + 24 months", () => {
    const occ = expandPlanned(
      [{ label: "x", amount: 1, due_on: "2027-01-01", repeat_months: 12, repeat_until: null, paid_occurrences: [] }],
      "2028-07-14",
    );
    expect(occ.at(-1)!.date).toBe("2030-01-01");
  });
});

describe("computeRunway golden (section 5.5, today 14 Nov 2026)", () => {
  const r = computeRunway({
    today: "2026-11-14",
    graduation: "2028-07-14",
    reserve: 30_000_000,
    funds: 287_000_000,
    burn: 8_400_000,
    planned: semester,
  });
  it("leftover at graduation Rp 92.000.000", () => expect(r.leftoverAtGraduation).toBe(92_000_000));
  it("depletes in June 2029", () => expect(r.depletionDate!.slice(0, 7)).toBe("2029-06"));
  it("safe per day Rp 378.000", () => expect(r.safePerDay).toBe(378_000));
  it("status Sesuai rencana", () => {
    expect(r.status).toBe("sesuai");
    expect(r.label).toBe("Sesuai rencana");
  });
  it("series has a step on each semester date", () => {
    expect(r.series.filter((p) => p.date === "2027-02-14")).toHaveLength(2);
  });
});

describe("runway statuses (one case each)", () => {
  const base = { today: "2026-11-14", graduation: "2028-07-14", reserve: 30_000_000, planned: [] };
  it("belum_cukup: 100 jt, 8,4 jt/bln, 20 months", () => {
    const r = computeRunway({ ...base, funds: 100_000_000, burn: 8_400_000 });
    expect(r.status).toBe("belum_cukup");
    expect(r.label).toBe("Belum cukup sampai lulus");
  });
  it("perlu_perhatian: leftover between 0 and reserve", () => {
    const r = computeRunway({ ...base, funds: 190_000_000, burn: 8_400_000 });
    expect(r.leftoverAtGraduation).toBe(22_000_000);
    expect(r.status).toBe("perlu_perhatian");
  });
  it("sesuai", () => expect(computeRunway({ ...base, funds: 300_000_000, burn: 8_400_000 }).status).toBe("sesuai"));
  it("data_belum_cukup when B is missing", () =>
    expect(computeRunway({ ...base, funds: 1, burn: null }).status).toBe("data_belum_cukup"));
  it("funds <= 0 → belum cukup, depletes today", () => {
    const r = computeRunway({ ...base, funds: 0, burn: 1 });
    expect(r.status).toBe("belum_cukup");
    expect(r.depletionDate).toBe("2026-11-14");
  });
  it("burn 0 → never depletes", () => {
    const r = computeRunway({ ...base, funds: 10, burn: 0 });
    expect(r.depletionDate).toBeNull();
  });
  it("graduation in the past → no projection", () =>
    expect(computeRunway({ ...base, graduation: "2026-01-01", funds: 1, burn: 1 }).status).toBe("tanggal_lulus_lewat"));
});

describe("computeBurn", () => {
  it("averages the last 3 full calendar months", () => {
    const spends = ["2026-08-10", "2026-09-10", "2026-10-10"].map((date) => ({ date, amount: 8_400_000 }));
    expect(computeBurn(spends, "2026-08-01", "2026-11-14", null)).toMatchObject({ burn: 8_400_000, source: "bulan_penuh" });
  });
  it("12 days of data and no override → B missing", () => {
    expect(computeBurn([{ date: "2026-11-05", amount: 100 }], "2026-11-02", "2026-11-14", null).burn).toBeNull();
  });
  it("< 30 days with override uses the override", () => {
    expect(computeBurn([], "2026-11-02", "2026-11-14", 5_000_000)).toMatchObject({ burn: 5_000_000, source: "estimasi" });
  });
  it("≥ 30 days but no full month uses daily average × 30", () => {
    const r = computeBurn([{ date: "2026-10-20", amount: 3_500_000 }], "2026-10-10", "2026-11-14", null);
    expect(r.source).toBe("harian");
    expect(r.burn).toBe(3_000_000);
  });
});
