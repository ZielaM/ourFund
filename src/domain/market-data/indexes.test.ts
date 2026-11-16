import { describe, expect, it } from "vitest";
import { parseGusInflation, parseNbpReferenceRates } from "./indexes";

describe("parseGusInflation", () => {
  // The shape of GUS's indicator data: one row per month, 247 is January.
  const row = (period: number, value: number) => ({
    "id-wskaznik": 2728,
    "id-okres": period,
    "id-daty": 2026,
    wartosc: value,
    precyzja: 1,
  });

  it("turns 'previous year = 100' into a percentage change per month", () => {
    const readings = parseGusInflation([row(248, 102.1), row(247, 102.1), row(255, 104.1)]);

    expect(readings?.map(({ month, value }) => [month, value.toFixed()])).toEqual([
      [1, "2.1"],
      [2, "2.1"],
      [9, "4.1"],
    ]);
  });

  it("reads falling prices as a negative change and skips periods that are not months", () => {
    const readings = parseGusInflation([row(250, 99.4), row(270, 103), row(246, 103)]);

    expect(readings?.map(({ month, value }) => [month, value.toFixed()])).toEqual([[4, "-0.6"]]);
  });

  it("returns null for anything else", () => {
    expect(parseGusInflation({ status: "404" })).toBeNull();
    expect(parseGusInflation([{ "id-okres": "247", wartosc: 103 }])).toBeNull();
    expect(parseGusInflation(null)).toBeNull();
  });
});

describe("parseNbpReferenceRates", () => {
  const archive = `<?xml version="1.0" encoding="utf-8"?>
<stopy_procentowe_archiwum data_publikacji="2026-03-05">
  <pozycje obowiazuje_od="2025-12-04">
    <pozycja id="ref" oprocentowanie="4,25" />
    <pozycja id="lom" oprocentowanie="4,75" />
  </pozycje>
  <pozycje obowiazuje_od="2025-05-08">
    <pozycja id="ref" oprocentowanie="5,25" />
  </pozycje>
  <pozycje obowiazuje_od="2026-01-15">
    <pozycja id="lom" oprocentowanie="4,50" />
  </pozycje>
</stopy_procentowe_archiwum>`;

  it("returns the changes of the reference rate, oldest first", () => {
    expect(
      parseNbpReferenceRates(archive)?.map(({ validFrom, rate }) => [validFrom, rate.toFixed()]),
    ).toEqual([
      ["2025-05-08", "5.25"],
      ["2025-12-04", "4.25"],
    ]);
  });

  it("reads an archive with a single entry", () => {
    const single = `<stopy_procentowe_archiwum><pozycje obowiazuje_od="2026-03-05"><pozycja id="ref" oprocentowanie="4,00" /></pozycje></stopy_procentowe_archiwum>`;

    expect(parseNbpReferenceRates(single)?.map(({ rate }) => rate.toFixed())).toEqual(["4"]);
  });

  it("returns null for another document", () => {
    expect(parseNbpReferenceRates("<html><body>Przerwa techniczna</body></html>")).toBeNull();
    expect(parseNbpReferenceRates("")).toBeNull();
  });
});
