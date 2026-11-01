// The fixed queries behind every market report: the same three for any city.
// They select only what the report needs: never an address, agent, office or buyer.
import type { Sql } from "./db.ts";

/** One sold home, as the market math needs it. */
export type MarketSaleRow = {
  ClosePrice: number | null;
  ListPrice: number | null;
  OriginalListPrice: number | null;
  LivingArea: number | null;
  DaysOnMarket: number | null;
  CloseDate: string;
  PostalCode: string | null;
  PropertySubType: string | null;
};

const SALE_COLUMNS = [
  "ClosePrice", "ListPrice", "OriginalListPrice", "LivingArea", "DaysOnMarket", "CloseDate", "PostalCode", "PropertySubType",
].join(", ");

/** Every sale in one city up to today (a few records carry typo dates in the future). */
export function citySales(city: string): Sql {
  return {
    sql: `SELECT ${SALE_COLUMNS} FROM california_sold WHERE City = ? AND CloseDate <= CURDATE()`,
    params: [city],
  };
}

/** Homes for sale now in one city, as rows of { type, total }. */
export function activeByType(city: string): Sql {
  return {
    sql: "SELECT L_Type_ AS type, COUNT(*) AS total FROM rets_property WHERE L_City = ? GROUP BY L_Type_",
    params: [city],
  };
}

/** The first and last close date in the sold data, so partial months are known. */
export function dataWindow(): Sql {
  return {
    sql: "SELECT MIN(CloseDate) AS first, MAX(CloseDate) AS last FROM california_sold WHERE CloseDate <= CURDATE()",
    params: [],
  };
}
