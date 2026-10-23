import { describe, expect, it } from "vitest";
import { formatCard, formatComps, formatPage, summarizeComps, type ListingRow, type SoldRow } from "../src/index.ts";

const goldenbush: ListingRow = {
  L_Address: "10 Goldenbush",
  L_City: "Irvine",
  L_Zip: "92604",
  L_SystemPrice: 999_000,
  L_Keyword2: 3,
  LM_Dec_3: "3.0",
  LM_Int2_3: 1688,
  AssociationFee: 597,
  PoolPrivateYN: "1",
  ViewYN: "1",
  PhotoCount: 53,
  DaysOnMarket: 7,
  YearBuilt: 1974,
  L_DisplayId: "1190390523",
  PreviousListPrice: "1099888",
  L_Remarks: "Welcome to an exceptional opportunity in Irvine’s highly desirable Deerfield community. Offering 1,688 square feet of beautifully remodeled living space with more.",
};

describe("formatCard", () => {
  it("formats the detailed card", () => {
    expect(formatCard(goldenbush, 1)).toBe(
      [
        "1. 10 Goldenbush, Irvine 92604",
        "   $999,000 (↓ from $1,099,888)",
        "   3 bd / 3 ba · 1,688 sq ft · built 1974",
        "   Pool · View · HOA $597/mo",
        "   53 photos · 7 days on market · MLS# 1190390523",
        `   "${goldenbush.L_Remarks!.slice(0, 150)}…"`,
      ].join("\n"),
    );
  });

  it("handles missing and unusual description text", () => {
    const bare = formatCard(
      { ...goldenbush, L_Remarks: null, AssociationFee: null, LM_Int2_3: null, PoolPrivateYN: "", ViewYN: null, PreviousListPrice: null },
      2,
    );
    expect(bare).not.toContain('"');
    expect(bare).toContain("No HOA listed");
    expect(bare).toContain("3 bd / 3 ba · — sq ft");
    expect(bare).not.toContain("Pool");
    expect(bare).not.toContain("↓");
    expect(formatCard({ ...goldenbush, L_Remarks: "Irvine’s 🏡 home" }, 1)).toContain('"Irvine’s 🏡 home"');
  });

  it("shows half baths", () => {
    expect(formatCard({ ...goldenbush, LM_Dec_3: "2.5" }, 1)).toContain("3 bd / 2.5 ba");
  });
});

describe("formatPage", () => {
  it("page header", () => {
    const text = formatPage([goldenbush], 1, 18);
    expect(text.startsWith("Showing 1–5 of 18")).toBe(true);
    expect(text).toContain("1. 10 Goldenbush");
  });

  it("numbers continue across pages", () => {
    const text = formatPage([goldenbush, goldenbush, goldenbush], 2, 8);
    expect(text.startsWith("Showing 6–8 of 8")).toBe(true);
    expect(text).toContain("6. 10 Goldenbush");
  });
});

describe("comps", () => {
  const sale = (price: number, date: string, area: number | null = 1000): SoldRow => ({
    UnparsedAddress: `${price} Main St`,
    City: "Irvine",
    CloseDate: date,
    ClosePrice: price,
    LivingArea: area,
    DaysOnMarket: 30,
    BedroomsTotal: 3,
    BathroomsTotalInteger: 2,
    PropertySubType: "Condominium",
  });

  it("summarizes comps", () => {
    const summary = summarizeComps([
      sale(1_500_000, "2026-09-01"),
      sale(1_000_000, "2026-03-20", 0),
      sale(1_300_000, "2026-08-15"),
      sale(1_200_000, "2026-06-10"),
    ]);
    expect(summary.count).toBe(4);
    expect(summary.medianPrice).toBe(1_250_000);
    expect(summary.medianPricePerSqft).toBe(1300);
    expect(summary.avgDaysOnMarket).toBe(30);
    expect(summary.from).toBe("2026-03-20");
    expect(summary.to).toBe("2026-09-01");
    expect(summary.recent.map((r) => r.CloseDate)).toEqual(["2026-09-01", "2026-08-15", "2026-06-10"]);
  });

  it("formats comps and says when there are none", () => {
    const text = formatComps(summarizeComps([sale(1_200_000, "2026-06-10")]), "condos in Irvine");
    expect(text).toContain("1 sale");
    expect(text).toContain("$1,200,000");
    expect(formatComps(summarizeComps([]), "condos in Irvine")).toBe("No recent sales found for condos in Irvine.");
  });
});
