import path from 'node:path';
import JSZip from 'jszip';
import type { AssemblyCheckSheetCellWrite } from '@raspi-system/shared-types';

const prefix = '(?:[\\w.-]+:)?';
const elements = (name: string) => new RegExp(`<${prefix}${name}\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/${prefix}${name}\\s*>)`, 'g');
const tags = (name: string) => new RegExp(`<${prefix}${name}\\b[^>]*>`, 'g');
function unescapeXml(text: string) {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(entity[1] === 'x' ? 2 : 1), entity[1] === 'x' ? 16 : 10));
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[entity];
  });
}
function attribute(tag: string, key: string) {
  const match = tag.match(new RegExp(`\\s${key}\\s*=\\s*(["'])(.*?)\\1`));
  return match ? unescapeXml(match[2]) : undefined;
}
function escapeXml(text: string) {
  // XML 1.0 forbids these characters even when escaped.
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
}
function address(cell: string) {
  const match = /^([A-Z]{1,3})([1-9]\d*)$/.exec(cell);
  if (!match) throw new Error(`Invalid cell address: ${cell}`);
  const column = [...match[1]].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0);
  const row = Number(match[2]);
  if (column > 16384 || row > 1048576) throw new Error(`Invalid cell address: ${cell}`);
  return { column, row };
}
function patchSheet(xml: string, writes: AssemblyCheckSheetCellWrite[]) {
  const sheetData = xml.match(elements('sheetData'))?.[0];
  if (!sheetData) throw new Error('Missing sheetData');
  const ns = sheetData.match(/^<([\w.-]+:)?sheetData/)?.[1] ?? '';
  let data = sheetData.replace(/\/>$/, `></${ns}sheetData>`);
  for (const write of writes) {
    const target = address(write.cell);
    let rowXml = [...data.matchAll(elements('row'))].find((match) => Number(attribute(match[0], 'r')) === target.row)?.[0];
    const oldRow = rowXml;
    rowXml = rowXml?.replace(/\/>$/, `></${ns}row>`) ?? `<${ns}row r="${target.row}"></${ns}row>`;
    const cells = [...rowXml.matchAll(elements('c'))];
    const oldCell = cells.find((match) => attribute(match[0], 'r') === write.cell)?.[0];
    // Dropping a shared-formula master would orphan its dependents and make Excel repair the file.
    const formula = oldCell?.match(/<(?:[\w.-]+:)?f\b[^>]*>/)?.[0];
    if (formula && attribute(formula, 't') === 'shared' && attribute(formula, 'ref')) throw new Error(`Cannot overwrite shared formula master: ${write.cell}`);
    const open = oldCell?.match(/^<[^>]*>/)?.[0].replace(/\s+t\s*=\s*(["']).*?\1/, '').replace(/\/?\s*>$/, '')
      ?? `<${ns}c r="${write.cell}"`;
    const cell = `${open} t="inlineStr"><${ns}is><${ns}t xml:space="preserve">${escapeXml(write.text)}</${ns}t></${ns}is></${ns}c>`;
    if (oldCell) rowXml = rowXml.replace(oldCell, () => cell);
    else {
      const next = cells.find((match) => { const ref = attribute(match[0], 'r'); return ref !== undefined && address(ref).column > target.column; });
      const offset = next?.index ?? rowXml.lastIndexOf(`</${ns}row`);
      rowXml = rowXml.slice(0, offset) + cell + rowXml.slice(offset);
    }
    if (oldRow) data = data.replace(oldRow, () => rowXml!);
    else {
      const next = [...data.matchAll(elements('row'))].find((match) => Number(attribute(match[0], 'r')) > target.row);
      const offset = next?.index ?? data.lastIndexOf(`</${ns}sheetData`);
      data = data.slice(0, offset) + rowXml + data.slice(offset);
    }
  }
  return xml.replace(sheetData, () => data);
}

/** Surgical package edit: all unrelated ZIP entries retain their original bytes. */
export async function fillCheckSheetXlsx(source: Buffer, sheetName: string, writes: AssemblyCheckSheetCellWrite[]): Promise<Buffer> {
  const zip = await JSZip.loadAsync(source);
  const put = (name: string, data: string) => zip.file(name, data, { createFolders: false });
  const read = async (name: string) => {
    const entry = zip.file(name);
    if (!entry) throw new Error(`Missing XLSX part: ${name}`);
    return entry.async('string');
  };
  let workbook = await read('xl/workbook.xml');
  let rels = await read('xl/_rels/workbook.xml.rels');
  const sheet = workbook.match(tags('sheet'))?.find((tag) => attribute(tag, 'name') === sheetName);
  if (!sheet) throw new Error('Worksheet not found');
  const relationshipId = attribute(sheet, '(?:[\\w.-]+:)?id');
  const relationships = rels.match(elements('Relationship')) ?? [];
  const relation = relationships.find((tag) => attribute(tag, 'Id') === relationshipId);
  const target = relation && attribute(relation, 'Target');
  if (!target || attribute(relation!, 'TargetMode') === 'External') throw new Error('Worksheet relationship not found');
  const part = path.posix.normalize(target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  if (!part.startsWith('xl/')) throw new Error('Invalid worksheet part');
  put(part, patchSheet(await read(part), writes));
  const calcParts = new Set(['xl/calcChain.xml']);
  for (const entry of relationships) {
    if (attribute(entry, 'Type')?.endsWith('/calcChain')) {
      const calcTarget = attribute(entry, 'Target');
      if (calcTarget) calcParts.add(path.posix.normalize(calcTarget.startsWith('/') ? calcTarget.slice(1) : `xl/${calcTarget}`));
      rels = rels.replace(entry, '');
    }
  }
  for (const name of calcParts) zip.remove(name);
  const contentTypes = await read('[Content_Types].xml');
  const cleanedTypes = contentTypes.replace(elements('Override'), (tag) =>
    calcParts.has((attribute(tag, 'PartName') ?? '').replace(/^\//, '')) || attribute(tag, 'ContentType')?.endsWith('.calcChain+xml') ? '' : tag);
  if (cleanedTypes !== contentTypes) put('[Content_Types].xml', cleanedTypes);
  if (rels !== await read('xl/_rels/workbook.xml.rels')) put('xl/_rels/workbook.xml.rels', rels);
  const calcPr = workbook.match(tags('calcPr'))?.[0];
  if (calcPr) workbook = workbook.replace(calcPr, () => calcPr.replace(/\s+fullCalcOnLoad\s*=\s*(["']).*?\1/, '').replace(/\/?\s*>$/, (end) => ` fullCalcOnLoad="1"${end}`));
  else {
    const ns = workbook.match(/<([\w.-]+:)?workbook\b/)?.[1] ?? '';
    workbook = workbook.replace(new RegExp(`(?=<${ns}extLst\\b|<\\/${ns}workbook>)`), `<${ns}calcPr fullCalcOnLoad="1"/>`);
  }
  put('xl/workbook.xml', workbook);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
