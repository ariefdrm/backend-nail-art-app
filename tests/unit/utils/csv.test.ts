import { describe, expect, test } from "bun:test";
import { csvCell, csvRow } from "../../../src/utils/csv.js";

describe("csvCell", () => {
  test("plain values are written as they are; empty for null and undefined", () => {
    expect(csvCell("Gel Polish")).toBe("Gel Polish");
    expect(csvCell(150000)).toBe("150000");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(true)).toBe("true");
    expect(csvCell(false)).toBe("false");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell("")).toBe("");
  });

  test("quotes cells with commas, quotes or line breaks, doubling inner quotes", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  test("defuses text a spreadsheet would run as a formula", () => {
    expect(csvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvCell("+62812")).toBe("'+62812");
    expect(csvCell("-1+2")).toBe("'-1+2");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("\tcell")).toBe("'\tcell");
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
  });

  test("never alters numbers, including negative ones", () => {
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(0)).toBe("0");
  });

  test("a formula character in the middle of the text is left alone", () => {
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell("Nail-Art")).toBe("Nail-Art");
  });
});

describe("csvRow", () => {
  test("joins cells with commas and ends the line with CRLF", () => {
    expect(csvRow(["a", 1, null, true, "x,y"])).toBe('a,1,,true,"x,y"\r\n');
  });
});
