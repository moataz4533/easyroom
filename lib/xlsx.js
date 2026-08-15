/**
 * A real .xlsx file, written by hand.
 *
 * A CSV opens in Excel but arrives as bare text: no column widths, no bold
 * heading, no currency, and Arabic that reads left to right. What the hotel
 * hands its accountant should look like a sheet somebody prepared.
 *
 * The alternative was a spreadsheet library, and the smallest useful one is
 * a few hundred kilobytes — real weight on a phone, for an app that is meant
 * to open on a bad connection in Dahab. An .xlsx is a zip of five small XML
 * files, and this is exactly the five, so the export costs a few kilobytes
 * of code and no download at all.
 *
 * Everything here is pure. Given the same rows it returns the same bytes.
 */

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

export function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c])
    // Control characters are not legal in XML and would make Excel refuse
    // the whole file rather than skip the cell.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** A1, B1 … Z1, AA1. Excel addresses columns in base 26 with no zero. */
export function cellRef(columnIndex, rowNumber) {
  let name = "";
  let n = columnIndex + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return `${name}${rowNumber}`;
}

/* ---------------- the five files ---------------- */

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

/**
 * Six styles, which is all a report needs: the title, the column heading,
 * plain text, a date, a whole number, and money. Sizes are deliberately
 * larger than Excel's default 11pt — this is printed and read across a desk.
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2">
<numFmt numFmtId="164" formatCode="#,##0.00&quot; ج&quot;"/>
<numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd"/>
</numFmts>
<fonts count="4">
<font><sz val="12"/><name val="Calibri"/></font>
<font><b/><sz val="16"/><color rgb="FF0B3A46"/><name val="Calibri"/></font>
<font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="12"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF0B3A46"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFBDCFCC"/></left><right style="thin"><color rgb="FFBDCFCC"/></right><top style="thin"><color rgb="FFBDCFCC"/></top><bottom style="thin"><color rgb="FFBDCFCC"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
</cellXfs>
</styleSheet>`;

// Indexes into cellXfs above.
export const STYLE = { plain: 0, title: 1, head: 2, cell: 3, date: 4, money: 5, total: 6 };

const EPOCH = Date.UTC(1899, 11, 30);

/** Excel counts days from 30 December 1899. */
export function excelDate(iso) {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return Math.round((ms - EPOCH) / 86400000);
}

function cellXml(value, rowNumber, columnIndex) {
  const ref = cellRef(columnIndex, rowNumber);
  if (value === null || value === undefined || value === "") {
    return `<c r="${ref}" s="${STYLE.cell}"/>`;
  }
  const { text, number, date, style } = value;
  const s = style ?? STYLE.cell;

  if (date) {
    const serial = excelDate(date);
    return serial === null
      ? `<c r="${ref}" s="${s}" t="inlineStr"><is><t>${escapeXml(date)}</t></is></c>`
      : `<c r="${ref}" s="${s}"><v>${serial}</v></c>`;
  }
  if (number !== undefined && number !== null && Number.isFinite(Number(number))) {
    return `<c r="${ref}" s="${s}"><v>${Number(number)}</v></c>`;
  }
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text ?? "")}</t></is></c>`;
}

/**
 * `sheet` is { name, rtl, columns: [{ header, width }], title, rows }
 * where each row is an array of cells: { text | number | date, style }.
 */
export function sheetXml({ name, rtl = true, columns = [], title = "", rows = [] }) {
  const cols = columns.map((c, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${c.width || 16}" customWidth="1"/>`).join("");

  const lines = [];
  let rowNumber = 1;

  if (title) {
    lines.push(`<row r="1" ht="26" customHeight="1">${cellXml({ text: title, style: STYLE.title }, 1, 0)}</row>`);
    rowNumber = 3; // one blank row of air under the title
  }

  if (columns.length) {
    lines.push(`<row r="${rowNumber}" ht="30" customHeight="1">${
      columns.map((c, i) => cellXml({ text: c.header, style: STYLE.head }, rowNumber, i)).join("")
    }</row>`);
    rowNumber += 1;
  }

  const headerRow = rowNumber - 1;
  for (const row of rows) {
    lines.push(`<row r="${rowNumber}">${
      row.map((cell, i) => cellXml(cell, rowNumber, i)).join("")
    }</row>`);
    rowNumber += 1;
  }

  const lastCol = Math.max(columns.length, 1) - 1;
  const dimension = `A1:${cellRef(lastCol, Math.max(rowNumber - 1, 1))}`;

  // The heading row stays put while the accountant scrolls, and each column
  // gets a filter arrow — the two things anyone does to a sheet by hand.
  const frozen = columns.length
    ? `<pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/>`
    : "";
  const view = `<sheetView workbookViewId="0"${rtl ? ' rightToLeft="1"' : ""}>${frozen}</sheetView>`;
  const filter = columns.length
    ? `<autoFilter ref="A${headerRow}:${cellRef(lastCol, headerRow)}"/>` : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="${dimension}"/>
<sheetViews>${view}</sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
${cols ? `<cols>${cols}</cols>` : ""}
<sheetData>${lines.join("")}</sheetData>
${filter}
</worksheet>`;
}

function workbookXml(sheetName) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escapeXml(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
}

/* ---------------- the zip around them ---------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Entries are stored, not deflated. A report is a few tens of kilobytes of
 * XML, and carrying a compressor to save a few of them would cost more code
 * than it saves bytes.
 */
export function zip(files) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

  for (const [name, text] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(text);
    const sum = crc32(data);

    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0),
      ...u32(sum), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0),
    ];
    parts.push(new Uint8Array(local), nameBytes, data);

    central.push([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(0), ...u16(0), ...u32(sum), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offset),
    ]);
    central.push(nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }

  const directory = [];
  for (const piece of central) {
    directory.push(piece instanceof Uint8Array ? piece : new Uint8Array(piece));
  }
  const directorySize = directory.reduce((sum, p) => sum + p.length, 0);
  const count = Object.keys(files).length;

  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(count), ...u16(count),
    ...u32(directorySize), ...u32(offset), ...u16(0),
  ]);

  const all = [...parts, ...directory, end];
  const total = all.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const piece of all) { out.set(piece, at); at += piece.length; }
  return out;
}

/** The finished file, ready to be saved. */
export function buildWorkbook(sheet) {
  return zip({
    "[Content_Types].xml": CONTENT_TYPES,
    "_rels/.rels": ROOT_RELS,
    "xl/workbook.xml": workbookXml(sheet.name || "Report"),
    "xl/_rels/workbook.xml.rels": WORKBOOK_RELS,
    "xl/styles.xml": STYLES,
    "xl/worksheets/sheet1.xml": sheetXml(sheet),
  });
}
