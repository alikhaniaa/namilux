import { describe, expect, it } from "vitest";
import { CSV_COLUMNS, normalizeRow, parseCsv, toCsv } from "../import-csv";
import type { ExportRow } from "../import-csv";

describe("catalog/import-csv - parseCsv (pure)", () => {
  it("parses BOM + CRLF + quoted fields with escapes and embedded newlines", () => {
    const text = "﻿id,display_name\r\n1,\"a,\"\"b\"\"\r\nc\"\r\n2,plain\r\n";
    const { header, rows } = parseCsv(text);
    expect(header).toEqual(["id", "display_name"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ id: "1", display_name: 'a,"b"\r\nc' });
    expect(rows[1]).toEqual({ id: "2", display_name: "plain" });
  });

  it("ignores a trailing blank line", () => {
    expect(parseCsv("id\n1\n\n").rows).toHaveLength(1);
  });
});

describe("catalog/import-csv - normalizeRow (pure)", () => {
  it("folds Persian digits in numeric cells and applies ZWNJ to text", () => {
    const row = normalizeRow({ id: "۱۲", price: "۴۱٬۵۰۰٬۰۰۰", display_name: "می خواهم" }, 2);
    expect(row.id).toBe(12);
    expect(row.fields.price).toBe(41_500_000);
    expect(typeof row.fields.display_name).toBe("string");
  });

  it("treats an empty cell as unchanged (absent from fields)", () => {
    const row = normalizeRow({ id: "1", price: "" }, 2);
    expect(row.fields.price).toBeUndefined();
  });
});

describe("catalog/import-csv - toCsv (pure)", () => {
  it("quotes cells needing it, prefixes a BOM, and round-trips through parseCsv", () => {
    const base = Object.fromEntries(CSV_COLUMNS.map((c) => [c, ""])) as ExportRow;
    const rows: ExportRow[] = [{ ...base, id: "1", display_name: 'has, comma' }];
    const csv = toCsv(rows);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const parsed = parseCsv(csv);
    expect(parsed.rows[0]?.display_name).toBe("has, comma");
    expect(parsed.rows[0]?.id).toBe("1");
  });
});
