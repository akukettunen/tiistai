"use client";

import { Archive, MoreHorizontal, Trash2 } from "lucide-react";
import { DocEditor } from "@/components/doc-editor";
import { DOC_COLORS, EMPTY_DOC_CONTENT, type Doc } from "@/lib/docs";
import type { JSONContent } from "@tiptap/react";

type Folder = { id: string; name: string };

type Props = {
  doc: Doc;
  folders: Folder[];
  saveState: "saved" | "saving" | "error";
  focusTitle: boolean;
  menuOpen: boolean;
  menuRef: React.RefObject<HTMLDivElement | null>;
  onToggleMenu: () => void;
  onTitleChange: (value: string) => void;
  onContentChange: (content: JSONContent) => void;
  onMoveToFolder: (folderId: string | null) => void;
  onChangeColor: (color: string) => void;
  onArchive: () => void;
  onDelete: () => void;
};

export function DocPane({
  doc,
  folders,
  saveState,
  focusTitle,
  menuOpen,
  menuRef,
  onToggleMenu,
  onTitleChange,
  onContentChange,
  onMoveToFolder,
  onChangeColor,
  onArchive,
  onDelete,
}: Props) {
  return (
    <div className="doc-pane mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <div ref={menuRef} className="relative mb-3 flex items-center gap-2">
        <input
          key={doc.id}
          autoFocus={focusTitle}
          maxLength={240}
          spellCheck={false}
          aria-label="Doc title"
          className="h-12 min-w-0 flex-1 bg-transparent text-3xl font-semibold tracking-[-0.035em] text-[#222033] outline-none placeholder:text-[#c4c2ce] md:h-14 md:text-4xl"
          value={doc.title === "Untitled" ? "" : doc.title}
          placeholder="Untitled"
          onChange={(event) => onTitleChange(event.target.value)}
          onBlur={(event) => {
            if (!event.target.value.trim()) onTitleChange("Untitled");
          }}
        />
        <span className="shrink-0 text-xs text-[#8b8998]">
          {saveState === "saving"
            ? "Saving…"
            : saveState === "error"
              ? "Couldn’t save"
              : "Saved"}
        </span>
        <button
          className="shrink-0 rounded-lg p-2 text-[#9b99a6] hover:bg-white hover:text-[#555263]"
          aria-label="Doc options"
          onClick={onToggleMenu}
        >
          <MoreHorizontal size={20} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full z-60 mt-1 w-52 rounded-xl border border-[#e2e1e8] bg-white p-1.5 text-sm shadow-lg">
            <label className="block px-3 pb-2 pt-1 text-[11px] font-medium text-[#858392]">
              Sidebar group
              <select
                className="mt-1.5 h-9 w-full rounded-lg border border-[#dedde6] bg-white px-2 text-sm text-[#343243] outline-none"
                value={doc.folder_id ?? ""}
                onChange={(event) => onMoveToFolder(event.target.value || null)}
              >
                <option value="">Ungrouped</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="border-t border-[#ecebf1] px-3 py-2">
              <p className="mb-2 text-[11px] font-medium text-[#858392]">Color</p>
              <div className="flex flex-wrap gap-2">
                {DOC_COLORS.map((color) => (
                  <button
                    key={color}
                    className={`size-6 rounded-full border-2 border-white ring-offset-1 ${
                      doc.color === color
                        ? "ring-2 ring-[#6c63ff]"
                        : "ring-1 ring-[#dedde6]"
                    }`}
                    style={{ backgroundColor: color }}
                    aria-label={`Set doc color to ${color}`}
                    onClick={() => onChangeColor(color)}
                  />
                ))}
              </div>
            </div>
            <button
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-[#f3f2f7]"
              onClick={onArchive}
            >
              <Archive size={15} /> Archive
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-red-600 hover:bg-red-50"
              onClick={onDelete}
            >
              <Trash2 size={15} /> Delete
            </button>
          </div>
        )}
      </div>
      <DocEditor
        key={doc.id}
        content={doc.content ?? EMPTY_DOC_CONTENT}
        onChange={onContentChange}
      />
    </div>
  );
}
