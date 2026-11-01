import type { AssemblyCheckSheetItemProposal, AssemblyCheckSheetProposal } from '@raspi-system/shared-types';
import type { ParsedCheckSheet } from './check-sheet-xlsx-parser.js';

type Field = NonNullable<AssemblyCheckSheetItemProposal['inputSpec']['fields']>[number];
const knownUnit = /^(N[・･·.]?m|mm|cm|MPa|kPa|kg|V|A|N|個|本|°|%)(?![a-zA-Z])/i;
const canonicalUnit = (unit: string) => /^N[・･·.]?m$/i.test(unit) ? 'N·m' : unit;

function extractInputs(text: string): { fields: Field[]; options?: string[]; template: string; numeric: boolean; warnings: string[] } {
  const fields: Field[] = [];
  const warnings: string[] = [];
  let numeric = false;
  let options: string[] | undefined;
  const addField = (label: string, unit?: string) => {
    const key = `field${fields.length + 1}`;
    fields.push({ key, label: label.trim() || key, ...(unit !== undefined ? { unit } : {}) });
    return `{${key}}`;
  };
  let template = text.replace(/\(([^()]*)\)/g, (match: string, inside: string, offset: number) => {
    const choice = inside.replace(/\s/g, '').split(/[・･]/);
    if (choice.length >= 2 && choice.every((value) => /^(OK|NG|該当無し|該当なし|有|無)$/.test(value))) {
      options = choice;
      return '({result})';
    }
    if (!/\s{2,}/.test(inside) && !/^\s+$/.test(inside)) return match;
    const before = text.slice(0, offset).split(/[()\n・]/).at(-1)?.trim() ?? '';
    const outsideUnit = text.slice(offset + match.length).match(knownUnit)?.[0];
    const insideUnit = inside.trim().match(knownUnit)?.[0];
    const unit = insideUnit ?? outsideUnit;
    if (unit) {
      numeric = true;
      const placeholder = addField(before, canonicalUnit(unit));
      return `(${placeholder}${insideUnit ? ` ${insideUnit}` : ''})`;
    }
    if (/^M\s+$/.test(inside)) {
      numeric = true;
      return `(M${addField(before, '')})`;
    }
    if (/^\s{2,}\S/.test(inside)) {
      numeric = true;
      warnings.push('unit_unknown');
      return `(${addField(before, '')} ${inside.trim()})`;
    }
    // A single parenthesis can contain labelled blanks (メーカー … 型式 …).
    if (/\S/.test(inside)) {
      return `(${inside.replace(/([^\s]+)\s{2,}/g, (_blank, label: string) => `${label} ${addField(label)}`)})`;
    }
    if (/電圧|ストローク|トルク|寸法/.test(before)) {
      numeric = true;
      warnings.push('unit_unknown');
      return `(${addField(before, '')})`;
    }
    warnings.push('unit_unknown');
    return `(${addField(before)})`;
  });
  if (!options && /有\s*[・･]\s*無/.test(text)) {
    options = ['有', '無'];
    template = template.replace(/有\s*[・･]\s*無/, '{result}');
  }
  if (fields.length === 0 && /(?:[XYZθ]軸\s*){2,}/.test(text)) {
    numeric = true;
    warnings.push('unit_unknown');
    template = text.replace(/([XYZθ]軸)\s*/g, (_match, axis: string) => `${axis} ${addField(axis, '')} `).trim();
  }
  if (numeric) {
    for (const field of fields) {
      if (field.unit === undefined) {
        field.unit = '';
        warnings.push('mixed_input_review');
      }
    }
  }
  return { fields, options, template, numeric, warnings };
}

/** All guesses are editable; never resolves employees or writes to the source workbook. */
export function normalizeCheckSheet(parsed: ParsedCheckSheet): AssemblyCheckSheetProposal {
  const proposal: AssemblyCheckSheetProposal = {
    documentNo: parsed.documentNo, title: parsed.title, modelCode: '', revisionLabel: parsed.revisionLabel,
    sourceSheetName: parsed.sourceSheetName, headerCellMap: { ...parsed.headerCellMap },
    stampColumn: parsed.stampColumn, departmentRoleMembers: {}, groups: parsed.groups.map((group) => ({ ...group })), items: []
  };
  let groupNo = 0;
  let itemNumber = 0;
  let conditionNumber = 0;
  let conditionLabel: string | null = null;
  for (const raw of parsed.items) {
    if (groupNo !== raw.groupNo) {
      groupNo = raw.groupNo;
      itemNumber = 0;
      conditionNumber = 0;
      conditionLabel = null;
    }
    const notes: string[] = [];
    const fragments = raw.fragments.map((fragment) => {
      let text = fragment.text;
      const condition = text.match(/^(.*?場合[^\n]*?以下[^\n]*?確認[^\n]*?こと[。.]?)(?:\s*\n|\s*(?=[・･])|$)/);
      if (condition) {
        conditionLabel = condition[1];
        conditionNumber++;
        text = text.slice(condition[0].length);
      }
      text = text.split('\n').filter((line) => {
        if (line.trim().startsWith('※')) { notes.push(line.trim()); return false; }
        return true;
      }).join('\n').replace(/^[・･]\s*/, '').trim();
      return { cell: fragment.cell, text };
    }).filter((fragment) => fragment.text);
    if (!fragments.length) continue;
    const label = fragments.map((fragment) => fragment.text).join('\n');
    const groupLabel = parsed.groups.find((group) => group.groupNo === groupNo)?.label ?? '';
    const roleText = `${groupLabel}\n${label}`;
    const roleKeys: string[] = [];
    if (/\(班長\)/.test(roleText)) roleKeys.push('leader');
    if (/\(係長\)/.test(roleText)) roleKeys.push('section_chief');
    for (const match of groupLabel.matchAll(/\(([^()]*担当)\)/g)) roleKeys.push(match[1]);
    const inputs = extractInputs(label);
    const warnings = [...inputs.warnings];
    if (roleKeys.length) warnings.push('role_guessed');
    if (conditionLabel) warnings.push('condition_guessed');
    // The current contract targets one cell. Retain all inputs and flag multi-cell originals for review.
    const inputFragments = fragments.filter((fragment) => /\{(?:field\d+|result)\}/.test(extractInputs(fragment.text).template));
    if (inputFragments.length > 1) warnings.push('multiple_value_cells_review');
    const target = inputFragments[0] ?? fragments[0];
    const sourceText = raw.fragments.find((fragment) => fragment.cell === target.cell)!.text;
    proposal.items.push({
      groupNo, itemKey: `${groupNo}-${++itemNumber}`, sortOrder: proposal.items.length,
      label, note: notes.length ? notes.join('\n') : null,
      inputKind: inputs.options ? 'CHOICE' : inputs.fields.length ? (inputs.numeric ? 'NUMBER' : 'TEXT') : 'OK_NG',
      inputSpec: { ...(inputs.fields.length ? { fields: inputs.fields } : {}), ...(inputs.options ? { options: inputs.options } : {}) },
      roleKeys: [...new Set(roleKeys)], conditionKey: conditionLabel ? `${groupNo}-condition-${conditionNumber}` : null,
      conditionLabel, sourceRows: [...raw.sourceRows], stampCell: raw.stampCell,
      valueTarget: { mode: 'inline', cell: target.cell, template: extractInputs(sourceText).template },
      warnings: [...new Set(warnings)]
    });
  }
  return proposal;
}
