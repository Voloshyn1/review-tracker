import { App, Modal, Notice, Menu, TFile, setIcon } from "obsidian";
import type ReviewTrackerPlugin from "./main";
import { IntervalsModal } from "./intervals-modal";
import { FM_DATE_FORMATS } from "./data-utils";


(function attachFolderModalStyleOnce() {
  const id = 'rr-folder-modals-style';
  if (typeof document === 'undefined' || document.getElementById(id)) return;
  const st = document.createElement('style');
  st.id = id;
  st.textContent = `
  .modal.rr-folder-modal {
    --rrf-title-right-pad: 8px;
    --rrf-x-space: 44px;
  }
  .modal.rr-folder-modal .modal-title {
    padding-left: 0;
    padding-right: var(--rrf-title-right-pad);
    margin: 0;
    max-width: calc(100% - var(--rrf-x-space) - var(--rrf-title-right-pad));
    white-space: normal;
    line-height: 1.3;
    word-break: break-word;
  }

  .modal.rr-folder-modal .modal-content{
    padding: 6px 0 0 0 !important; /* top right bottom left */
  }
  .modal.rr-folder-modal .modal-close-button { top: 8px !important; }
  .modal.rr-folder-modal .modal-content > :first-child { margin-top: 0 !important; }
  .modal.rr-folder-modal .modal-content input[type="text"],
  .modal.rr-folder-modal .modal-content p { margin-bottom: 0 !important; }
  .modal.rr-folder-modal .modal-button-container {
    margin-top: 0 !important;
    padding-top: 24px;
    gap: 12px;
  }


  .modal.rr-folder-modal .rr-move-grid{
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr)); /* рівно 2 стовпці */
    gap: 12px;
    margin-top: 8px;
    max-height: 60vh;
    overflow: auto;
  }


  .modal.rr-folder-modal .rr-move-btn{
    display: flex;                 /* щоб центрувати внутрішній label */
    align-items: center;
    justify-content: center;       /* центруємо, доки вміщається */
    width: 100%;
    padding: 14px 12px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    /* БАЗА трішки світліша */
    background: var(--background-secondary);
    color: var(--text-normal);
    font-size: 0.95em;
    line-height: 1.2;
    cursor: pointer;
    transition: filter .08s ease, background-color .2s ease, border-color .2s ease;
    overflow: visible;
  }

  
  .modal.rr-folder-modal .rr-move-label{
    display: inline-block;
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;   
    text-align: left;          
  }


  .modal.rr-folder-modal .rr-move-btn:hover,
  .modal.rr-folder-modal .rr-move-btn:focus-visible{
    background: var(--background-secondary-alt);
    outline: none;
  }
  .modal.rr-folder-modal .rr-move-btn:focus { outline: none; } /* без контуру мишкою */
  .modal.rr-folder-modal .rr-move-btn:active{ filter: brightness(.96); }


  .modal.rr-folder-modal .rr-move-root{
    grid-column: auto; /* НЕ на всю ширину */
    border: 1px solid var(--background-modifier-border);
    background: var(--background-secondary);
    color: var(--text-normal);
    font-weight: 500;
  }
  .modal.rr-folder-modal .rr-move-root:hover,
  .modal.rr-folder-modal .rr-move-root:focus-visible{
    background: var(--background-secondary-alt);
    outline: none;
    color: var(--text-normal);
  }

  .modal.rr-folder-modal .rr-move-grid{
    margin-right: -12px !important;
    padding-right: 12px !important;
  }
`;

  document.head.appendChild(st);
})();


interface VirtualItem {
  type: 'folder-header' | 'file';
  path?: string;
  folderName?: string;
  folderIndex?: number;
  isCollapsed?: boolean;
  className?: string;
}


export class StatsModal extends Modal {
  plugin: ReviewTrackerPlugin;
  stats: Record<string, { count: number; intervals: number[] }> = {};
  filter: "all" | "completed" | "in-progress" = "all";
  searchQuery: string = "";
  sortMode: "name-asc" | "name-desc" | "ctime-desc" | "ctime-asc" = "ctime-desc";


  private virtualItems: VirtualItem[] = [];
  private rowNodes: Map<number, HTMLElement> = new Map();
  private prevFirstRow: number = -1;
  private prevLastRow: number = -1;
  private rowHeight = 56;
  private containerHeight = 0;
  private scrollTop = 0;
  private tableContainer?: HTMLElement;
  private virtualTableBody?: HTMLElement;
  private resizeObserver?: ResizeObserver;
  private onDocumentClick?: (e: MouseEvent) => void;
  private overscanRows = 12;



  private currentDragPath: string | null = null;
  private currentDragPaths: string[] | null = null;
  private dropOverlayEl?: HTMLElement;
  private folderZones: Array<{ start: number; end: number; folderIndex: number; folderName: string }> = [];

  private onContainerDragOver?: (e: DragEvent) => void;
  private onContainerDrop?: (e: DragEvent) => void;
  private onContainerDragLeave?: (e: DragEvent) => void;


  private selectedPaths: Set<string> = new Set();
  private lastSelectedIndex: number | null = null;

  constructor(app: App, plugin: ReviewTrackerPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const savedFilter = sessionStorage.getItem(SS_FILTER_KEY) as StatsModal["filter"] | null;
    if (savedFilter === "all" || savedFilter === "completed" || savedFilter === "in-progress") {
      this.filter = savedFilter;
    }

    const savedSort = sessionStorage.getItem(SS_SORT_KEY) as StatsModal["sortMode"] | null;
    if (savedSort === "name-asc" || savedSort === "name-desc" || savedSort === "ctime-desc" || savedSort === "ctime-asc") {
      this.sortMode = savedSort;
    }

    const savedSearch = sessionStorage.getItem(SS_SEARCH_KEY);
    if (typeof savedSearch === "string") {
      this.searchQuery = savedSearch.trim().toLowerCase();
    }

    this.modalEl.style.width = "900px";
    this.modalEl.style.height = "90vh";
    this.modalEl.classList.add('repeat-stats-modal');
    const existingStyle = document.getElementById("repeat-stats-style");
    if (!existingStyle) {
      const style = document.createElement("style");
      style.id = "repeat-stats-style";
      style.textContent = `
          :root {

          --col-file: 43%;
          --col-intervals: 57%;

          --lh: 20px;

          --cell-pv: 8px;

          --row-h: calc(var(--lh) * 2 + var(--cell-pv) * 2);


          --intervals-right-limit: 50px; 
          --file-right-limit: 55px;      


          --th-pv: 3px; 

          --gap-search-table: 0px; 


          --rsm-pt: 0px;
          --rsm-h2-mb: 24px;
        }

        .stats-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }
        .stats-table th, .stats-table td {
          padding: 8px 0px;
          text-align: left;
          vertical-align: top;
          box-sizing: border-box;
        }
        .stats-table th {
          font-weight: 400;
          color: var(--text-muted);
        }

        .stats-table th {
          padding-top: var(--th-pv) !important;
          padding-bottom: var(--th-pv) !important;
        }

        .virtual-table-container {
          height: 68vh;
          overflow-y: auto;
          position: relative;
          border: 1px solid var(--background-modifier-border);
          border-radius: 6px;
          max-height: 100%;
          box-sizing: border-box;
        }
        .virtual-table-body {
          position: relative;
          width: 100%;
          contain: layout paint;
        }
        .virtual-row {
          position: absolute;
          width: 100%;
          height: var(--row-h);
          display: grid;
          align-items: center;
          border-bottom: 1px solid var(--background-modifier-border-hover);
          background-color: var(--background-primary);
          box-sizing: border-box;
          grid-template-columns: var(--col-file) var(--col-intervals);
          column-gap: 0;
          contain: content;
        }

        .repeat-stats-modal .virtual-row:hover {
          background-color: var(--background-modifier-hover) !important;
        }

        .virtual-cell {
          padding: var(--cell-pv) 12px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          line-height: var(--lh);
        }

        .virtual-cell.file-cell {
          white-space: normal;
          overflow: hidden;
          padding-right: var(--file-right-limit);
        }
        .virtual-cell.file-cell .file-text {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          line-clamp: 2;
          overflow: hidden;
          white-space: normal;
          max-height: calc(var(--lh) * 2);
          max-width: calc(100% - var(--file-right-limit));
        }
        .virtual-cell.file-cell .file-text a {
          display: inline;
          white-space: normal;
          word-break: break-word;
          overflow-wrap: anywhere;
          text-overflow: ellipsis;
        }

        .virtual-cell.intervals-cell {
          white-space: normal;
          overflow: hidden;
          padding-left: 12px;
          padding-right: var(--intervals-right-limit);
        }
        .virtual-cell.intervals-cell .interval-text {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          line-clamp: 2;
          overflow: hidden;
          white-space: normal;
          max-height: calc(var(--lh) * 2);
          text-align: center;
          width: fit-content;
          max-width: calc(100% - var(--intervals-right-limit));
          margin-inline: auto;
        }


        .pill {
          border-radius: 999px;
          padding: 2px 6px;
          font-size: 0.70em;
          line-height: 1.3em;
          margin: 2px 2px 0 0;
        }

        .virtual-cell.intervals-cell .interval-text .pill{
          height: calc(var(--lh) - 4px);  
          padding: 0 6px;           
          line-height: 1;             
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin: 0 4px 0 0;
        }



        .pill-done { background-color: #4caf50; color: white; }
        .pill-pending { background-color: #55585e; color: #bbb; }
        .repeat-stats-modal .pill-tomorrow {
          background-color: #F4D03F;        
          color: #222;                      
        }
        .repeat-stats-modal .pill-missed {
          background-color: #c84537ff;
          color: #fff;
        }


  
        .virtual-table-container.is-scrolling,
        .virtual-table-container.is-scrolling * { user-select: none !important; }


        .folder-toggle { margin-right: 8px; font-weight: bold; }
        .folder-file-row { padding-left: 36px; }
        .root-file-row .virtual-cell:first-child { padding-left: 32px; }

 
        .button-row {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: center;
          margin-top: 0.5em;
          margin-bottom: 1em;
          justify-content: flex-start;
        }
        .button-row > button {
          padding: 6px 14px;
          font-size: 0.9em;
          border-radius: 6px;
          flex: 0 0 auto;
          width: 130px;

          transition: background-color 0.15s ease, transform 80ms ease, filter 120ms ease;
        }

        .button-row > button:active {
          transform: translateY(0.5px) scale(0.985);
          animation: rr-btn-flash 140ms ease-out;
        }

        .button-row > .custom-dropdown.filter { min-width: 150px; flex: 0 0 auto; }
        .button-row > .custom-dropdown.sort { min-width: 260px; flex: 0 0 auto; }

        .custom-dropdown { position: relative; display: inline-block; margin-top: 0; }
        .dropdown-btn {
          padding: 5px; width: 100%; font-size: 0.9em; box-sizing: border-box;
          border: 1px solid var(--background-modifier-border);
          border-radius: 6px; background-color: var(--background-primary);
          color: var(--text-normal); cursor: pointer; transition: all 0.2s ease;
        }
        .dropdown-btn:focus {
          outline: none;      
          transform: none;    
        }


        .repeat-stats-modal .dropdown-btn:hover,
        .repeat-stats-modal .dropdown-btn:focus-visible{
          background-color: var(--background-secondary-alt);
          box-shadow: none !important;
          outline: none !important;
        }

        .dropdown-list {
          position: absolute; top: 100%; left: 0; right: 0;
          background-color: var(--background-primary);
          border: 1px solid var(--background-modifier-border);
          border-radius: 6px; margin-top: 2px; overflow: hidden;
          max-height: 0; opacity: 0; transition: max-height 0.25s ease, opacity 0.25s ease;
          z-index: 1000;
        }
        .dropdown-list.show { max-height: 500px; opacity: 1; }
        .dropdown-item { padding: 6px 12px; cursor: pointer; transition: background-color 0.2s ease; }
        .dropdown-item:hover { background-color: var(--background-secondary-alt); }


        .folder-label { margin-left: 0px; }
        .folder-header-wrapper {
          display: flex; align-items: center; gap: 4px; padding-left: 0px;
          height: 25px; font-size: 14px;
        }
        .folder-toggle {
          width: 25px; height: 25px; margin-left: 0px; display: flex;
          align-items: center; justify-content: center; color: var(--text-muted);
          transition: transform 0.2s ease; flex-shrink: 0;
        }
        .folder-toggle.is-collapsed { transform: rotate(-90deg); }
        .folder-toggle.is-expanded  { transform: rotate(0deg); }

   
        .custom-modal {
          background-color: var(--background-primary);
          border-radius: 12px; padding: 24px; max-width: 420px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25); font-family: var(--font-interface);
        }
        .modal input[type="text"] {
          width: 100%; padding: 10px 12px; font-size: 0.95em;
          border: 1px solid var(--background-modifier-border); border-radius: 8px;
          background-color: var(--background-secondary); color: var(--text-normal);
          margin-bottom: 20px; box-sizing: border-box; transition: all 0.2s ease;
        }
        .modal input[type="text"]:focus {
          outline: none; border-color: var(--interactive-accent);
          box-shadow: 0 0 0 2px var(--interactive-accent); background-color: var(--background-primary);
        }
        .modal-button-container { display: flex; justify-content: flex-end; gap: 12px; }
        .modal-button-container button {
          padding: 8px 18px; font-size: 0.9em; border-radius: 6px; border: none;
          cursor: pointer; transition: background-color 0.2s ease; font-weight: 500;
          transition: background-color 0.2s ease, transform 80ms ease, filter 120ms ease;
        }
        .modal-button-container button:first-of-type {
          background-color: var(--interactive-accent); color: var(--text-on-accent);
        }
        .modal-button-container button:first-of-type:hover {
          background-color: var(--interactive-accent-hover);
        }
        .modal-button-container button:last-of-type {
          background-color: var(--background-secondary); color: var(--text-muted);
        }
        .modal-button-container button:last-of-type:hover {
          background-color: var(--background-secondary-alt);
        }

        .modal-button-container button:active {
          transform: translateY(0.5px) scale(0.985);
          animation: rr-btn-flash 140ms ease-out;
        }

        .stats-table th:nth-child(1) {
          padding-left: 115px;
          padding-right: var(--file-right-limit);
        }
        .stats-table th:nth-child(2) {
          padding-left: 150px;
          padding-right: var(--intervals-right-limit);
        }


        .repeat-stats-modal .virtual-row.folder-row{
          background-color: var(--background-secondary) !important;
          outline: none !important;
          outline-offset: 0 !important;
        }
        /* Hover для папок — перекриває базовий фон з !important */
        .repeat-stats-modal .virtual-row.folder-row:hover {
          background-color: var(--background-modifier-hover) !important;
        }

        .virtual-row .virtual-cell { display: flex !important; align-items: center !important; }
        .virtual-cell.file-cell .file-text,
        .virtual-cell.intervals-cell .interval-text { align-self: center !important; }

        .search-input{ margin-bottom: 0 !important; }
        .search-input + .stats-table,
        .search-input + .virtual-table-container,
        .search-input + .stats-table + .virtual-table-container{
          margin-top: var(--gap-search-table) !important;
        }

        .repeat-stats-modal .modal-content {
          padding-top: var(--rsm-pt) !important;
        }
        .repeat-stats-modal .modal-content > :first-child { margin-top: 0 !important; }
        .repeat-stats-modal h2 {
          margin: 0 0 var(--rsm-h2-mb) !important;
          line-height: 1.25;
        }
        .repeat-stats-modal .modal-close-button { top: 10px !important; }
        .repeat-stats-modal .button-row { margin-top: 4px !important; }


        .virtual-table-body .folder-drop-overlay {
          position: absolute;
          left: 0; right: 0; top: 0;
          height: 0;
          border: 2px dashed var(--interactive-accent);
          background-color: rgba(120, 160, 255, 0.08);
          border-radius: 6px;
          pointer-events: none;
          z-index: 5;
          display: none;
        }
        .virtual-table-container.drag-active .folder-drop-overlay { display: block; }


        .repeat-stats-modal .virtual-table-container,
        .repeat-stats-modal .virtual-table-body {
          background: var(--background-primary) !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
          text-shadow: none !important;
        }

        .repeat-stats-modal .virtual-row {
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
          text-shadow: none !important;
        }

        /* Vol.shyn author */
        .repeat-stats-modal .virtual-table-container {
          will-change: transform;
          transform: translateZ(0);
          contain: layout paint style;
        }


        .repeat-stats-modal .virtual-row {
          will-change: transform;
        }

        /* ===== Multi-select highlight ===== */
        /* When rows are selected via Ctrl/Cmd click or Shift selection, apply a slightly darker highlight */
        .repeat-stats-modal .virtual-row.selected {
          background-color: var(--background-modifier-hover) !important;
          filter: brightness(0.80);
        }

        @keyframes rr-btn-flash {
          0%   { filter: none; }
          55%  { filter: brightness(1.10); }
          100% { filter: none; }
        }

        /* вже існує і НЕ дублюється:
        .repeat-stats-modal .dropdown-btn:active {
          transform: translateY(0.5px) scale(0.985);
          animation: rr-btn-flash 140ms ease-out;
        }
        */

    `;

      document.head.appendChild(style);
    }

    // Title
    contentEl.createEl("h2", { text: "Review Tracker Statistics" });

    // Row of controls
    const buttonRow = contentEl.createDiv({ cls: "button-row" });
    const createFolderButton = buttonRow.createEl("button", {
      text: "Create folder",
      cls: "dropdown-btn",
    });
    createFolderButton.onclick = async () => {
      new CreateFolderModal(this.app, this.plugin, async (name) => {
        if (!this.plugin.settings.folders.some((f) => f.name === name)) {
          this.plugin.settings.folders.push({ name, collapsed: false, files: [] });
          await this.plugin.saveSettings();
          this.buildVirtualItems();
          this.renderVisibleRows();
        }
      }).open();
    };
    const toggleAllButton = buttonRow.createEl("button", {
      text: "Collapse all",
      cls: "dropdown-btn",
    });
    toggleAllButton.onclick = async () => {
      const currentlyAllCollapsed = this.plugin.settings.folders.every((f) => !!f.collapsed);
      const next = !currentlyAllCollapsed;
      this.plugin.settings.folders.forEach((folder) => {
        folder.collapsed = next;
      });
      toggleAllButton.setText(next ? "Expand all" : "Collapse all");
      await this.plugin.saveSettings();
      this.buildVirtualItems();
      this.renderVisibleRows();
      setTimeout(() => toggleAllButton.blur(), 0);
    };
    const searchInput = contentEl.createEl("input", {
      type: "text",
      cls: "search-input",
      placeholder: "Search files...",
    });


    const savedSearchRaw2 = sessionStorage.getItem(SS_SEARCH_KEY);
    if (typeof savedSearchRaw2 === "string") {
      searchInput.value = savedSearchRaw2;
    }

    searchInput.oninput = () => {
      const raw = searchInput.value;
      sessionStorage.setItem(SS_SEARCH_KEY, raw);
      this.searchQuery = raw.trim().toLowerCase();
      this.buildVirtualItems();
      this.renderVisibleRows();
    };

    // Filter dropdown
    const filterDropdown = buttonRow.createDiv({ cls: "custom-dropdown filter" });
    const filterBtn = filterDropdown.createEl("button", {
      cls: "dropdown-btn",
      text: `Filter: ${FILTER_LABEL[this.filter]}`,
    });

    const filterList = filterDropdown.createDiv({ cls: "dropdown-list" });
    [
      { label: "All", value: "all" },
      { label: "Completed", value: "completed" },
      { label: "In Progress", value: "in-progress" },
    ].forEach((option) => {
      const item = filterList.createDiv({ cls: "dropdown-item", text: option.label });
      item.onclick = () => {
        this.filter = option.value as any;
        filterBtn.setText(`Filter: ${option.label}`);
        filterList.removeClass("show");
        sessionStorage.setItem(SS_FILTER_KEY, this.filter);
        this.buildVirtualItems();
        this.renderVisibleRows();
      };
    });
    filterBtn.onclick = () => {
      filterList.toggleClass("show", !filterList.hasClass("show"));
    };
    // Sort dropdown
    const sortDropdown = buttonRow.createDiv({ cls: "custom-dropdown sort" });
    const sortBtn = sortDropdown.createEl("button", {
      cls: "dropdown-btn",
      text: `Sort: ${SORT_LABEL[this.sortMode]}`,
    });
    const sortList = sortDropdown.createDiv({ cls: "dropdown-list" });
    [
      { label: "By creation date (newest first)", value: "ctime-desc" },
      { label: "By creation date (oldest first)", value: "ctime-asc" },
      { label: "By file name (A → Z)", value: "name-asc" },
      { label: "By file name (Z → A)", value: "name-desc" },
    ].forEach((option) => {
      const item = sortList.createDiv({ cls: "dropdown-item", text: option.label });
      item.onclick = () => {
        this.sortMode = option.value as any;
        sortBtn.setText(`Sort: ${option.label}`);
        sortList.removeClass("show");
        sessionStorage.setItem(SS_SORT_KEY, this.sortMode);
        this.buildVirtualItems();
        this.renderVisibleRows();
      };
    });
    sortBtn.onclick = () => {
      sortList.toggleClass("show", !sortList.hasClass("show"));
    };
    this.onDocumentClick = (e: MouseEvent) => {
      if (!filterDropdown.contains(e.target as Node)) {
        filterList.removeClass("show");
      }
      if (!sortDropdown.contains(e.target as Node)) {
        sortList.removeClass("show");
      }
    };
    // Кнопка Refresh: оновлює статику і перевідмальовує таблицю
    const refreshButton = buttonRow.createEl("button", {
      text: "Refresh",
      cls: "dropdown-btn",
    });
    refreshButton.onclick = () => {
      this.buildStats();
      this.buildVirtualItems();
      this.renderVisibleRows();
      setTimeout(() => refreshButton.blur(), 0);
    };

    document.addEventListener("click", this.onDocumentClick);
    this.initializeVirtualScrolling();
    this.buildStats();
    this.buildVirtualItems();
    this.renderVisibleRows();
  }


  private initializeVirtualScrolling() {
    const headerTable = this.contentEl.createEl("table", { cls: "stats-table" });
    const thead = headerTable.createEl("thead");
    const header = headerTable.createEl("tr");
    ["Files / Folders", "Intervals"].forEach((txt) => {
      header.createEl("th", { text: txt });
    });
    this.tableContainer = this.contentEl.createDiv({ cls: "virtual-table-container" });
    this.virtualTableBody = this.tableContainer.createDiv({ cls: "virtual-table-body" });

    // Create overlay for folder drop zone
    this.dropOverlayEl = this.virtualTableBody.createDiv({ cls: "folder-drop-overlay" });

    // Set up container-level drag and drop handlers
    this.onContainerDragOver = (e: DragEvent) => {
      // Skip if not dragging a file
      if (!this.currentDragPath && !this.currentDragPaths) return;
      e.preventDefault();
      // Mark container as active for drag visuals
      this.tableContainer!.classList.add("drag-active");
      const zone = this.getZoneAtEvent(e);
      if (zone) {
        // Highlight the specific folder zone
        this.positionOverlay(zone);
      } else {
        // No folder under cursor: hide overlay; outside area does not highlight
        this.clearOverlay();
      }
    };
    this.onContainerDrop = async (e: DragEvent) => {
      // Ignore drop events if no file is being dragged
      if (!this.currentDragPath && !this.currentDragPaths) return;
      e.preventDefault();
      const zone = this.getZoneAtEvent(e);
      // Always clear overlay and remove drag-active class
      this.clearOverlay(true);
      if (!zone) {
        // Drop outside any folder: move file(s) to root (remove from all folders)
        await this.handleFileDrop(e, undefined);
        this.currentDragPath = null;
        this.currentDragPaths = null;
        return;
      }
      const targetFolder = this.plugin.settings.folders[zone.folderIndex];
      if (!targetFolder) return;
      // Move selected file(s) only if not already in target
      await this.handleFileDrop(e, targetFolder.name);
      this.currentDragPath = null;
      this.currentDragPaths = null;
    };
    this.onContainerDragLeave = (_e: DragEvent) => {
      this.clearOverlay(true);
    };
    this.tableContainer.addEventListener("dragover", this.onContainerDragOver);
    this.tableContainer.addEventListener("drop", this.onContainerDrop);
    this.tableContainer.addEventListener("dragleave", this.onContainerDragLeave);

    const updateContainerHeight = () => {
      if (this.tableContainer) {
        this.containerHeight = this.tableContainer.clientHeight;
        this.renderVisibleRows();
      }
    };
    updateContainerHeight();
    this.resizeObserver = new ResizeObserver(updateContainerHeight);
    this.resizeObserver.observe(this.tableContainer);
    let rafId: number | null = null;
    let scrollEndTimer: number | null = null;
    const onScroll = () => {
      this.scrollTop = this.tableContainer!.scrollTop;
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          this.renderVisibleRows();
        });
      }
      if (this.tableContainer) {
        this.tableContainer.classList.add("is-scrolling");
        if (scrollEndTimer) clearTimeout(scrollEndTimer);
        scrollEndTimer = window.setTimeout(() => {
          this.tableContainer?.classList.remove("is-scrolling");
          scrollEndTimer = null;
        }, 120);
      }
    };
    this.tableContainer.addEventListener("scroll", onScroll, { passive: true });
  }


  private buildStats() {
    const stats: Record<string, { count: number; intervals: number[] }> = {};
    this.stats = stats;
    const intervals = this.plugin.settings.intervals;
    const files = this.app.vault.getMarkdownFiles();
    const tagKeyword = this.plugin.settings.tag.replace("#", "");
    for (const file of files) {
      const cache = this.app.metadataCache.getCache(file.path);
      const frontmatter = cache?.frontmatter;
      if (!frontmatter) continue;
      const hasKeyword = Object.entries(frontmatter).some(([key, value]) => {
        const keyMatch = key.includes(tagKeyword);
        const valueMatch =
          (typeof value === "string" && value.includes(tagKeyword)) ||
          (Array.isArray(value) && value.some((v) => typeof v === "string" && v.includes(tagKeyword)));
        return keyMatch || valueMatch;
      });
      if (!hasKeyword) continue;
      let foundTimestamp: number | null = null;
      for (const key in frontmatter) {
        const val = frontmatter[key];
        if (typeof val === "string") {
          const m = (window as any).moment?.(val.trim(), [...FM_DATE_FORMATS], true);
          if (m?.isValid?.()) { foundTimestamp = m.valueOf(); break; }
        }
      }
      if (foundTimestamp == null) continue;
      const path = file.path;
      stats[path] = { count: 0, intervals: [] };
      for (const interval of intervals) {
        const statusKey = `${path}:::${interval}`;
        if (this.plugin.readStatus.has(statusKey)) {
          stats[path].intervals.push(interval);
          stats[path].count += 1;
        }
      }
    }
  }

  private compareFolderNames(a: string, b: string): number {
    return (a ?? "").toLowerCase().localeCompare((b ?? "").toLowerCase());
  }


  private buildVirtualItems() {
    this.virtualItems = [];
    this.folderZones = [];
    const validPaths = new Set(Object.keys(this.stats));
    const allFolderFiles = new Set(this.plugin.settings.folders.flatMap((f) => f.files));
    const sortedFolders = this.plugin.settings.folders
      .map((folder, folderIndex) => ({ folder, folderIndex }))
      .sort((x, y) => this.compareFolderNames(x.folder.name, y.folder.name));

    for (const { folder, folderIndex } of sortedFolders) {
      // Add folder header row
      this.virtualItems.push({
        type: 'folder-header',
        folderName: folder.name,
        folderIndex,
        isCollapsed: folder.collapsed,
        className: 'folder-row',
      });
      const headerIndex = this.virtualItems.length - 1;
      if (!folder.collapsed) {
        const sortedFiles = folder.files.slice().sort((a, b) => this.sortFiles(a, b));
        sortedFiles
          .filter((f) => validPaths.has(f) && this.shouldShowFile(f))
          .forEach((path) => {
            this.virtualItems.push({ type: 'file', path, className: 'folder-file-row' });
          });
        const endIndex = this.virtualItems.length;
        this.folderZones.push({
          start: headerIndex,
          end: endIndex,
          folderIndex,
          folderName: folder.name,
        });
      }
    }

    const sortedStatsKeys = Object.keys(this.stats)
      .filter((p) => !allFolderFiles.has(p))
      .sort((a, b) => this.sortFiles(a, b));
    sortedStatsKeys
      .filter((path) => this.shouldShowFile(path))
      .forEach((path) => {
        this.virtualItems.push({ type: 'file', path, className: 'root-file-row' });
      });
    const totalHeight = this.virtualItems.length * this.rowHeight;
    if (this.virtualTableBody) {
      this.virtualTableBody.style.height = `${totalHeight}px`;

      this.virtualTableBody.replaceChildren();
    }

    // V.loshyn author
 
    this.rowNodes.clear();
    this.prevFirstRow = -1;
    this.prevLastRow = -1;

    const newSet = new Set<string>();
    for (const item of this.virtualItems) {
      if (item.type === 'file' && item.path && this.selectedPaths.has(item.path)) {
        newSet.add(item.path);
      }
    }
    this.selectedPaths = newSet;
    if (this.selectedPaths.size === 0) {
      this.lastSelectedIndex = null;
    }
  }


  private shouldShowFile(path: string): boolean {
    if (!this.stats[path]) return false;
    const fileName = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
    if (this.searchQuery && !fileName.toLowerCase().includes(this.searchQuery)) return false;
    const done = this.stats[path].intervals.length;
    const totalIntervals = this.plugin.settings.intervals.length;
    if (this.filter === "completed" && done !== totalIntervals) return false;
    if (this.filter === "in-progress" && done === totalIntervals) return false;
    return true;
  }


  private sortFiles(a: string, b: string): number {
    const basename = (p: string) => (p.split("/").pop() || p).toLowerCase();
    if (this.sortMode.startsWith("name")) {
      const nameA = basename(a);
      const nameB = basename(b);
      return this.sortMode === "name-asc" ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
    } else {
      const cacheA = this.app.metadataCache.getCache(a);
      const cacheB = this.app.metadataCache.getCache(b);
      const dateA = this.getFrontmatterDate(cacheA);
      const dateB = this.getFrontmatterDate(cacheB);
      if (dateA === dateB) {
        const nameA = basename(a);
        const nameB = basename(b);
        return nameA.localeCompare(nameB);
      }
      return this.sortMode === "ctime-asc" ? dateA - dateB : dateB - dateA;
    }
  }


  private getFrontmatterDate(cache: any): number {
    if (!cache?.frontmatter) return 0;
    for (const key in cache.frontmatter) {
      const val = cache.frontmatter[key];
      if (typeof val === "string") {
        const m = (window as any).moment?.(val.trim(), [...FM_DATE_FORMATS], true);
        if (m?.isValid?.()) return m.valueOf();
      }
    }
    return 0;
  }


  private renderVisibleRows() {

    if (!this.virtualTableBody) return;

    const firstRow = Math.max(0, Math.floor(this.scrollTop / this.rowHeight) - this.overscanRows);
    const visibleCount = Math.ceil(this.containerHeight / this.rowHeight) + 1 + this.overscanRows * 2;
    const lastRow = Math.min(firstRow + visibleCount, this.virtualItems.length);

    if (firstRow === this.prevFirstRow && lastRow === this.prevLastRow) {
      return;
    }
    this.prevFirstRow = firstRow;
    this.prevLastRow = lastRow;

    const needed = new Set<number>();
    for (let i = firstRow; i < lastRow; i++) {
      needed.add(i);
    }
    // Remove row nodes that are no longer needed.
    for (const [idx, el] of this.rowNodes) {
      if (!needed.has(idx)) {
        el.remove();
        this.rowNodes.delete(idx);
      }
    }
    // Create new rows for indices not yet rendered.
    const frag = document.createDocumentFragment();
    for (const idx of needed) {
      if (this.rowNodes.has(idx)) continue;
      const item = this.virtualItems[idx];
      if (!item) continue;
      const row = this.createVirtualRow(item, idx);
      this.rowNodes.set(idx, row);
      frag.appendChild(row);
    }
    this.virtualTableBody.appendChild(frag);
    // Update selection classes on reused rows.  Without this, previously
    // selected rows that are reused may not receive the `selected` class.
    this.updateSelectedClasses();
  }


  private createVirtualRow(item: VirtualItem, index: number): HTMLElement {
    const row = document.createElement("div");
    row.className = `virtual-row${item.className ? ' ' + item.className : ''}`;
    row.style.transform = `translate3d(0, ${index * this.rowHeight}px, 0)`;

    row.setAttribute("data-index", index.toString());
    if (item.type === 'folder-header') {
      this.createFolderHeaderRow(row, item);
    } else if (item.type === 'file' && item.path) {
      this.createFileRow(row, item.path, index);
    }
    return row;
  }


  private createFolderHeaderRow(row: HTMLElement, item: VirtualItem) {
    const folder = this.plugin.settings.folders[item.folderIndex!];
    const headerCell = row.createDiv({ cls: "virtual-cell" });
    headerCell.style.gridColumn = "1 / -1";
    const headerWrapper = headerCell.createDiv({ cls: "folder-header-wrapper" });
    const toggle = headerWrapper.createDiv({
      cls: `folder-toggle ${folder.collapsed ? 'is-collapsed' : 'is-expanded'}`,
    });
    setIcon(toggle, "chevron-down");
    headerWrapper.createSpan({ text: folder.name, cls: "folder-label" });
    row.onclick = async () => {
      folder.collapsed = !folder.collapsed;
      await this.plugin.saveSettings();
      this.buildVirtualItems();
      this.renderVisibleRows();
    };
    row.oncontextmenu = (e: MouseEvent) => {
      e.preventDefault();
      this.showFolderContextMenu(e, folder);
    };
    row.ondragover = (e) => {
      e.preventDefault();
      row.style.backgroundColor = "var(--background-modifier-hover)";
    };
    row.ondragleave = () => {
      row.style.backgroundColor = "";
    };
    row.ondrop = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.style.backgroundColor = "";
      await this.handleFileDrop(e, folder.name);
    };
  }


  private createFileRow(row: HTMLElement, path: string, index: number) {
    const stats = this.stats[path];
    const intervals = this.plugin.settings.intervals;
    const fileName = path.split("/").pop()?.replace(/\.md$/, "") ?? path;

    // File name cell
    const nameCell = row.createDiv({ cls: "virtual-cell file-cell" });
    const fileText = nameCell.createSpan({ cls: "file-text" });
    const link = fileText.createEl("a", { text: fileName, href: "#" });
    link.onclick = (e) => {
      e.preventDefault();
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file && file instanceof TFile) {
        this.app.workspace.getLeaf(true).openFile(file);
        this.close();
      }
    };


    let tomorrowInterval: number | null = null;
    let createdUTC: number | null = null;
    let todayUTC: number | null = null;
    const msPerDay = 86_400_000;

    if (this.plugin.settings.highlightOneDayInStats || this.plugin.settings.highlightMissedIntervals) {
      const cache = this.app.metadataCache.getCache(path);
      let createdTs = this.getFrontmatterDate(cache); // returns ms or 0
      if (!createdTs) {
        const f = this.app.vault.getAbstractFileByPath(path);
        if (f && f instanceof TFile) createdTs = f.stat.ctime;
      }

      if (createdTs) {
        const created = new Date(createdTs);
        const today = new Date();
        createdUTC = Date.UTC(created.getFullYear(), created.getMonth(), created.getDate());
        todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
        const diffDaysSigned = Math.floor((todayUTC - createdUTC) / msPerDay); // may be < 0
        if (diffDaysSigned >= 0) {
          tomorrowInterval = diffDaysSigned + 1;
        } else {
          tomorrowInterval = null; 
        }
      }
    }

    // Intervals cell
    const intervalCell = row.createDiv({ cls: "virtual-cell intervals-cell" });
    const intervalWrapper = intervalCell.createDiv({ cls: "interval-text" });
    [...intervals]
      .sort((a, b) => a - b)
      .forEach((i) => {
        const isDone = stats.intervals.includes(i);
        const classes = ["pill", isDone ? "pill-done" : "pill-pending"];

        // Missed: dueDate < today (UTC) and not done
        if (
          this.plugin.settings.highlightMissedIntervals &&
          createdUTC != null && todayUTC != null &&
          !isDone &&
          (createdUTC + i * msPerDay) < todayUTC
        ) {
          classes.push("pill-missed");
        }

        // Tomorrow: exact match to computed tomorrowInterval and not done
        if (
          this.plugin.settings.highlightOneDayInStats &&
          tomorrowInterval != null &&
          i === tomorrowInterval &&
          !isDone
        ) {
          classes.push("pill-tomorrow");
        }

        intervalWrapper.createSpan({
          cls: classes.join(" "),
          text: `${i}d`,
        });
      });

    row.setAttribute("draggable", "true");
    row.ondragstart = (e) => {
      if (this.selectedPaths.size > 1 && this.selectedPaths.has(path)) {
        this.currentDragPaths = Array.from(this.selectedPaths);
      } else {
        this.currentDragPaths = [path];
      }
      this.currentDragPath = path;
      e.dataTransfer?.setData("text/plain", path);
      this.tableContainer?.classList.add("drag-active");
    };
    row.ondragend = () => {
      this.currentDragPath = null;
      this.currentDragPaths = null;
      this.clearOverlay(true);
    };
    row.oncontextmenu = (e: MouseEvent) => {
      e.preventDefault();
      this.showFileContextMenu(e, path);
    };
    row.addEventListener("dblclick", () => {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file && file instanceof TFile) {
        const modal = new IntervalsModal(this.app, this.plugin, file, this.plugin.settings.intervals);

        // After closing modal — refresh only this file row
        const prevOnClose = (modal as any).onClose?.bind(modal);
        (modal as any).onClose = () => {
          try { prevOnClose && prevOnClose(); }
          finally { this.refreshSingleFile(path); }
        };

        modal.open();
      }
    });


    row.addEventListener("click", (e) => {
      // ignore clicks on link targets (they open files)
      if ((e.target as HTMLElement).closest("a")) return;
      this.handleRowClick(e as MouseEvent, path, index);
    });

    // Apply selected class if path is currently selected
    if (this.selectedPaths.has(path)) {
      row.classList.add("selected");
    }
  }




private handleRowClick(e: MouseEvent, path: string, index: number) {
  const shift = e.shiftKey;
  const meta  = e.ctrlKey || e.metaKey; // Ctrl (Win/Linux) або Cmd (macOS)


  if (shift) {
    if (this.lastSelectedIndex === null) {
      this.selectedPaths.clear();
      this.selectedPaths.add(path);
      this.lastSelectedIndex = index;
      this.updateSelectedClasses();
      return;
    }
    const start = Math.min(this.lastSelectedIndex, index);
    const end   = Math.max(this.lastSelectedIndex, index);
    this.selectedPaths.clear();
    for (let i = start; i <= end; i++) {
      const item = this.virtualItems[i];
      if (item && item.type === 'file' && item.path) {
        this.selectedPaths.add(item.path);
      }
    }
    this.updateSelectedClasses();
    return;
  }

  // CTRL/CMD: перемикаємо тільки цей елемент, якір переносимо сюди
  if (meta) {
    if (this.selectedPaths.has(path)) {
      this.selectedPaths.delete(path);
      this.lastSelectedIndex = this.selectedPaths.size ? index : null;
    } else {
      this.selectedPaths.add(path);
      this.lastSelectedIndex = index;
    }
    this.updateSelectedClasses();
    return;
  }

  // Звичайний ЛКМ: скинути все виділення (і якорі)
  this.clearSelection();
}






  private clearSelection() {
    this.selectedPaths.clear();
    this.lastSelectedIndex = null;
    this.currentDragPaths = null;
    this.currentDragPath = null;
    this.updateSelectedClasses();
  }


  private updateSelectedClasses() {
    for (const [idx, row] of this.rowNodes) {
      const item = this.virtualItems[idx];
      if (item && item.type === 'file' && item.path) {
        if (this.selectedPaths.has(item.path)) {
          row.classList.add('selected');
        } else {
          row.classList.remove('selected');
        }
      } else {
        row.classList.remove('selected');
      }
    }
  }


  private showFolderContextMenu(e: MouseEvent, folder: any) {
    const menu = new Menu();
    menu.addItem((item) =>
      item.setTitle("Rename").onClick(() => {
        new EditFolderModal(this.app, this.plugin, folder.name, async (newName) => {
          const normalizedNew = newName.trim().toLowerCase();
          const normalizedOld = folder.name.trim().toLowerCase();
          if (
            this.plugin.settings.folders.some(
              (f) => f.name.trim().toLowerCase() === normalizedNew && f.name.trim().toLowerCase() !== normalizedOld,
            )
          ) {
            new Notice("Folder with this name already exists.");
            return;
          }
          folder.name = newName;
          await this.plugin.saveSettings();
          this.buildVirtualItems();
          this.renderVisibleRows();
        }).open();
      }),
    );
    menu.addItem((item) =>
      item.setTitle("Delete").onClick(() => {
        new ConfirmModal(
          this.app,
          `Are you sure you want to delete folder "${folder.name}"?\nAll files will remain.`,
          async () => {
            this.plugin.settings.folders = this.plugin.settings.folders.filter((f) => f.name !== folder.name);
            await this.plugin.saveSettings();
            this.buildVirtualItems();
            this.renderVisibleRows();
          },
        ).open();
      }),
    );
    menu.showAtMouseEvent(e);
  }


  private showFileContextMenu(e: MouseEvent, path: string) {
    const menu = new Menu();
    const isMulti = this.selectedPaths.size > 1 && this.selectedPaths.has(path);

    if (isMulti) {
      menu.addItem((item) =>
        item.setTitle("Move selected to...").onClick(() => {
          // Open modal to choose target folder for multiple files
          new MoveFilesModal(this.app, this.plugin, Array.from(this.selectedPaths), () => {
            this.buildVirtualItems();
            this.renderVisibleRows();
            this.clearSelection();
          }).open();
        }),
      );
      menu.addItem((item) =>
        item.setTitle("Move selected outside folders").onClick(async () => {
          // Remove all selected files from all folders
          for (const f of this.plugin.settings.folders) {
            f.files = f.files.filter((p) => !this.selectedPaths.has(p));
          }
          await this.plugin.saveSettings();
          this.buildVirtualItems();
          this.renderVisibleRows();
          this.clearSelection();
        }),
      );
    } else {
      //  Edit intervals for a single file 
      menu.addItem((item) =>
        item
          .setTitle("Edit intervals…")
          .onClick(() => {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file && file instanceof TFile) {
              const modal = new IntervalsModal(this.app, this.plugin, file, this.plugin.settings.intervals);


              const prevOnClose = (modal as any).onClose?.bind(modal);
              (modal as any).onClose = () => {
                try { prevOnClose && prevOnClose(); }
                finally { this.refreshSingleFile(path); }
              };

              modal.open();
            }
          }),
      );

      menu.addSeparator();

      // Single file actions
      menu.addItem((item) =>
        item.setTitle("Move to...").onClick(() => {
          new MoveFileModal(this.app, this.plugin, path, () => {
            this.buildVirtualItems();
            this.renderVisibleRows();
          }).open();
        }),
      );
      menu.addItem((item) =>
        item
          .setTitle("Move outside folders")
          .onClick(async () => {
            for (const f of this.plugin.settings.folders) {
              f.files = f.files.filter((p) => p !== path);
            }
            await this.plugin.saveSettings();
            this.buildVirtualItems();
            this.renderVisibleRows();
          }),
      );
    }

    menu.showAtMouseEvent(e);
  }



  private async handleFileDrop(e: DragEvent, targetFolderName?: string) {

    const pathFromEvent = e.dataTransfer?.getData("text/plain");
    let paths: string[] | null = null;
    if (this.currentDragPaths && this.currentDragPaths.length > 0) {
      paths = this.currentDragPaths;
    } else if (pathFromEvent) {
      paths = [pathFromEvent];
    }
    if (!paths || paths.length === 0) return;
    if (!targetFolderName) {
      for (const p of paths) {
        for (const f of this.plugin.settings.folders) {
          f.files = f.files.filter((file) => file !== p);
        }
      }
      await this.plugin.saveSettings();
      this.buildVirtualItems();
      this.renderVisibleRows();
      this.clearSelection();
      return;
    }
    for (const p of paths) {
      const curFolder = this.findFolderOfPath(p);
      if (curFolder && curFolder.name === targetFolderName) {
        continue;
      }
      await this.moveFileToFolder(p, targetFolderName);
    }
    this.clearSelection();
  }


  refreshSingleFile(path: string) {
    this.buildStats();
    this.buildVirtualItems();
    this.renderVisibleRows();
  }

  onClose() {
    if (this.onDocumentClick) {
      document.removeEventListener("click", this.onDocumentClick);
      this.onDocumentClick = undefined;
    }
    if (this.resizeObserver && this.tableContainer) {
      this.resizeObserver.unobserve(this.tableContainer);
      this.resizeObserver = undefined;
    }
    // Remove container-level drag handlers and overlay
    if (this.tableContainer) {
      if (this.onContainerDragOver) {
        this.tableContainer.removeEventListener("dragover", this.onContainerDragOver);
      }
      if (this.onContainerDrop) {
        this.tableContainer.removeEventListener("drop", this.onContainerDrop);
      }
      if (this.onContainerDragLeave) {
        this.tableContainer.removeEventListener("dragleave", this.onContainerDragLeave);
      }
    }
    this.onContainerDragOver = undefined;
    this.onContainerDrop = undefined;
    this.onContainerDragLeave = undefined;
    if (this.dropOverlayEl) {
      this.dropOverlayEl.remove();
      this.dropOverlayEl = undefined;
    }
    this.currentDragPath = null;
    this.currentDragPaths = null;
    this.folderZones = [];
    this.selectedPaths.clear();
    this.lastSelectedIndex = null;
    this.contentEl.empty();
  }


  private rowIndexFromClientY(clientY: number): number {
    if (!this.tableContainer) return -1;
    const rect = this.tableContainer.getBoundingClientRect();
    const y = clientY - rect.top + this.scrollTop;
    const idx = Math.floor(y / this.rowHeight);
    return Math.min(Math.max(idx, 0), this.virtualItems.length - 1);
  }


  private getZoneAtEvent(e: DragEvent) {
    const i = this.rowIndexFromClientY(e.clientY);
    for (const z of this.folderZones) {
      if (i >= z.start && i < z.end) {
        return z;
      }
    }
    return null;
  }


  private positionOverlay(zone: { start: number; end: number }) {
    if (!this.dropOverlayEl) return;
    const top = zone.start * this.rowHeight;
    const height = (zone.end - zone.start) * this.rowHeight;
    this.dropOverlayEl.style.top = `${top}px`;
    this.dropOverlayEl.style.height = `${height}px`;
  }


  private clearOverlay(full = false) {
    if (this.dropOverlayEl) {
      this.dropOverlayEl.style.height = `0px`;
    }
    if (full && this.tableContainer) {
      this.tableContainer.classList.remove("drag-active");
    }
  }


  private findFolderOfPath(path: string) {
    return this.plugin.settings.folders.find(f => f.files.includes(path)) ?? null;
  }


  private async moveFileToFolder(path: string, targetFolderName: string) {
    // Remove from all folders
    for (const f of this.plugin.settings.folders) {
      f.files = f.files.filter(p => p !== path);
    }

    const target = this.plugin.settings.folders.find(f => f.name === targetFolderName);
    if (target && !target.files.includes(path)) {
      target.files.push(path);
    }
    await this.plugin.saveSettings();
    this.buildVirtualItems();
    this.renderVisibleRows();
  }
}



class CreateFolderModal extends Modal {
  plugin: ReviewTrackerPlugin;
  onSubmit: (name: string) => void;

  constructor(app: App, plugin: ReviewTrackerPlugin, onSubmit: (name: string) => void) {
    super(app);
    this.plugin = plugin;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    this.modalEl.addClass('rr-folder-modal');
    this.setTitle("Enter new folder name");

    const input = contentEl.createEl("input", {
      type: "text",
      attr: { placeholder: "For example: English course" },
    });
    input.focus();

    const btns = contentEl.createDiv({ cls: "modal-button-container" });

    const createBtn = btns.createEl("button", { text: "Create" });
    createBtn.onclick = () => {
      const name = input.value.trim();
      if (!name) return;
      const normalizedNewName = name.toLowerCase();
      const nameExists = this.plugin.settings.folders.some(
        (f) => f.name.trim().toLowerCase() === normalizedNewName
      );
      if (nameExists) {
        new Notice("A folder with this name already exists.");
        return;
      }
      this.close();
      this.onSubmit(name);
    };

    const cancelBtn = btns.createEl("button", { text: "Cancel" });
    cancelBtn.onclick = () => this.close();


    const keyHandler = (e: KeyboardEvent) => {
      if (e.isComposing) return; // не ліземо в IME
      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        createBtn.click();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    };
    this.modalEl.addEventListener("keydown", keyHandler);

    (this as any)._keyHandler = keyHandler;
  }

  onClose() {
    const kh = (this as any)._keyHandler as ((e: KeyboardEvent)=>void) | undefined;
    if (kh) this.modalEl.removeEventListener("keydown", kh);

    this.contentEl.empty();
    setTimeout(() => {
      const createBtn = document.querySelector('button.dropdown-btn');
      if (createBtn instanceof HTMLButtonElement) createBtn.blur();
    }, 0);
  }

}


class EditFolderModal extends Modal {
  constructor(
    app: App,
    private plugin: ReviewTrackerPlugin,
    private oldName: string,
    private onSubmit: (newName: string) => void,
  ) {
    super(app);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    // Apply compact folder modal class and set title
    this.modalEl.addClass('rr-folder-modal');
    this.setTitle("Rename folder: " + this.oldName);
    const input = contentEl.createEl("input", { type: "text", value: this.oldName });
    input.focus();
    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
    const saveButton = buttonContainer.createEl("button", { text: "Save" });
    saveButton.onclick = () => {
      const newName = input.value.trim();
      if (!newName || newName === this.oldName) return;
      const normalizedNew = newName.trim().toLowerCase();
      const normalizedOld = this.oldName.trim().toLowerCase();
      const nameExists = this.plugin.settings.folders.some(
        (f) => f.name.trim().toLowerCase() === normalizedNew && f.name.trim().toLowerCase() !== normalizedOld,
      );
      if (nameExists) {
        new Notice("Folder with this name already exists.");
        return;
      }
      this.onSubmit(newName);
      this.close();
    };
    const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
    cancelButton.onclick = () => this.close();


  const keyHandler = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      saveButton.click();
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.close();
    }
  };
  this.modalEl.addEventListener("keydown", keyHandler);
  (this as any)._keyHandler = keyHandler;

  }
  onClose() {
    const kh = (this as any)._keyHandler as ((e: KeyboardEvent)=>void) | undefined;
    if (kh) this.modalEl.removeEventListener("keydown", kh);
    this.contentEl.empty();
  }
}

class ConfirmModal extends Modal {
  constructor(
    app: App,
    private message: string,
    private onConfirm: () => void,
  ) {
    super(app);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    this.modalEl.addClass('rr-folder-modal');
    this.setTitle("Are you sure?");
    contentEl.createEl("p", { text: this.message });
    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
    const confirmButton = buttonContainer.createEl("button", { text: "Delete", cls: "mod-warning" });
    confirmButton.onclick = () => {
      this.onConfirm();
      this.close();
    };
    const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
    cancelButton.onclick = () => this.close();
  }
  onClose() {
    this.contentEl.empty();
  }
}

class MoveFileModal extends Modal {
  constructor(
    app: App,
    private plugin: ReviewTrackerPlugin,
    private filePath: string,
    private onMoved: () => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    this.modalEl.addClass('rr-folder-modal');
    this.setTitle("Move file to folder");

    const grid = contentEl.createDiv({ cls: "rr-move-grid" });


    for (const folder of this.plugin.settings.folders) {
      const btn = grid.createEl("button", { cls: "rr-move-btn" });
      btn.createSpan({ cls: "rr-move-label", text: folder.name });
      btn.setAttr("aria-label", folder.name);   // доступність

      btn.onclick = async () => {
        for (const f of this.plugin.settings.folders) {
          f.files = f.files.filter((p) => p !== this.filePath);
        }
        const target = this.plugin.settings.folders.find((f) => f.name === folder.name);
        if (target && !target.files.includes(this.filePath)) {
          target.files.push(this.filePath);
        }
        await this.plugin.saveSettings();
        this.close();
        this.onMoved();
      };
    }


    const rootBtn = grid.createEl("button", { cls: "rr-move-btn rr-move-root" });
    rootBtn.createSpan({ cls: "rr-move-label", text: "Move outside folders" });


    rootBtn.onclick = async () => {
      for (const f of this.plugin.settings.folders) {
        f.files = f.files.filter((p) => p !== this.filePath);
      }
      await this.plugin.saveSettings();
      this.close();
      this.onMoved();
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}

class MoveFilesModal extends Modal {
  constructor(
    app: App,
    private plugin: ReviewTrackerPlugin,
    private filePaths: string[],
    private onMoved: () => void,
  ) {
    super(app);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass('rr-folder-modal');
    this.setTitle("Move selected files to folder");
    const grid = contentEl.createDiv({ cls: "rr-move-grid" });

    for (const folder of this.plugin.settings.folders) {
      const btn = grid.createEl("button", { cls: "rr-move-btn" });
      btn.createSpan({ cls: "rr-move-label", text: folder.name });
      btn.setAttr("aria-label", folder.name);
      btn.onclick = async () => {
        // remove all selected files from any folder
        for (const f of this.plugin.settings.folders) {
          f.files = f.files.filter((p) => !this.filePaths.includes(p));
        }
     
        const target = this.plugin.settings.folders.find((f) => f.name === folder.name);
        if (target) {
          for (const p of this.filePaths) {
            if (!target.files.includes(p)) {
              target.files.push(p);
            }
          }
        }
        await this.plugin.saveSettings();
        this.close();
        this.onMoved();
      };
    }
    // move outside folders
    const rootBtn = grid.createEl("button", { cls: "rr-move-btn rr-move-root" });
    rootBtn.createSpan({ cls: "rr-move-label", text: "Move outside folders" });
    rootBtn.onclick = async () => {
      for (const f of this.plugin.settings.folders) {
        f.files = f.files.filter((p) => !this.filePaths.includes(p));
      }
      await this.plugin.saveSettings();
      this.close();
      this.onMoved();
    };

    setTimeout(() => {
      const el = document.activeElement as HTMLElement | null;
      if (el && this.modalEl.contains(el)) el.blur();
    }, 0);

  }
  onClose() {
    this.contentEl.empty();
  }
}




function formatDate(date: Date): string {
  const m = (window as any).moment;
  if (m && typeof m === 'function') {
    return m(date).format('DD.MM.YYYY');
  }
  const day = `${date.getDate()}`.padStart(2, '0');
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const year = `${date.getFullYear()}`;
  return `${day}.${month}.${year}`;
}

function wholeDaysBetweenUTC(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.max(0, Math.floor((b - a) / 86_400_000)); // 24*60*60*1000
}


function attachHoverTooltips(modal: StatsModal): void {
  const container = (modal as any).tableContainer as HTMLElement | undefined;
  if (!container) return;
  // Inject global styles for tooltip and arrow once
  const styleId = 'stats-tooltip-style';
  if (!document.getElementById(styleId)) {
    const st = document.createElement('style');
    st.id = styleId;
    st.textContent = `
      .stats-tooltip-box {
        position: fixed;
        z-index: 10000;
        padding: 8px 12px;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        pointer-events: none;
        background-color: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
        /* Make font slightly smaller and remove bolding */
        font-size: 0.8em;
        font-weight: normal;
        line-height: 1.4em;
        color: var(--text-normal);
        /* Ensure long text wraps and the tooltip doesn't become too wide */
        max-width: 400px;
        white-space: normal;
        word-wrap: break-word;
      }
      /* v0l.shyn auth.r */
      .stats-tooltip-box strong {
        font-weight: normal;
      }
    `;
    document.head.appendChild(st);
  }

  const initialDelay = modal.plugin?.settings?.tooltipInitialDelayMs ?? 1000;
  const resetDelay   = modal.plugin?.settings?.tooltipResetDelayMs ?? 200;
  let timer: number | null = null;
  let tooltip: HTMLElement | null = null;
  let activeRow: HTMLElement | null = null;
  // Track whether at least one tooltip has been shown during this session.  Once true,
  // subsequent tooltips will appear instantly when hovering a new row.
  let hasShownOnce: boolean = false;
  // Start a short timer to reset hasShownOnce when the user is not hovering any row.
  let resetTimer: number | null = null;
  // Helper to schedule reset of hasShownOnce after the user has not hovered any row for >200ms.
  const startResetTimer = () => {
    if (resetTimer !== null) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }
    resetTimer = window.setTimeout(() => {
      hasShownOnce = false;
      resetTimer = null;
    }, resetDelay);
  };
  // Remove current tooltip and clear timer
  const hideTooltip = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    if (tooltip) {
      tooltip.remove();
      tooltip = null;
    }
    activeRow = null;
  };
  // Build and display tooltip for the given row/item, positioned to the side with arrow
  const showTooltip = (row: HTMLElement, item: VirtualItem) => {
    hideTooltip();
    const box = document.createElement('div');
    box.classList.add('stats-tooltip-box');
    // Tooltip content
    if (item.type === 'file' && item.path) {
      const filePath = item.path;
      // File name without .md
      const fileName = filePath.split('/').pop()?.replace(/\.md$/, '') ?? filePath;
      // Determine creation date from frontmatter (e.g. "created" tag) or fallback to file stat
      let createdDate: Date | null = null;
      const cache = modal.app.metadataCache.getCache(filePath);
      const fm = cache?.frontmatter;
      if (fm) {
        for (const key in fm) {
          const val: any = (fm as any)[key];
          if (typeof val === 'string') {
            const m = (window as any).moment?.(val.trim(), FM_DATE_FORMATS, true);
            if (m?.isValid?.()) {
              createdDate = m.toDate();
              break;
            }
            const d = new Date(val);
            if (!isNaN(d.valueOf())) { createdDate = d; break; }
          }
        }
      }

      // If no frontmatter date, fallback to file system creation
      const file = modal.app.vault.getAbstractFileByPath(filePath);
      if (!createdDate && file && file instanceof TFile) {
        createdDate = new Date(file.stat.ctime);
      }


      const createdStr = createdDate ? formatDate(createdDate) : 'Unknown';
      const daysSince = createdDate ? wholeDaysBetweenUTC(createdDate, new Date()) : null;

      const stats = modal.stats[filePath];
      const doneCount = stats ? stats.intervals.length : 0;
      const totalCount = modal.plugin.settings.intervals.length;
      // Determine next interval and its due date relative to today
      let nextInterval: number | null = null;
      let nextDueDate: Date | null = null;
      const allIntervals: number[] = modal.plugin.settings.intervals.slice().sort((a, b) => a - b);
      const now = new Date();
      for (const i of allIntervals) {
        if (!stats || !stats.intervals.includes(i)) {
          if (createdDate) {
            const dueD = new Date(createdDate.getTime() + i * 24 * 60 * 60 * 1000);
            if (dueD >= now) {
              nextInterval = i;
              nextDueDate = dueD;
              break;
            }
          } else {
            nextInterval = i;
            break;
          }
        }
      }
      // Compose tooltip lines
      let html = `<strong>${fileName}</strong><br><br>`;
      html += `Creation date: ${createdStr}${daysSince !== null ? ` (${daysSince} days ago)` : ''}<br>`;
      html += `Progress: ${doneCount} / ${totalCount}<br>`;
      if (nextInterval != null) {
        if (nextDueDate && createdDate) {
          const dueStr = formatDate(nextDueDate);
          html += `Next review: ${dueStr} (Interval: ${nextInterval}d)`;
        } else {
          html += `Next review: N/A (Interval: ${nextInterval}d)`;
        }
      } else {
        html += `Next review: none (all intervals complete)`;
      }
      box.innerHTML = html;
    } else if (item.type === 'folder-header' && typeof item.folderIndex === 'number') {
      const folder = modal.plugin.settings.folders[item.folderIndex];
      const fileCount = folder.files.length;
      box.innerHTML = `<strong>${folder.name}</strong><br>` +
        `${fileCount} ${fileCount === 1 ? 'file' : 'files'}`;
    }
    document.body.appendChild(box);
    tooltip = box;
    // Positioning
    // Compute bounding boxes after insertion to know tooltip size
    const rowRect = row.getBoundingClientRect();
    const tipRect = box.getBoundingClientRect();
    // Vertical position: center on row vertically, adjust to stay on screen
    let top = rowRect.top + (rowRect.height - tipRect.height) / 2;
    if (top < 4) top = 4;
    if (top + tipRect.height > window.innerHeight - 4) {
      top = window.innerHeight - tipRect.height - 4;
    }
    // Horizontal position: default to right of row; if not enough space, place left
    let left: number;
    const spaceLeft = rowRect.left;
    const offset = 24;
    if (spaceLeft >= tipRect.width + offset) {
      left = rowRect.left - tipRect.width - offset;
    } else {
      left = rowRect.right + offset;
    }
    box.style.top = `${top}px`;
    box.style.left = `${left}px`;
    // Mark that a tooltip has been shown so subsequent hovers display immediately
    hasShownOnce = true;
  };
  // Handler when entering a new row; start delayed tooltip
  const onMouseOver = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const row = target.closest('.virtual-row') as HTMLElement | null;
    if (!row) return;
    // Determine if we came from same row; avoid reset when moving inside row
    const from = e.relatedTarget as HTMLElement | null;
    const fromRow = from?.closest?.('.virtual-row') as HTMLElement | null;
    if (row === fromRow) return;
    const idxStr = row.getAttribute('data-index');
    if (!idxStr) return;
    const idx = parseInt(idxStr, 10);
    const item = (modal as any).virtualItems[idx] as VirtualItem;
    if (!item) return;
    // Set active row and schedule tooltip
    activeRow = row;
    // Clear any existing timer/tooltip
    if (timer !== null) {
      clearTimeout(timer);
    }
    if (tooltip) {
      tooltip.remove();
      tooltip = null;
    }
    // Cancel a pending reset of hasShownOnce if hovering again
    if (resetTimer !== null) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }
    // If we've already shown a tooltip before, show immediately when hovering a new row
    if (hasShownOnce) {
      showTooltip(row, item);
    } else {
      // Otherwise delay before showing the first tooltip
      timer = window.setTimeout(() => {
        if (activeRow === row && row.matches(':hover')) {
          showTooltip(row, item);
        }
      }, initialDelay);
    }
  };
  // Handler when leaving a row; hide tooltip
  const onMouseOut = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const row = target.closest('.virtual-row') as HTMLElement | null;
    if (!row) return;
    const to = e.relatedTarget as HTMLElement | null;
    const toRow = to?.closest?.('.virtual-row') as HTMLElement | null;
    // If leaving the active row entirely (not moving within it)
    if (row === activeRow && toRow !== row) {
      hideTooltip();
      // Start a timer to reset hasShownOnce if the user stays off any row for more than 0.2s
      startResetTimer();
    }
  };
  // Bind events
  container.addEventListener('mouseover', onMouseOver);
  container.addEventListener('mouseout', onMouseOut);
  // When scrolling or leaving the container, hide tooltip and schedule reset
  const onContainerScroll = () => {
    hideTooltip();
    startResetTimer();
  };
  const onContainerMouseLeave = () => {
    hideTooltip();
    startResetTimer();
  };
  container.addEventListener('scroll', onContainerScroll);
  container.addEventListener('mouseleave', onContainerMouseLeave);
  // Cleanup when modal closes
  (modal as any)._tooltipCleanup = () => {
    hideTooltip();
    container.removeEventListener('mouseover', onMouseOver);
    container.removeEventListener('mouseout', onMouseOut);
    container.removeEventListener('scroll', onContainerScroll);
    container.removeEventListener('mouseleave', onContainerMouseLeave);


    hasShownOnce = false;
  };
}


const originalOnOpen = StatsModal.prototype.onOpen;
StatsModal.prototype.onOpen = function(this: StatsModal) {
  originalOnOpen.apply(this);
  try {
    // Attach tooltips only if enabled via settings
    if (this.plugin?.settings?.enableStatsHoverTooltips !== false) {
      attachHoverTooltips(this);
    }
  } catch (e) {
    console.error('Failed to attach hover tooltips', e);
  }
};


const originalOnClose = StatsModal.prototype.onClose;
StatsModal.prototype.onClose = function(this: StatsModal) {
  const cleanup = (this as any)._tooltipCleanup;
  if (cleanup && typeof cleanup === 'function') {
    cleanup();
  }
  originalOnClose.apply(this);
};


const SS_FILTER_KEY = "rr/stats/filter";
const SS_SORT_KEY   = "rr/stats/sort";
const SS_SEARCH_KEY = "rr/stats/search";


const FILTER_LABEL: Record<StatsModal["filter"], string> = {
  "all": "All",
  "completed": "Completed",
  "in-progress": "In Progress",
};

const SORT_LABEL: Record<StatsModal["sortMode"], string> = {
  "ctime-desc": "By creation date (newest first)",
  "ctime-asc":  "By creation date (oldest first)",
  "name-asc":   "By file name (A → Z)",
  "name-desc":  "By file name (Z → A)",
};