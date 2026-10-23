import { describe, expect, it } from "vitest";
import { formatCard, formatComps, formatPage, summarizeComps, type ListingRow, type SoldRow } from "../src/index.ts";

const listing: ListingRow = {
  L_Address: "100 Example Way",
  L_City: "Irvine",
  L_Zip: "92618",
  L_SystemPrice: 950_000,
  L_Keyword2: 3,
  LM_Dec_3: "3.0",
  LM_Int2_3: 1650,
  AssociationFee: 550,
  PoolPrivateYN: "1",
  ViewYN: "1",
  PhotoCount: 40,
  DaysOnMarket: 9,
  YearBuilt: 1980,
  L_DisplayId: "1000000001",
  PreviousListPrice: "1050000",
  L_Remarks: "Bright end-unit home on a quiet street with an open floor plan, an updated kitchen, a private patio and easy access to parks, schools and shopping nearby; move-in ready.",
};

describe("formatCard", () => {
  it("formats the detailed card", () => {
    expect(formatCard(listing, 1)).toBe(
      [
        "1. 100 Example Way, Irvine 92618",
        "   $950,000 (↓ from $1,050,000)",
        "   3 bd / 3 ba · 1,650 sq ft · built 1980",
        "   Pool · View · HOA $550/mo",
        "   40 photos · 9 days on market · MLS# 1000000001",
        `   "${listing.L_Remarks!.slice(0, 150)}…"`,
      ].join("\n"),
    );
  });

  it("handles missing and unusual description text", () => {
    const bare = formatCard(
      { ...listing, L_Remarks: null, AssociationFee: null, LM_Int2_3: null, PoolPrivateYN: "", ViewYN: null, PreviousListPrice: null },
      2,
    );
    expect(bare).not.toContain('"');
    expect(bare).toContain("No HOA listed");
    expect(bare).toContain("3 bd / 3 ba · — sq ft");
    expect(bare).not.toContain("Pool");
    expect(bare).not.toContain("↓");
    expect(formatCard({ ...listing, L_Remarks: "Irvine’s 🏡 home" }, 1)).toContain('"Irvine’s 🏡 home"');
  });

  it("shows half baths", () => {
    expect(formatCard({ ...listing, LM_Dec_3: "2.5" }, 1)).toContain("3 bd / 2.5 ba");
  });
});

describe("formatPage", () => {
  it("page header", () => {
    const text = formatPage([listing], 1, 18);
    expect(text.startsWith("Showing 1–5 of 18")).toBe(true);
    expect(text).toContain("1. 100 Example Way");
  });

  it("numbers continue across pages", () => {
    const text = formatPage([listing, listing, listing], 2, 8);
    expect(text.startsWith("Showing 6–8 of 8")).toBe(true);
    expect(text).toContain("6. 100 Example Way");
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
