import { describe, expect, it } from "vitest";
import { activeByType, citySales, dataWindow } from "../src/index.ts";

const SALE_COLUMNS = [
  "ClosePrice", "ListPrice", "OriginalListPrice", "LivingArea", "DaysOnMarket", "CloseDate", "PostalCode", "PropertySubType",
];

describe("market queries", () => {
  it("city sales select the 8 columns for one city, without future dates", () => {
    const q = citySales("Irvine");
    expect(q.params).toEqual(["Irvine"]);
    const columns = q.sql.match(/^SELECT (.+?) FROM/)![1].split(", ");
    expect(columns).toEqual(SALE_COLUMNS);
    expect(q.sql).toContain("FROM california_sold");
    expect(q.sql).toContain("City = ?");
    expect(q.sql).toContain("CloseDate <= CURDATE()");
  });

  it("active listings are counted by type for one city", () => {
    const q = activeByType("Irvine");
    expect(q.params).toEqual(["Irvine"]);
    expect(q.sql).toContain("FROM rets_property");
    expect(q.sql).toContain("L_City = ?");
    expect(q.sql).toContain("GROUP BY L_Type_");
  });

  it("the data window has no parameters and no future dates", () => {
    const q = dataWindow();
    expect(q.params).toEqual([]);
    expect(q.sql).toContain("MIN(CloseDate) AS first");
    expect(q.sql).toContain("MAX(CloseDate) AS last");
    expect(q.sql).toContain("CloseDate <= CURDATE()");
  });

  it("user text never reaches SQL", () => {
    const evil = "Irvine'); DROP TABLE rets_property;--";
    for (const q of [citySales(evil), activeByType(evil)]) {
      expect(q.sql).not.toContain("DROP");
      expect(q.params).toEqual([evil]);
    }
  });

  it("never selects personal or address columns", () => {
    for (const q of [citySales("Irvine"), activeByType("Irvine"), dataWindow()]) {
      expect(q.sql).not.toMatch(/Address|Agent|Office|Buyer|Remarks|DisplayId/i);
    }
  });
});
