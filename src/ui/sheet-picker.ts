// Which sheet of a workbook to load, asked in the page's sheet picker
// (#sheet-dialog in index.html). Ported from the @jeyabbalas/data-table demo.

import type { SheetSummary } from '../loaders/excel';

const count = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * Ask which sheet to load, in the page's sheet picker. Resolves with the
 * sheet's name, or `null` when the picker is dismissed.
 */
export function pickSheet(fileName: string, sheets: SheetSummary[]): Promise<string | null> {
  const dialog = document.getElementById('sheet-dialog') as HTMLDialogElement;
  const list = document.getElementById('sheet-list')!;
  const text = document.getElementById('sheet-dialog-text')!;

  const name = document.createElement('strong');
  name.textContent = fileName;
  text.replaceChildren(name, ` has ${sheets.length} sheets with data. Pick the one to load.`);

  list.replaceChildren(
    ...sheets.map((sheet, index) => {
      const option = document.createElement('label');
      option.className = 'sheet-option';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'sheet';
      radio.value = String(index);
      radio.checked = index === 0;
      const title = document.createElement('span');
      title.className = 'sheet-name';
      title.textContent = sheet.name;
      const size = document.createElement('span');
      size.className = 'sheet-size';
      size.textContent =
        `${count(sheet.rows, 'row')} × ${count(sheet.columns, 'column')}` +
        (sheet.hidden ? ' · hidden' : '');
      const columns = document.createElement('span');
      columns.className = 'sheet-columns';
      columns.textContent = sheet.names.join(', ');
      // The spaces keep the parts apart in the radio's name; the grid
      // ignores them.
      option.append(radio, title, ' ', size, ' ', columns);
      return option;
    }),
  );

  return new Promise((resolve) => {
    const chosen = (): string | null => {
      const radio = list.querySelector<HTMLInputElement>('input[name="sheet"]:checked');
      return radio ? (sheets[Number(radio.value)]?.name ?? null) : null;
    };
    // Enter loads the sheet under the focus; a radio does not submit a form.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Enter' && (event.target as Element).matches('input[name="sheet"]')) {
        event.preventDefault();
        dialog.close('load');
      }
    };
    const onDoubleClick = (event: MouseEvent): void => {
      if ((event.target as Element).closest('.sheet-option')) dialog.close('load');
    };
    dialog.addEventListener('keydown', onKeyDown);
    list.addEventListener('dblclick', onDoubleClick);
    dialog.addEventListener(
      'close',
      () => {
        dialog.removeEventListener('keydown', onKeyDown);
        list.removeEventListener('dblclick', onDoubleClick);
        resolve(dialog.returnValue === 'load' ? chosen() : null);
      },
      { once: true },
    );
    dialog.returnValue = '';
    dialog.showModal();
    list.querySelector<HTMLInputElement>('input:checked')?.focus();
  });
}
