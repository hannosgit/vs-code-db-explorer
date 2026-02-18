interface EditorRow {
  values: string[];
  nulls: boolean[];
}

interface DataEditorState {
  columns: string[];
  columnEnumValues?: string[][];
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  rows: EditorRow[];
  pageSize: number;
  pageNumber: number;
  loading?: boolean;
  error?: string;
}

interface DataEditorCellUpdate {
  columnIndex: number;
  value: string;
  isNull: boolean;
}

interface DataEditorUpdateChange {
  kind: "update";
  rowIndex: number;
  updates: DataEditorCellUpdate[];
}

interface DataEditorInsertChange {
  kind: "insert";
  values: DataEditorCellUpdate[];
}

interface DataEditorDeleteChange {
  kind: "delete";
  rowIndex: number;
}

type DataEditorChange =
  | DataEditorUpdateChange
  | DataEditorInsertChange
  | DataEditorDeleteChange;

interface WorkingEditorRow extends EditorRow {
  isNew: boolean;
  isDeleted: boolean;
}

function readState(documentObject: any): DataEditorState | undefined {
  const stateElement = documentObject.getElementById("initial-state");
  if (!stateElement || typeof stateElement.value !== "string") {
    return undefined;
  }

  try {
    return JSON.parse(stateElement.value) as DataEditorState;
  } catch {
    return undefined;
  }
}

(function initDataEditorWebview() {
  const globalObject = globalThis as any;
  const documentObject = globalObject.document;
  if (!documentObject) {
    return;
  }

  const parsedState = readState(documentObject);
  if (!parsedState || !Array.isArray(parsedState.columns) || !Array.isArray(parsedState.rows)) {
    return;
  }
  const state: DataEditorState = parsedState;

  const acquireVsCodeApi = globalObject.acquireVsCodeApi;
  if (typeof acquireVsCodeApi !== "function") {
    return;
  }

  const vscode = acquireVsCodeApi();
  const addRowButton = documentObject.getElementById("add-row");
  const saveButton = documentObject.getElementById("save");
  const revertButton = documentObject.getElementById("revert");
  const refreshButton = documentObject.getElementById("refresh");
  const prevPageButton = documentObject.getElementById("page-prev");
  const nextPageButton = documentObject.getElementById("page-next");
  const sortButtons = Array.from(documentObject.querySelectorAll("button.column-sort"));
  const cellControls: any[] = [];
  const ENUM_NULL_VALUE = "__db_explorer_enum_null__";

  const originalRows: EditorRow[] = state.rows.map((row: EditorRow) => ({
    values: [...row.values],
    nulls: [...row.nulls]
  }));

  let workingRows: WorkingEditorRow[] = originalRows.map((row: EditorRow) => ({
    values: [...row.values],
    nulls: [...row.nulls],
    isNew: false,
    isDeleted: false
  }));

  if (refreshButton) {
    refreshButton.addEventListener("click", () => {
      vscode.postMessage({ command: "refresh" });
    });
  }

  function canDiscardUnsavedChanges(): boolean {
    if (!saveButton || saveButton.disabled) {
      return true;
    }
    return globalObject.confirm("You have unsaved changes on this page. Continue and discard them?");
  }

  if (prevPageButton) {
    prevPageButton.addEventListener("click", () => {
      if (!canDiscardUnsavedChanges()) {
        return;
      }
      vscode.postMessage({ command: "page", direction: "previous" });
    });
  }

  if (nextPageButton) {
    nextPageButton.addEventListener("click", () => {
      if (!canDiscardUnsavedChanges()) {
        return;
      }
      vscode.postMessage({ command: "page", direction: "next" });
    });
  }

  sortButtons.forEach((button: any) => {
    button.addEventListener("click", () => {
      if (!canDiscardUnsavedChanges()) {
        return;
      }

      const columnIndex = Number(button.dataset.columnIndex);
      if (!Number.isInteger(columnIndex) || columnIndex < 0) {
        return;
      }

      vscode.postMessage({ command: "sort", columnIndex });
    });
  });

  function createEmptyRow(): WorkingEditorRow {
    return {
      values: state.columns.map(() => ""),
      nulls: state.columns.map(() => false),
      isNew: true,
      isDeleted: false
    };
  }

  function computeCellValue(raw: string, baselineNull: boolean): { value: string; isNull: boolean } {
    const trimmed = raw.trim();
    const isNull = trimmed.toLowerCase() === "null" || (trimmed === "" && baselineNull);
    return { value: raw, isNull };
  }

  function isCellDirty(rowIndex: number, columnIndex: number): boolean {
    const row = workingRows[rowIndex];
    if (!row) {
      return false;
    }
    if (row.isDeleted) {
      return false;
    }

    const value = row.values[columnIndex] ?? "";
    const isNull = row.nulls[columnIndex] === true;
    if (row.isNew) {
      return isNull || value !== "";
    }

    const originalRow = originalRows[rowIndex];
    if (!originalRow) {
      return isNull || value !== "";
    }

    const originalValue = originalRow.values[columnIndex] ?? "";
    const originalNull = originalRow.nulls[columnIndex] === true;
    return isNull !== originalNull || (!isNull && value !== originalValue);
  }

  function updateDirtyState(): void {
    const dirtyCount = cellControls.filter((control: any) => control.classList.contains("dirty")).length;
    const deletedCount = workingRows.filter((row: WorkingEditorRow) => row.isDeleted && !row.isNew).length;
    const hasChanges = dirtyCount > 0 || deletedCount > 0;
    if (saveButton) {
      saveButton.disabled = !hasChanges;
    }
    if (revertButton) {
      revertButton.disabled = !hasChanges;
    }
  }

  function inputAt(rowIndex: number, columnIndex: number): any | undefined {
    const columnsCount = state.columns.length;
    const index = rowIndex * columnsCount + columnIndex;
    return cellControls[index];
  }

  function enumValuesForColumn(columnIndex: number): string[] {
    if (!Array.isArray(state.columnEnumValues)) {
      return [];
    }
    const values = state.columnEnumValues[columnIndex];
    if (!Array.isArray(values)) {
      return [];
    }
    return values.filter((value: unknown) => typeof value === "string");
  }

  function renderTable(focusRowIndex?: number): void {
    const table = documentObject.getElementById("data-table");
    if (!table) {
      return;
    }

    const tbody = table.querySelector("tbody");
    if (!tbody) {
      return;
    }

    tbody.innerHTML = "";
    cellControls.length = 0;
    const rowNumberOffset = Math.max(0, (state.pageNumber - 1) * state.pageSize);

    workingRows.forEach((row: WorkingEditorRow, rowIndex: number) => {
      const tr = documentObject.createElement("tr");
      if (row.isNew) {
        tr.classList.add("new-row");
      }
      if (row.isDeleted) {
        tr.classList.add("deleted-row");
      }

      const rowNumberCell = documentObject.createElement("td");
      rowNumberCell.classList.add("row-number");
      rowNumberCell.textContent = String(rowNumberOffset + rowIndex + 1);
      tr.appendChild(rowNumberCell);

      const actionCell = documentObject.createElement("td");
      actionCell.classList.add("row-actions");
      const actionButton = documentObject.createElement("button");
      actionButton.classList.add("secondary");
      actionButton.type = "button";
      if (row.isNew) {
        actionButton.textContent = "Remove";
        actionButton.addEventListener("click", () => {
          workingRows.splice(rowIndex, 1);
          renderTable();
        });
      } else if (row.isDeleted) {
        actionButton.textContent = "Undo";
        actionButton.addEventListener("click", () => {
          row.isDeleted = false;
          renderTable();
        });
      } else {
        actionButton.textContent = "Delete";
        actionButton.addEventListener("click", () => {
          const hasUnsavedEdits = state.columns.some((_: string, columnIndex: number) =>
            isCellDirty(rowIndex, columnIndex)
          );
          if (
            hasUnsavedEdits &&
            !globalObject.confirm("Delete this row and discard its unsaved edits?")
          ) {
            return;
          }
          row.isDeleted = true;
          renderTable();
        });
      }
      actionCell.appendChild(actionButton);
      tr.appendChild(actionCell);

      state.columns.forEach((_: string, columnIndex: number) => {
        const td = documentObject.createElement("td");
        const enumValues = row.isNew ? enumValuesForColumn(columnIndex) : [];
        if (enumValues.length > 0) {
          const select = documentObject.createElement("select");
          const value = row.values[columnIndex] ?? "";
          const isNull = row.nulls[columnIndex] === true;

          const placeholderOption = documentObject.createElement("option");
          placeholderOption.value = "";
          placeholderOption.textContent = "(unset)";
          select.appendChild(placeholderOption);

          const nullOption = documentObject.createElement("option");
          nullOption.value = ENUM_NULL_VALUE;
          nullOption.textContent = "NULL";
          select.appendChild(nullOption);

          enumValues.forEach((enumValue: string) => {
            const option = documentObject.createElement("option");
            option.value = enumValue;
            option.textContent = enumValue;
            select.appendChild(option);
          });

          select.value = isNull ? ENUM_NULL_VALUE : value;
          if (select.value !== (isNull ? ENUM_NULL_VALUE : value)) {
            select.value = "";
          }

          select.dataset.row = String(rowIndex);
          select.dataset.column = String(columnIndex);
          select.classList.toggle("dirty", isCellDirty(rowIndex, columnIndex));
          select.classList.toggle("is-null", isNull);
          select.disabled = row.isDeleted;

          select.addEventListener("change", () => {
            const nextValue = select.value;
            const nextIsNull = nextValue === ENUM_NULL_VALUE;
            row.values[columnIndex] = nextIsNull ? "" : nextValue;
            row.nulls[columnIndex] = nextIsNull;
            select.classList.toggle("dirty", isCellDirty(rowIndex, columnIndex));
            select.classList.toggle("is-null", nextIsNull);
            updateDirtyState();
          });

          cellControls.push(select);
          td.appendChild(select);
          tr.appendChild(td);
          return;
        }

        const input = documentObject.createElement("input");
        const value = row.values[columnIndex] ?? "";
        const isNull = row.nulls[columnIndex] === true;
        input.value = value;
        input.dataset.row = String(rowIndex);
        input.dataset.column = String(columnIndex);
        input.classList.toggle("dirty", isCellDirty(rowIndex, columnIndex));
        input.classList.toggle("is-null", isNull);
        input.placeholder = isNull ? "null" : "";
        input.disabled = row.isDeleted;

        input.addEventListener("input", () => {
          const baselineNull = row.isNew
            ? false
            : originalRows[rowIndex]?.nulls[columnIndex] === true;
          const next = computeCellValue(input.value, baselineNull);
          row.values[columnIndex] = next.value;
          row.nulls[columnIndex] = next.isNull;
          input.classList.toggle("dirty", isCellDirty(rowIndex, columnIndex));
          input.classList.toggle("is-null", next.isNull);
          input.placeholder = next.isNull ? "null" : "";
          updateDirtyState();
        });

        cellControls.push(input);
        td.appendChild(input);
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    updateDirtyState();
    if (typeof focusRowIndex === "number") {
      const firstInput = inputAt(focusRowIndex, 0);
      if (firstInput) {
        firstInput.focus();
      }
    }
  }

  function collectChanges(): DataEditorChange[] {
    const changes: DataEditorChange[] = [];

    workingRows.forEach((row: WorkingEditorRow, rowIndex: number) => {
      if (row.isDeleted) {
        if (!row.isNew) {
          changes.push({ kind: "delete", rowIndex });
        }
        return;
      }

      if (row.isNew) {
        const values: DataEditorCellUpdate[] = [];
        state.columns.forEach((_: string, columnIndex: number) => {
          const value = row.values[columnIndex] ?? "";
          const isNull = row.nulls[columnIndex] === true;
          if (!isNull && value === "") {
            return;
          }
          values.push({
            columnIndex,
            value,
            isNull
          });
        });

        if (values.length > 0) {
          changes.push({ kind: "insert", values });
        }
        return;
      }

      const originalRow = originalRows[rowIndex];
      if (!originalRow) {
        return;
      }

      const updates: DataEditorCellUpdate[] = [];
      state.columns.forEach((_: string, columnIndex: number) => {
        const value = row.values[columnIndex] ?? "";
        const isNull = row.nulls[columnIndex] === true;
        const originalValue = originalRow.values[columnIndex] ?? "";
        const originalNull = originalRow.nulls[columnIndex] === true;
        const changed = isNull !== originalNull || (!isNull && value !== originalValue);
        if (!changed) {
          return;
        }
        updates.push({
          columnIndex,
          value,
          isNull
        });
      });

      if (updates.length > 0) {
        changes.push({ kind: "update", rowIndex, updates });
      }
    });

    return changes;
  }

  function resetWorkingRows(): void {
    workingRows = originalRows.map((row: EditorRow) => ({
      values: [...row.values],
      nulls: [...row.nulls],
      isNew: false,
      isDeleted: false
    }));
  }

  if (addRowButton) {
    addRowButton.addEventListener("click", () => {
      workingRows.push(createEmptyRow());
      renderTable(workingRows.length - 1);
    });
  }

  if (!state.loading && !state.error) {
    renderTable();
  }

  if (saveButton) {
    saveButton.addEventListener("click", () => {
      const changes = collectChanges();
      vscode.postMessage({ command: "save", changes });
    });
  }

  if (revertButton) {
    revertButton.addEventListener("click", () => {
      resetWorkingRows();
      renderTable();
    });
  }
})();
