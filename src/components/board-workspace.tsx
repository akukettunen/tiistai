"use client";

import {
  CalendarDays,
  Check,
  Archive,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Columns3,
  Folder,
  FolderPlus,
  GripVertical,
  LayoutGrid,
  Layers3,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createClient } from "@/lib/supabase/client";

type Board = {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  color: string;
  archived_at: string | null;
  folder_id: string | null;
  position: number;
};

type BoardFolder = {
  id: string;
  owner_id: string;
  name: string;
  position: number;
};

type SidebarEntry =
  | {
      id: string;
      position: number;
      type: "folder";
      folder: BoardFolder;
    }
  | {
      id: string;
      position: number;
      type: "board";
      board: Board;
    };

type Group = {
  id: string;
  board_id: string;
  owner_id: string;
  name: string;
  color: string;
  position: number;
};

type LabelOption = { id: string; label: string; color: string };
type ColumnSettings = { options?: LabelOption[] };

type BoardColumn = {
  id: string;
  board_id: string;
  owner_id: string;
  title: string;
  type: "label" | "text" | "long_text" | "date" | "checkbox";
  settings: ColumnSettings;
  position: number;
};

type Item = {
  id: string;
  board_id: string;
  group_id: string;
  owner_id: string;
  title: string;
  description: string;
  column_values: Record<string, string | boolean | null>;
  position: number;
};

type Automation = {
  id: string;
  board_id: string;
  owner_id: string;
  trigger_column_id: string;
  trigger_value: string;
  target_group_id: string;
  enabled: boolean;
};

type Props = {
  user: { id: string; email: string };
  initialBoards: Board[];
  initialFolders: BoardFolder[];
  initialGroups: Group[];
  initialColumns: BoardColumn[];
  initialItems: Item[];
  initialAutomations: Automation[];
  initialError: string | null;
};

const COLORS = [
  "#6161ff",
  "#00a86b",
  "#fdab3d",
  "#e2445c",
  "#a25ddc",
  "#579bfc",
  "#ff642e",
  "#0086c0",
];

const collisionDetectionStrategy: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    const activeId = String(args.active.id);
    if (
      activeId.startsWith("sidebar-board:") ||
      activeId.startsWith("sidebar-folder:")
    ) {
      const gapCollision = pointerCollisions.find((collision) =>
        String(collision.id).startsWith("sidebar-gap:"),
      );
      if (gapCollision) return [gapCollision];
    }
    if (activeId.startsWith("sidebar-board:")) {
      const boardCollision = pointerCollisions.find(
        (collision) =>
          String(collision.id).startsWith("sidebar-board:") &&
          collision.id !== args.active.id,
      );
      if (boardCollision) return [boardCollision];
      const folderCollision = pointerCollisions.find((collision) =>
        String(collision.id).startsWith("folder-items:"),
      );
      if (folderCollision) return [folderCollision];
      const folderRowCollision = pointerCollisions.find((collision) =>
        String(collision.id).startsWith("sidebar-folder:"),
      );
      if (folderRowCollision) return [folderRowCollision];
    }
    if (activeId.startsWith("sidebar-folder:")) {
      const topLevelCollision = pointerCollisions.find(
        (collision) =>
          String(collision.id).startsWith("sidebar-folder:") ||
          String(collision.id).startsWith("sidebar-board:"),
      );
      if (topLevelCollision) return [topLevelCollision];
    }
    if (activeId.startsWith("board-group:")) {
      const groupCollision = pointerCollisions.find(
        (collision) =>
          String(collision.id).startsWith("board-group:") &&
          collision.id !== args.active.id,
      );
      if (groupCollision) return [groupCollision];
    }
    if (/^[dm]:/.test(activeId)) {
      const itemCollision = pointerCollisions.find(
        (collision) =>
          /^[dm]:/.test(String(collision.id)) &&
          collision.id !== args.active.id,
      );
      if (itemCollision) return [itemCollision];
      const groupCollision = pointerCollisions.find((collision) =>
        /^[dm]group:/.test(String(collision.id)),
      );
      if (groupCollision) return [groupCollision];
    }
    return pointerCollisions;
  }
  const activeId = String(args.active.id);
  if (activeId.startsWith("board-group:")) {
    const groupContainers = args.droppableContainers.filter((container) =>
      String(container.id).startsWith("board-group:"),
    );
    if (groupContainers.length > 0) {
      return closestCenter({ ...args, droppableContainers: groupContainers });
    }
  }
  return closestCenter(args);
};

const DEFAULT_COLUMNS: Array<Omit<BoardColumn, "id" | "board_id" | "owner_id">> = [
  {
    title: "Status",
    type: "label",
    position: 0,
    settings: {
      options: [
        { id: "todo", label: "To do", color: "#c4c4c4" },
        { id: "working", label: "Working on it", color: "#fdab3d" },
        { id: "stuck", label: "Stuck", color: "#e2445c" },
        { id: "done", label: "Done", color: "#00c875" },
      ],
    },
  },
  {
    title: "Severity",
    type: "label",
    position: 1,
    settings: {
      options: [
        { id: "low", label: "Low", color: "#579bfc" },
        { id: "medium", label: "Medium", color: "#fdab3d" },
        { id: "high", label: "High", color: "#ff642e" },
        { id: "critical", label: "Critical", color: "#e2445c" },
      ],
    },
  },
  {
    title: "Category",
    type: "label",
    position: 2,
    settings: {
      options: [
        { id: "feature", label: "Feature", color: "#6161ff" },
        { id: "bug", label: "Bug", color: "#e2445c" },
        { id: "improvement", label: "Improvement", color: "#00a86b" },
        { id: "chore", label: "Chore", color: "#a25ddc" },
      ],
    },
  },
  { title: "Due date", type: "date", position: 3, settings: {} },
  { title: "Notes", type: "long_text", position: 4, settings: {} },
];

function makeId() {
  return crypto.randomUUID();
}

export function BoardWorkspace({
  user,
  initialBoards,
  initialFolders,
  initialGroups,
  initialColumns,
  initialItems,
  initialAutomations,
  initialError,
}: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [boards, setBoards] = useState(initialBoards);
  const [folders, setFolders] = useState(initialFolders);
  const [groups, setGroups] = useState(initialGroups);
  const [columns, setColumns] = useState(initialColumns);
  const [items, setItems] = useState(initialItems);
  const [automations, setAutomations] = useState(initialAutomations);
  const [activeBoardId, setActiveBoardId] = useState(
    initialBoards.find((board) => !board.archived_at)?.id ?? "",
  );
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [newItemByGroup, setNewItemByGroup] = useState<Record<string, string>>({});
  const [columnModalOpen, setColumnModalOpen] = useState(false);
  const [automationsOpen, setAutomationsOpen] = useState(false);
  const [boardMenuOpen, setBoardMenuOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [editingColumn, setEditingColumn] = useState<BoardColumn | null>(null);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const boardMenuRef = useRef<HTMLDivElement>(null);
  const [activeItem, setActiveItem] = useState<Item | null>(null);
  const [toast, setToast] = useState<string | null>(initialError);
  const [creatingBoard, setCreatingBoard] = useState(false);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 100, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeBoard = boards.find((board) => board.id === activeBoardId);
  const activeBoards = boards.filter((board) => !board.archived_at);
  const archivedBoards = boards.filter((board) => board.archived_at);
  const rootBoards = activeBoards.filter((board) => !board.folder_id);
  const sidebarEntries = [
    ...folders.map((folder) => ({
      id: `sidebar-folder:${folder.id}`,
      position: folder.position,
      type: "folder" as const,
      folder,
    })),
    ...rootBoards.map((board) => ({
      id: `sidebar-board:${board.id}`,
      position: board.position,
      type: "board" as const,
      board,
    })),
  ].sort((a, b) => a.position - b.position);
  const activeGroups = groups
    .filter((group) => group.board_id === activeBoardId)
    .sort((a, b) => a.position - b.position);
  const activeColumns = columns.filter((column) => column.board_id === activeBoardId);
  const filteredItems = items.filter(
    (item) =>
      item.board_id === activeBoardId &&
      (!query ||
        item.title.toLowerCase().includes(query.toLowerCase()) ||
        Object.values(item.column_values).some((value) =>
          String(value ?? "").toLowerCase().includes(query.toLowerCase()),
        )),
  );

  useEffect(() => {
    if (!boardMenuOpen) return;
    function closeOnOutsidePress(event: PointerEvent) {
      if (!boardMenuRef.current?.contains(event.target as Node)) {
        setBoardMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [boardMenuOpen]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  }

  async function createBoard() {
    const name = window.prompt("Board name", "Product roadmap")?.trim();
    if (!name) return;
    setCreatingBoard(true);
    const previousColor = boards.at(-1)?.color;
    const previousColorIndex = previousColor ? COLORS.indexOf(previousColor) : -1;
    const color = COLORS[(previousColorIndex + 1) % COLORS.length];

    const { data: board, error } = await supabase
      .from("boards")
      .insert({
        name,
        owner_id: user.id,
        color,
        position: folders.length + activeBoards.filter((board) => !board.folder_id).length,
      })
      .select()
      .single();

    if (error || !board) {
      notify(error?.message ?? "Could not create board.");
      setCreatingBoard(false);
      return;
    }

    const { data: group, error: groupError } = await supabase
      .from("board_groups")
      .insert({
        board_id: board.id,
        owner_id: user.id,
        name: "Next up",
        color: "#6161ff",
        position: 0,
      })
      .select()
      .single();

    const { data: createdColumns, error: columnError } = await supabase
      .from("board_columns")
      .insert(
        DEFAULT_COLUMNS.map((column) => ({
          ...column,
          board_id: board.id,
          owner_id: user.id,
        })),
      )
      .select();

    if (groupError || columnError || !group) {
      notify(groupError?.message ?? columnError?.message ?? "Board setup was incomplete.");
    }

    setBoards((current) => [...current, board as Board]);
    if (group) setGroups((current) => [...current, group as Group]);
    if (createdColumns) {
      setColumns((current) => [...current, ...(createdColumns as BoardColumn[])]);
    }
    setActiveBoardId(board.id);
    setCreatingBoard(false);
    setSidebarOpen(false);
  }

  async function renameBoard(board: Board) {
    const name = window.prompt("Board name", board.name)?.trim();
    if (!name || name === board.name) {
      setBoardMenuOpen(false);
      return;
    }
    const { error } = await supabase
      .from("boards")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", board.id);
    if (error) return notify(error.message);
    setBoards((current) =>
      current.map((entry) => (entry.id === board.id ? { ...entry, name } : entry)),
    );
    setBoardMenuOpen(false);
  }

  async function changeBoardColor(board: Board, color: string) {
    if (color === board.color) return;
    const { error } = await supabase
      .from("boards")
      .update({ color, updated_at: new Date().toISOString() })
      .eq("id", board.id);
    if (error) return notify(error.message);
    setBoards((current) =>
      current.map((entry) =>
        entry.id === board.id ? { ...entry, color } : entry,
      ),
    );
  }

  async function archiveBoard(board: Board) {
    if (!window.confirm(`Archive “${board.name}”?`)) return;
    const archivedAt = new Date().toISOString();
    const { error } = await supabase
      .from("boards")
      .update({ archived_at: archivedAt, updated_at: archivedAt })
      .eq("id", board.id);
    if (error) return notify(error.message);
    setBoards((current) =>
      current.map((entry) =>
        entry.id === board.id ? { ...entry, archived_at: archivedAt } : entry,
      ),
    );
    setActiveBoardId(
      activeBoards.find((entry) => entry.id !== board.id)?.id ?? "",
    );
    setBoardMenuOpen(false);
    notify("Board archived");
  }

  async function restoreBoard(board: Board) {
    const { error } = await supabase
      .from("boards")
      .update({ archived_at: null, updated_at: new Date().toISOString() })
      .eq("id", board.id);
    if (error) return notify(error.message);
    setBoards((current) =>
      current.map((entry) =>
        entry.id === board.id ? { ...entry, archived_at: null } : entry,
      ),
    );
    setActiveBoardId(board.id);
    setShowArchived(false);
    setSidebarOpen(false);
  }

  async function createFolder() {
    const name = window.prompt("Group name", "New group")?.trim();
    if (!name) return;
    const { data, error } = await supabase
      .from("board_folders")
      .insert({
        owner_id: user.id,
        name,
        position: folders.length + activeBoards.filter((board) => !board.folder_id).length,
      })
      .select()
      .single();
    if (error) return notify(error.message);
    setFolders((current) => [...current, data as BoardFolder]);
  }

  async function renameFolder(folder: BoardFolder) {
    const name = window.prompt("Group name", folder.name)?.trim();
    if (!name || name === folder.name) return;
    const { error } = await supabase
      .from("board_folders")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", folder.id);
    if (error) return notify(error.message);
    setFolders((current) =>
      current.map((entry) => (entry.id === folder.id ? { ...entry, name } : entry)),
    );
  }

  async function deleteFolder(folder: BoardFolder) {
    if (!window.confirm(`Remove the “${folder.name}” group? Boards will become ungrouped.`)) {
      return;
    }
    const { error: boardError } = await supabase
      .from("boards")
      .update({ folder_id: null, updated_at: new Date().toISOString() })
      .eq("folder_id", folder.id);
    if (boardError) return notify(boardError.message);
    const { error } = await supabase
      .from("board_folders")
      .delete()
      .eq("id", folder.id);
    if (error) return notify(error.message);
    setBoards((current) =>
      current.map((board) =>
        board.folder_id === folder.id ? { ...board, folder_id: null } : board,
      ),
    );
    setFolders((current) => current.filter((entry) => entry.id !== folder.id));
  }

  async function moveBoardToFolder(board: Board, folderId: string | null) {
    const { error } = await supabase
      .from("boards")
      .update({ folder_id: folderId, updated_at: new Date().toISOString() })
      .eq("id", board.id);
    if (error) return notify(error.message);
    setBoards((current) =>
      current.map((entry) =>
        entry.id === board.id ? { ...entry, folder_id: folderId } : entry,
      ),
    );
    setBoardMenuOpen(false);
  }

  async function persistSidebarOrder(
    nextBoards: Board[],
    nextFolders: BoardFolder[],
  ) {
    setBoards(nextBoards);
    setFolders(nextFolders);
    const results = await Promise.all([
      ...nextBoards.map((board) =>
        supabase
          .from("boards")
          .update({ folder_id: board.folder_id, position: board.position })
          .eq("id", board.id),
      ),
      ...nextFolders.map((folder) =>
        supabase
          .from("board_folders")
          .update({ position: folder.position })
          .eq("id", folder.id),
      ),
    ]);
    const error = results.find((result) => result.error)?.error;
    if (error) notify(error.message);
  }

  async function handleSidebarDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const translatedRect = active.rect.current.translated;
    const dropAfter =
      translatedRect !== null &&
      translatedRect.top + translatedRect.height / 2 >
        over.rect.top + over.rect.height / 2;

    if (activeId.startsWith("sidebar-folder:")) {
      if (
        overId !== "sidebar-root" &&
        !overId.startsWith("sidebar-gap:") &&
        !overId.startsWith("sidebar-folder:") &&
        !overId.startsWith("sidebar-board:")
      ) {
        return;
      }
      const reordered = sidebarEntries.filter((entry) => entry.id !== activeId);
      const movingEntry = sidebarEntries.find((entry) => entry.id === activeId);
      if (!movingEntry) return;
      const overIndex =
        overId === "sidebar-root"
          ? dropAfter
            ? reordered.length
            : 0
          : overId.startsWith("sidebar-gap:")
            ? Math.max(
                0,
                Math.min(
                  reordered.length,
                  Number(overId.replace("sidebar-gap:", "")) -
                    (sidebarEntries.findIndex((entry) => entry.id === activeId) <
                    Number(overId.replace("sidebar-gap:", ""))
                      ? 1
                      : 0),
                ),
              )
          : reordered.findIndex((entry) => entry.id === overId);
      if (overIndex < 0) return;
      reordered.splice(
        overId === "sidebar-root"
          ? overIndex
          : overId.startsWith("sidebar-gap:")
            ? overIndex
          : overIndex + (dropAfter ? 1 : 0),
        0,
        movingEntry,
      );
      const positions = new Map(
        reordered.map((entry, position) => [entry.id, position]),
      );
      const nextFolders = folders.map((folder) => ({
        ...folder,
        position: positions.get(`sidebar-folder:${folder.id}`) ?? folder.position,
      }));
      const nextBoards = boards.map((board) => ({
        ...board,
        position:
          board.folder_id === null
            ? (positions.get(`sidebar-board:${board.id}`) ?? board.position)
            : board.position,
      }));
      await persistSidebarOrder(nextBoards, nextFolders);
      return;
    }

    if (!activeId.startsWith("sidebar-board:")) return;
    const boardId = activeId.replace("sidebar-board:", "");
    const movingBoard = boards.find((board) => board.id === boardId);
    if (!movingBoard) return;
    const overBoard = overId.startsWith("sidebar-board:")
      ? boards.find(
          (board) => board.id === overId.replace("sidebar-board:", ""),
        )
      : undefined;
    const targetFolderId = overId.startsWith("folder-items:")
      ? overId.replace("folder-items:", "")
      : overId.startsWith("sidebar-folder:")
        ? overId.replace("sidebar-folder:", "")
        : overBoard?.folder_id ?? null;

    let nextBoards = boards.map((board) => ({ ...board }));
    let nextFolders = folders.map((folder) => ({ ...folder }));

    if (targetFolderId) {
      const destination = nextBoards
        .filter(
          (board) =>
            board.folder_id === targetFolderId && board.id !== movingBoard.id,
        )
        .sort((a, b) => a.position - b.position);
      const overIndex = overBoard
        ? destination.findIndex((board) => board.id === overBoard.id)
        : -1;
      destination.splice(
        overIndex < 0 ? destination.length : overIndex + (dropAfter ? 1 : 0),
        0,
        {
          ...movingBoard,
          folder_id: targetFolderId,
        },
      );
      const destinationPositions = new Map(
        destination.map((board, position) => [board.id, position]),
      );
      nextBoards = nextBoards.map((board) =>
        destinationPositions.has(board.id)
          ? {
              ...board,
              folder_id: targetFolderId,
              position: destinationPositions.get(board.id)!,
            }
          : board,
      );
    } else {
      const withoutMoving = sidebarEntries.filter(
        (entry) => entry.id !== activeId,
      );
      const targetIndex =
        overId === "sidebar-root"
          ? dropAfter
            ? withoutMoving.length
            : 0
          : overId.startsWith("sidebar-gap:")
            ? Math.max(
                0,
                Math.min(
                  withoutMoving.length,
                  Number(overId.replace("sidebar-gap:", "")) -
                    (sidebarEntries.findIndex((entry) => entry.id === activeId) <
                    Number(overId.replace("sidebar-gap:", ""))
                      ? 1
                      : 0),
                ),
              )
            : withoutMoving.findIndex((entry) => entry.id === overId);
      const movedEntry = {
        id: activeId,
        position: 0,
        type: "board" as const,
        board: { ...movingBoard, folder_id: null },
      };
      withoutMoving.splice(
        targetIndex < 0
          ? withoutMoving.length
          : targetIndex +
            (overId.startsWith("sidebar-gap:") ? 0 : dropAfter ? 1 : 0),
        0,
        movedEntry,
      );
      const rootPositions = new Map(
        withoutMoving.map((entry, position) => [entry.id, position]),
      );
      nextFolders = nextFolders.map((folder) => ({
        ...folder,
        position:
          rootPositions.get(`sidebar-folder:${folder.id}`) ?? folder.position,
      }));
      nextBoards = nextBoards.map((board) =>
        board.id === movingBoard.id
          ? {
              ...board,
              folder_id: null,
              position: rootPositions.get(activeId) ?? board.position,
            }
          : board.folder_id === null
            ? {
                ...board,
                position:
                  rootPositions.get(`sidebar-board:${board.id}`) ??
                  board.position,
              }
            : board,
      );
    }

    if (movingBoard.folder_id && movingBoard.folder_id !== targetFolderId) {
      const source = nextBoards
        .filter(
          (board) =>
            board.folder_id === movingBoard.folder_id &&
            board.id !== movingBoard.id,
        )
        .sort((a, b) => a.position - b.position);
      const sourcePositions = new Map(
        source.map((board, position) => [board.id, position]),
      );
      nextBoards = nextBoards.map((board) =>
        sourcePositions.has(board.id)
          ? { ...board, position: sourcePositions.get(board.id)! }
          : board,
      );
    }

    if (movingBoard.folder_id === null && targetFolderId) {
      const rootWithoutMoving = sidebarEntries.filter(
        (entry) => entry.id !== activeId,
      );
      const rootPositions = new Map(
        rootWithoutMoving.map((entry, position) => [entry.id, position]),
      );
      nextFolders = nextFolders.map((folder) => ({
        ...folder,
        position:
          rootPositions.get(`sidebar-folder:${folder.id}`) ?? folder.position,
      }));
      nextBoards = nextBoards.map((board) =>
        board.folder_id === null
          ? {
              ...board,
              position:
                rootPositions.get(`sidebar-board:${board.id}`) ??
                board.position,
            }
          : board,
      );
    }

    await persistSidebarOrder(nextBoards, nextFolders);
  }

  async function addGroup() {
    if (!activeBoard) return;
    const name = window.prompt("Group name", "New group")?.trim();
    if (!name) return;
    const position = activeGroups.length;
    const { data, error } = await supabase
      .from("board_groups")
      .insert({
        board_id: activeBoard.id,
        owner_id: user.id,
        name,
        color: COLORS[position % COLORS.length],
        position,
      })
      .select()
      .single();
    if (error) return notify(error.message);
    setGroups((current) => [...current, data as Group]);
  }

  async function saveGroup(group: Group) {
    const name = group.name.trim();
    if (!name) return;
    const { error } = await supabase
      .from("board_groups")
      .update({
        name,
        color: group.color,
        updated_at: new Date().toISOString(),
      })
      .eq("id", group.id);
    if (error) return notify(error.message);
    setGroups((current) =>
      current.map((entry) =>
        entry.id === group.id ? { ...entry, name, color: group.color } : entry,
      ),
    );
    setEditingGroup(null);
  }

  async function addItem(event: FormEvent, group: Group) {
    event.preventDefault();
    const title = newItemByGroup[group.id]?.trim();
    if (!title) return;
    const groupItems = items.filter((item) => item.group_id === group.id);
    const { data, error } = await supabase
      .from("items")
      .insert({
        title,
        board_id: group.board_id,
        group_id: group.id,
        owner_id: user.id,
        position: groupItems.length,
      })
      .select()
      .single();
    if (error) return notify(error.message);
    setItems((current) => [...current, data as Item]);
    setNewItemByGroup((current) => ({ ...current, [group.id]: "" }));
  }

  async function updateItemValue(
    item: Item,
    columnId: string,
    value: string | boolean | null,
  ) {
    const nextValues = { ...item.column_values, [columnId]: value };
    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id ? { ...entry, column_values: nextValues } : entry,
      ),
    );
    setActiveItem((current) =>
      current?.id === item.id ? { ...current, column_values: nextValues } : current,
    );
    const { error } = await supabase
      .from("items")
      .update({ column_values: nextValues, updated_at: new Date().toISOString() })
      .eq("id", item.id);
    if (error) {
      notify(error.message);
      return;
    }

    const matchingAutomation = automations.find(
      (automation) =>
        automation.enabled &&
        automation.board_id === item.board_id &&
        automation.trigger_column_id === columnId &&
        automation.trigger_value === String(value),
    );
    if (matchingAutomation) {
      await moveItemForAutomation(item, matchingAutomation.target_group_id);
    }
  }

  async function moveItemForAutomation(item: Item, targetGroupId: string) {
    if (item.group_id === targetGroupId) return;
    const targetGroup = groups.find((group) => group.id === targetGroupId);
    if (!targetGroup) return;
    const position = items.filter((entry) => entry.group_id === targetGroupId).length;
    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? { ...entry, group_id: targetGroupId, position }
          : entry,
      ),
    );
    setActiveItem((current) =>
      current?.id === item.id
        ? { ...current, group_id: targetGroupId, position }
        : current,
    );
    const { error } = await supabase
      .from("items")
      .update({
        group_id: targetGroupId,
        position,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    if (error) {
      notify(error.message);
    } else {
      notify(`Moved to ${targetGroup.name}`);
    }
  }

  async function createAutomation(
    triggerColumnId: string,
    triggerValue: string,
    targetGroupId: string,
  ) {
    if (!activeBoard) return false;
    const { data, error } = await supabase
      .from("board_automations")
      .insert({
        board_id: activeBoard.id,
        owner_id: user.id,
        trigger_column_id: triggerColumnId,
        trigger_value: triggerValue,
        target_group_id: targetGroupId,
      })
      .select()
      .single();
    if (error) {
      notify(
        error.code === "23505"
          ? "A rule for that label already exists."
          : error.message,
      );
      return false;
    }
    setAutomations((current) => [...current, data as Automation]);
    return true;
  }

  async function toggleAutomation(automation: Automation) {
    const enabled = !automation.enabled;
    const { error } = await supabase
      .from("board_automations")
      .update({ enabled, updated_at: new Date().toISOString() })
      .eq("id", automation.id);
    if (error) return notify(error.message);
    setAutomations((current) =>
      current.map((entry) =>
        entry.id === automation.id ? { ...entry, enabled } : entry,
      ),
    );
  }

  async function deleteAutomation(automation: Automation) {
    const { error } = await supabase
      .from("board_automations")
      .delete()
      .eq("id", automation.id);
    if (error) return notify(error.message);
    setAutomations((current) =>
      current.filter((entry) => entry.id !== automation.id),
    );
  }

  async function updateItemTitle(item: Item, title: string) {
    const cleanTitle = title.trim();
    if (!cleanTitle || cleanTitle === item.title) return;
    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id ? { ...entry, title: cleanTitle } : entry,
      ),
    );
    const { error } = await supabase
      .from("items")
      .update({ title: cleanTitle, updated_at: new Date().toISOString() })
      .eq("id", item.id);
    if (error) notify(error.message);
  }

  async function deleteItem(item: Item) {
    if (!window.confirm(`Delete “${item.title}”?`)) return;
    const { error } = await supabase.from("items").delete().eq("id", item.id);
    if (error) return notify(error.message);
    setItems((current) => current.filter((entry) => entry.id !== item.id));
    setActiveItem(null);
  }

  async function saveColumn(column: BoardColumn) {
    const { error } = await supabase
      .from("board_columns")
      .update({
        title: column.title,
        settings: column.settings,
        updated_at: new Date().toISOString(),
      })
      .eq("id", column.id);
    if (error) return notify(error.message);
    setColumns((current) =>
      current.map((entry) => (entry.id === column.id ? column : entry)),
    );
    setEditingColumn(null);
  }

  async function createColumn(title: string, type: BoardColumn["type"]) {
    if (!activeBoard) return;
    const settings: ColumnSettings =
      type === "label"
        ? {
            options: [
              { id: makeId(), label: "Option 1", color: "#6161ff" },
              { id: makeId(), label: "Option 2", color: "#00a86b" },
            ],
          }
        : {};
    const { data, error } = await supabase
      .from("board_columns")
      .insert({
        board_id: activeBoard.id,
        owner_id: user.id,
        title,
        type,
        settings,
        position: activeColumns.length,
      })
      .select()
      .single();
    if (error) return notify(error.message);
    setColumns((current) => [...current, data as BoardColumn]);
    setColumnModalOpen(false);
  }

  async function deleteColumn(column: BoardColumn) {
    if (!window.confirm(`Delete the “${column.title}” column and its values?`)) return;
    const { error } = await supabase.from("board_columns").delete().eq("id", column.id);
    if (error) return notify(error.message);
    const nextItems = items.map((item) => {
      const values = { ...item.column_values };
      delete values[column.id];
      return { ...item, column_values: values };
    });
    setItems(nextItems);
    setColumns((current) => current.filter((entry) => entry.id !== column.id));
    setEditingColumn(null);
  }

  async function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const activeId = String(active.id).replace(/^[dm]:/, "");
    const overId = String(over.id);
    const overItemId = overId.replace(/^[dm]:/, "");
    const activeItem = items.find((item) => item.id === activeId);
    if (!activeItem) return;

    const overItem = items.find((item) => item.id === overItemId);
    const targetGroupId =
      overItem?.group_id ?? overId.replace(/^[dm]group:/, "");
    if (!groups.some((group) => group.id === targetGroupId)) return;

    const sourceItems = items
      .filter((item) => item.group_id === activeItem.group_id)
      .sort((a, b) => a.position - b.position);
    const targetItems =
      activeItem.group_id === targetGroupId
        ? sourceItems
        : items
            .filter((item) => item.group_id === targetGroupId)
            .sort((a, b) => a.position - b.position);

    let reordered: Item[];
    if (activeItem.group_id === targetGroupId) {
      const oldIndex = sourceItems.findIndex((item) => item.id === activeItem.id);
      const overIndex = targetItems.findIndex((item) => item.id === overItemId);
      const newIndex = overIndex < 0 ? sourceItems.length - 1 : overIndex;
      reordered = arrayMove(sourceItems, oldIndex, newIndex).map((item, position) => ({
        ...item,
        position,
      }));
    } else {
      const insertAt = overItem
        ? targetItems.findIndex((item) => item.id === overItem.id)
        : targetItems.length;
      const movedItem = { ...activeItem, group_id: targetGroupId };
      reordered = [
        ...targetItems.slice(0, insertAt),
        movedItem,
        ...targetItems.slice(insertAt),
      ].map((item, position) => ({ ...item, position }));
      reordered.push(
        ...sourceItems
          .filter((item) => item.id !== activeItem.id)
          .map((item, position) => ({ ...item, position })),
      );
    }

    const changedIds = new Set(reordered.map((item) => item.id));
    setItems((current) => [
      ...current.filter((item) => !changedIds.has(item.id)),
      ...reordered,
    ]);

    const results = await Promise.all(
      reordered.map((item) =>
        supabase
          .from("items")
          .update({ group_id: item.group_id, position: item.position })
          .eq("id", item.id),
      ),
    );
    const error = results.find((result) => result.error)?.error;
    if (error) notify(error.message);
  }

  async function handleWorkspaceDragEnd(event: DragEndEvent) {
    if (String(event.active.id).startsWith("board-group:")) {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeId = String(active.id).replace("board-group:", "");
      const overId = String(over.id).replace("board-group:", "");
      const ordered = [...activeGroups].sort((a, b) => a.position - b.position);
      const moving = ordered.find((group) => group.id === activeId);
      const withoutMoving = ordered.filter((group) => group.id !== activeId);
      const overIndex = withoutMoving.findIndex((group) => group.id === overId);
      if (!moving || overIndex < 0) return;
      const translatedRect = active.rect.current.translated;
      const dropAfter =
        translatedRect !== null &&
        translatedRect.top + translatedRect.height / 2 >
          over.rect.top + over.rect.height / 2;
      withoutMoving.splice(overIndex + (dropAfter ? 1 : 0), 0, moving);
      const reordered = withoutMoving.map((group, position) => ({
        ...group,
        position,
      }));
      const reorderedById = new Map(reordered.map((group) => [group.id, group]));
      setGroups((current) =>
        current.map((group) => reorderedById.get(group.id) ?? group),
      );
      const results = await Promise.all(
        reordered.map((group) =>
          supabase
            .from("board_groups")
            .update({ position: group.position })
            .eq("id", group.id),
        ),
      );
      const error = results.find((result) => result.error)?.error;
      if (error) notify(error.message);
      return;
    }
    await handleDragEnd(event);
  }

  function handleDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const activeId = String(active.id).replace(/^[dm]:/, "");
    const overId = String(over.id);
    const overItemId = overId.replace(/^[dm]:/, "");

    setItems((current) => {
      const movingItem = current.find((item) => item.id === activeId);
      const overItem = current.find((item) => item.id === overItemId);
      if (!movingItem) return current;
      const targetGroupId =
        overItem?.group_id ?? overId.replace(/^[dm]group:/, "");
      if (
        movingItem.group_id === targetGroupId ||
        !groups.some((group) => group.id === targetGroupId)
      ) {
        return current;
      }

      const sourceItems = current
        .filter(
          (item) => item.group_id === movingItem.group_id && item.id !== movingItem.id,
        )
        .sort((a, b) => a.position - b.position)
        .map((item, position) => ({ ...item, position }));
      const targetItems = current
        .filter((item) => item.group_id === targetGroupId)
        .sort((a, b) => a.position - b.position);
      const insertAt = overItem
        ? targetItems.findIndex((item) => item.id === overItem.id)
        : targetItems.length;
      const destinationItems = [
        ...targetItems.slice(0, insertAt),
        { ...movingItem, group_id: targetGroupId },
        ...targetItems.slice(insertAt),
      ].map((item, position) => ({ ...item, position }));
      const changedGroups = new Set([movingItem.group_id, targetGroupId]);

      return [
        ...current.filter((item) => !changedGroups.has(item.group_id)),
        ...sourceItems,
        ...destinationItems,
      ];
    });
  }

  async function moveItemByKeyboard(item: Item, direction: -1 | 1) {
    const orderedGroups = activeGroups.sort((a, b) => a.position - b.position);
    const groupIndex = orderedGroups.findIndex((group) => group.id === item.group_id);
    const sourceItems = items
      .filter((entry) => entry.group_id === item.group_id)
      .sort((a, b) => a.position - b.position);
    const itemIndex = sourceItems.findIndex((entry) => entry.id === item.id);

    let reordered: Item[];
    if (
      (direction === -1 && itemIndex > 0) ||
      (direction === 1 && itemIndex < sourceItems.length - 1)
    ) {
      reordered = arrayMove(sourceItems, itemIndex, itemIndex + direction).map(
        (entry, position) => ({ ...entry, position }),
      );
    } else {
      const targetGroup = orderedGroups[groupIndex + direction];
      if (!targetGroup) return;
      const targetItems = items
        .filter((entry) => entry.group_id === targetGroup.id)
        .sort((a, b) => a.position - b.position);
      const moved = { ...item, group_id: targetGroup.id };
      const destination =
        direction === 1 ? [moved, ...targetItems] : [...targetItems, moved];
      reordered = [
        ...sourceItems
          .filter((entry) => entry.id !== item.id)
          .map((entry, position) => ({ ...entry, position })),
        ...destination.map((entry, position) => ({ ...entry, position })),
      ];
    }

    const changedIds = new Set(reordered.map((entry) => entry.id));
    setItems((current) => [
      ...current.filter((entry) => !changedIds.has(entry.id)),
      ...reordered,
    ]);
    const results = await Promise.all(
      reordered.map((entry) =>
        supabase
          .from("items")
          .update({ group_id: entry.group_id, position: entry.position })
          .eq("id", entry.id),
      ),
    );
    const error = results.find((result) => result.error)?.error;
    if (error) notify(error.message);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/auth");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen bg-[#f7f7fa] text-[#29283a]">
      {sidebarOpen && (
        <button
          className="fixed inset-0 z-30 bg-[#17152f]/35 md:hidden"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-67.5 flex-col border-r border-white/10 bg-[#19172e] text-white transition-transform md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center justify-between px-5">
          <div className="flex items-center gap-3 font-semibold">
            <span className="grid size-9 place-items-center rounded-xl bg-[#6c63ff]">
              <Layers3 size={19} />
            </span>
            Tuesday
          </div>
          <button
            className="rounded-lg p-2 text-white/45 hover:bg-white/10 hover:text-white md:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="mt-4 flex min-h-0 flex-1 flex-col px-3">
          <div className="mb-2 flex items-center justify-between px-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/35">
              Boards
            </p>
            <div className="flex items-center gap-1">
              <button
                aria-label="Create board group"
                className="rounded p-1 text-white/45 hover:bg-white/10 hover:text-white"
                onClick={createFolder}
              >
                <FolderPlus size={14} />
              </button>
              {archivedBoards.length > 0 && (
                <button
                  aria-label="Show archived boards"
                  className={`rounded p-1 hover:bg-white/10 hover:text-white ${
                    showArchived ? "text-white" : "text-white/45"
                  }`}
                  onClick={() => setShowArchived((value) => !value)}
                >
                  <Archive size={14} />
                </button>
              )}
              <button
                aria-label="Create board"
                className="rounded p-1 text-white/45 hover:bg-white/10 hover:text-white"
                onClick={createBoard}
                disabled={creatingBoard}
              >
                <Plus size={15} />
              </button>
            </div>
          </div>
          <div className="space-y-1 overflow-y-auto">
            <DndContext
              sensors={sensors}
              collisionDetection={collisionDetectionStrategy}
              onDragEnd={handleSidebarDragEnd}
            >
              <SidebarRoot
                entries={sidebarEntries}
                boards={activeBoards}
                activeBoardId={activeBoardId}
                collapsedFolders={collapsedFolders}
                onSelectBoard={(board) => {
                  setActiveBoardId(board.id);
                  setSidebarOpen(false);
                  setBoardMenuOpen(false);
                }}
                onToggleFolder={(folder) =>
                  setCollapsedFolders((current) => {
                    const next = new Set(current);
                    if (next.has(folder.id)) next.delete(folder.id);
                    else next.add(folder.id);
                    return next;
                  })
                }
                onRenameFolder={renameFolder}
                onDeleteFolder={deleteFolder}
              />
            </DndContext>
            {showArchived && archivedBoards.length > 0 && (
              <div className="mt-4 border-t border-white/10 pt-3">
                <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-white/30">
                  Archived
                </p>
                {archivedBoards.map((board) => (
                  <div
                    key={board.id}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/45"
                  >
                    <span className="min-w-0 flex-1 truncate">{board.name}</span>
                    <button
                      className="rounded p-1 hover:bg-white/10 hover:text-white"
                      aria-label={`Restore ${board.name}`}
                      onClick={() => restoreBoard(board)}
                    >
                      <RotateCcw size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="m-3 border-t border-white/10 pt-3">
          <div className="flex items-center gap-3 rounded-xl px-3 py-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#3d395d] text-xs font-semibold uppercase">
              {user.email.slice(0, 2)}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-white/60">
              {user.email}
            </span>
            <button
              className="rounded-md p-1.5 text-white/40 hover:bg-white/10 hover:text-white"
              onClick={signOut}
              aria-label="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="flex h-16 items-center gap-3 border-b border-[#e5e5ec] bg-white px-4 md:px-7">
          <button
            className="rounded-lg p-2 text-[#6e6c7d] hover:bg-[#f2f2f7] md:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={21} />
          </button>
          <div className="relative ml-auto w-full max-w-90">
            <Search
              size={17}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9997a5]"
            />
            <input
              className="h-10 w-full rounded-xl border border-[#e4e3eb] bg-[#fafafd] pl-10 pr-4 text-sm outline-none focus:border-[#6c63ff]"
              placeholder="Search items…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </header>

        {!activeBoard ? (
          <EmptyWorkspace onCreate={createBoard} loading={creatingBoard} />
        ) : (
          <div className="mx-auto max-w-[1700px] px-4 py-6 md:px-8 md:py-8">
            <div className="mb-7 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs text-[#8b8998]">
                  My boards <ChevronRight size={13} /> {activeBoard.name}
                </div>
                <div ref={boardMenuRef} className="relative flex items-center gap-2">
                  <h1 className="text-3xl font-semibold tracking-[-0.035em] text-[#222033] md:text-4xl">
                    {activeBoard.name}
                  </h1>
                  <button
                    className="rounded-lg p-2 text-[#9b99a6] hover:bg-white hover:text-[#555263]"
                    aria-label="Board options"
                    onClick={() => setBoardMenuOpen((value) => !value)}
                  >
                    <MoreHorizontal size={20} />
                  </button>
                  {boardMenuOpen && (
                    <div className="absolute right-0 top-full z-60 mt-1 w-52 rounded-xl border border-[#e2e1e8] bg-white p-1.5 text-sm shadow-lg">
                      <label className="block px-3 pb-2 pt-1 text-[11px] font-medium text-[#858392]">
                        Sidebar group
                        <select
                          className="mt-1.5 h-9 w-full rounded-lg border border-[#dedde6] bg-white px-2 text-sm text-[#343243] outline-none"
                          value={activeBoard.folder_id ?? ""}
                          onChange={(event) =>
                            moveBoardToFolder(
                              activeBoard,
                              event.target.value || null,
                            )
                          }
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
                        <p className="mb-2 text-[11px] font-medium text-[#858392]">
                          Board color
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {COLORS.map((color) => (
                            <button
                              key={color}
                              className={`size-6 rounded-full border-2 border-white ring-offset-1 ${
                                activeBoard.color === color
                                  ? "ring-2 ring-[#6c63ff]"
                                  : "ring-1 ring-[#dedde6]"
                              }`}
                              style={{ backgroundColor: color }}
                              aria-label={`Set board color to ${color}`}
                              onClick={() => changeBoardColor(activeBoard, color)}
                            />
                          ))}
                        </div>
                      </div>
                      <button
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-[#f3f2f7]"
                        onClick={() => renameBoard(activeBoard)}
                      >
                        <Pencil size={15} /> Rename
                      </button>
                      <button
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-red-600 hover:bg-red-50"
                        onClick={() => archiveBoard(activeBoard)}
                      >
                        <Archive size={15} /> Archive
                      </button>
                    </div>
                  )}
                </div>
                {activeBoard.description && (
                  <p className="mt-2 text-sm text-[#858392]">{activeBoard.description}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#dedde7] bg-white px-4 text-sm font-medium hover:bg-[#f8f8fb]"
                  onClick={() => router.push("/quick-add")}
                >
                  <Plus size={16} /> Quick add
                </button>
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#dedde7] bg-white px-4 text-sm font-medium hover:bg-[#f8f8fb]"
                  onClick={() => setAutomationsOpen(true)}
                >
                  <Zap size={16} /> Automations
                </button>
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#dedde7] bg-white px-4 text-sm font-medium hover:bg-[#f8f8fb]"
                  onClick={addGroup}
                >
                  <CirclePlus size={17} /> Add group
                </button>
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#6c63ff] px-4 text-sm font-medium text-white shadow-[0_8px_20px_rgba(108,99,255,0.22)] hover:bg-[#5a51ee]"
                  onClick={() => setColumnModalOpen(true)}
                >
                  <Columns3 size={17} /> Add column
                </button>
              </div>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={collisionDetectionStrategy}
              onDragOver={handleDragOver}
              onDragEnd={handleWorkspaceDragEnd}
              accessibility={{
                screenReaderInstructions: {
                  draggable:
                    "Press space to pick up an item. Use arrow keys to move it, then press space to drop or Escape to cancel.",
                },
              }}
            >
              <SortableContext
                id="board-groups"
                items={activeGroups.map((group) => `board-group:${group.id}`)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-7">
                  {activeGroups.map((group) => {
                const groupItems = filteredItems.filter((item) => item.group_id === group.id);
                const collapsed = collapsedGroups.has(group.id);
                return (
                  <SortableBoardGroup
                    key={group.id}
                    group={group}
                    itemCount={groupItems.length}
                    collapsed={collapsed}
                    onToggle={() =>
                      setCollapsedGroups((current) => {
                        const next = new Set(current);
                        if (next.has(group.id)) next.delete(group.id);
                        else next.add(group.id);
                        return next;
                      })
                    }
                    onEdit={() => setEditingGroup(group)}
                  >
                    {!collapsed && (
                      <>
                        <DesktopTable
                          group={group}
                          columns={activeColumns}
                          items={groupItems}
                          newTitle={newItemByGroup[group.id] ?? ""}
                          onNewTitle={(value) =>
                            setNewItemByGroup((current) => ({
                              ...current,
                              [group.id]: value,
                            }))
                          }
                          onAddItem={(event) => addItem(event, group)}
                          onUpdateValue={updateItemValue}
                          onUpdateTitle={updateItemTitle}
                          onEditColumn={setEditingColumn}
                          onOpenItem={setActiveItem}
                          onKeyboardMove={moveItemByKeyboard}
                        />
                        <MobileCards
                          columns={activeColumns}
                          items={groupItems}
                          group={group}
                          newTitle={newItemByGroup[group.id] ?? ""}
                          onNewTitle={(value) =>
                            setNewItemByGroup((current) => ({
                              ...current,
                              [group.id]: value,
                            }))
                          }
                          onAddItem={(event) => addItem(event, group)}
                          onOpenItem={setActiveItem}
                          onKeyboardMove={moveItemByKeyboard}
                        />
                      </>
                    )}
                  </SortableBoardGroup>
                );
                })}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        )}
      </main>

      {columnModalOpen && (
        <NewColumnModal
          onClose={() => setColumnModalOpen(false)}
          onCreate={createColumn}
        />
      )}
      {automationsOpen && activeBoard && (
        <AutomationsModal
          board={activeBoard}
          columns={activeColumns}
          groups={activeGroups}
          automations={automations.filter(
            (automation) => automation.board_id === activeBoard.id,
          )}
          onClose={() => setAutomationsOpen(false)}
          onCreate={createAutomation}
          onToggle={toggleAutomation}
          onDelete={deleteAutomation}
        />
      )}
      {editingColumn && (
        <ColumnEditor
          column={editingColumn}
          onClose={() => setEditingColumn(null)}
          onSave={saveColumn}
          onDelete={deleteColumn}
        />
      )}
      {editingGroup && (
        <GroupEditor
          group={editingGroup}
          onClose={() => setEditingGroup(null)}
          onSave={saveGroup}
        />
      )}
      {activeItem && (
        <ItemPanel
          item={activeItem}
          columns={activeColumns}
          onClose={() => setActiveItem(null)}
          onUpdate={updateItemValue}
          onDelete={deleteItem}
          onUpdateTitle={updateItemTitle}
        />
      )}
      {toast && (
        <div className="fixed bottom-5 left-1/2 z-80 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl bg-[#242137] px-4 py-3 text-sm text-white shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}

function SidebarRoot({
  entries,
  boards,
  activeBoardId,
  collapsedFolders,
  onSelectBoard,
  onToggleFolder,
  onRenameFolder,
  onDeleteFolder,
}: {
  entries: SidebarEntry[];
  boards: Board[];
  activeBoardId: string;
  collapsedFolders: Set<string>;
  onSelectBoard: (board: Board) => void;
  onToggleFolder: (folder: BoardFolder) => void;
  onRenameFolder: (folder: BoardFolder) => void;
  onDeleteFolder: (folder: BoardFolder) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "sidebar-root" });
  return (
    <SortableContext
      id="sidebar-top-level"
      items={entries.map((entry) => entry.id)}
      strategy={verticalListSortingStrategy}
    >
      <div
        ref={setNodeRef}
        className={`min-h-8 space-y-1 rounded-lg ${isOver ? "bg-white/5" : ""}`}
      >
        {entries.map((entry, index) => (
          <Fragment key={entry.id}>
            <SidebarDropGap index={index} />
            {entry.type === "board" ? (
              <SidebarBoardRow
                board={entry.board}
                active={entry.board.id === activeBoardId}
                onSelect={onSelectBoard}
              />
            ) : (
              <SidebarFolderRow
                folder={entry.folder}
                boards={boards
                  .filter((board) => board.folder_id === entry.folder.id)
                  .sort((a, b) => a.position - b.position)}
                activeBoardId={activeBoardId}
                collapsed={collapsedFolders.has(entry.folder.id)}
                onSelectBoard={onSelectBoard}
                onToggle={onToggleFolder}
                onRename={onRenameFolder}
                onDelete={onDeleteFolder}
              />
            )}
          </Fragment>
        ))}
        <SidebarDropGap index={entries.length} />
      </div>
    </SortableContext>
  );
}

function SidebarDropGap({ index }: { index: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `sidebar-gap:${index}` });
  return (
    <div
      ref={setNodeRef}
      className={`-my-1 h-2 rounded-full transition-all ${
        isOver ? "h-3 bg-[#918bff]" : ""
      }`}
    />
  );
}

function SidebarBoardRow({
  board,
  active,
  onSelect,
}: {
  board: Board;
  active: boolean;
  onSelect: (board: Board) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `sidebar-board:${board.id}` });
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={() => onSelect(board)}
      className={`flex w-full select-none items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
        active
          ? "bg-[#6c63ff] font-medium text-white"
          : "text-white/65 hover:bg-white/[0.07] hover:text-white"
      } ${isDragging ? "z-50 opacity-60 shadow-lg" : ""}`}
    >
      <span
        className="size-2.5 shrink-0 rounded-sm"
        style={{ backgroundColor: board.color }}
      />
      <span className="truncate">{board.name}</span>
    </button>
  );
}

function SidebarFolderRow({
  folder,
  boards,
  activeBoardId,
  collapsed,
  onSelectBoard,
  onToggle,
  onRename,
  onDelete,
}: {
  folder: BoardFolder;
  boards: Board[];
  activeBoardId: string;
  collapsed: boolean;
  onSelectBoard: (board: Board) => void;
  onToggle: (folder: BoardFolder) => void;
  onRename: (folder: BoardFolder) => void;
  onDelete: (folder: BoardFolder) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `sidebar-folder:${folder.id}` });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `folder-items:${folder.id}`,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`mb-1 rounded-lg ${isDragging ? "z-50 opacity-60" : ""}`}
    >
      <div className="group flex items-center">
        <button
          className="flex min-w-0 flex-1 select-none items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-white/55 hover:bg-white/5 hover:text-white"
          onClick={() => onToggle(folder)}
          {...attributes}
          {...listeners}
        >
          <ChevronDown
            size={13}
            className={`shrink-0 transition ${collapsed ? "-rotate-90" : ""}`}
          />
          <Folder size={14} className="shrink-0" />
          <span className="truncate">{folder.name}</span>
        </button>
        <button
          className="hidden rounded p-1 text-white/35 hover:bg-white/10 hover:text-white group-hover:block"
          aria-label={`Rename ${folder.name}`}
          onClick={() => onRename(folder)}
        >
          <Pencil size={12} />
        </button>
        <button
          className="hidden rounded p-1 text-white/35 hover:bg-white/10 hover:text-red-300 group-hover:block"
          aria-label={`Remove ${folder.name}`}
          onClick={() => onDelete(folder)}
        >
          <X size={13} />
        </button>
      </div>
      {!collapsed && (
        <SortableContext
          id={`sidebar-folder-items:${folder.id}`}
          items={boards.map((board) => `sidebar-board:${board.id}`)}
          strategy={verticalListSortingStrategy}
        >
          <div
            ref={setDropRef}
            className={`ml-3 min-h-8 border-l pl-2 transition ${
              isOver ? "border-[#918bff] bg-white/10" : "border-white/10"
            }`}
          >
            {boards.map((board) => (
              <SidebarBoardRow
                key={board.id}
                board={board}
                active={board.id === activeBoardId}
                onSelect={onSelectBoard}
              />
            ))}
            {boards.length === 0 && (
              <p className="px-3 py-1.5 text-[11px] text-white/25">
                Drop a board here
              </p>
            )}
          </div>
        </SortableContext>
      )}
    </div>
  );
}

function EmptyWorkspace({
  onCreate,
  loading,
}: {
  onCreate: () => void;
  loading: boolean;
}) {
  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-6">
      <div className="max-w-md text-center">
        <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-[#eeecff] text-[#6c63ff]">
          <LayoutGrid size={30} />
        </span>
        <h1 className="mt-6 text-3xl font-semibold tracking-[-0.03em] text-[#242236]">
          Create your first board
        </h1>
        <button
          className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-[#6c63ff] px-5 text-sm font-semibold text-white"
          onClick={onCreate}
          disabled={loading}
        >
          <Plus size={18} /> {loading ? "Creating…" : "Create a board"}
        </button>
      </div>
    </div>
  );
}

type CellProps = {
  item: Item;
  column: BoardColumn;
  onUpdate: (item: Item, columnId: string, value: string | boolean | null) => void;
};

function ValueCell({ item, column, onUpdate }: CellProps) {
  const value = item.column_values[column.id];

  if (column.type === "long_text") {
    return (
      <LongTextCell
        item={item}
        column={column}
        value={typeof value === "string" ? value : ""}
        onUpdate={onUpdate}
      />
    );
  }

  if (column.type === "label") {
    const options = column.settings.options ?? [];
    const selected = options.find((option) => option.id === value);
    return (
      <div className="relative h-full min-h-10 min-w-32">
        <span
          className="pointer-events-none absolute inset-1 flex items-center justify-center rounded-md text-xs font-semibold text-white"
          style={{ backgroundColor: selected?.color ?? "#d8d8df" }}
        >
          {selected?.label ?? "—"}
        </span>
        <select
          aria-label={column.title}
          className="absolute inset-0 w-full cursor-pointer opacity-0"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onUpdate(item, column.id, event.target.value || null)}
        >
          <option value="">No value</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (column.type === "date") {
    return (
      <div className="flex min-w-36 items-center gap-2 px-3 text-xs text-[#636171]">
        <CalendarDays size={14} className="shrink-0 text-[#aaa8b5]" />
        <input
          className="min-w-0 bg-transparent outline-none"
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onUpdate(item, column.id, event.target.value || null)}
        />
      </div>
    );
  }

  if (column.type === "checkbox") {
    return (
      <button
        className={`mx-auto grid size-6 place-items-center rounded-md border ${
          value ? "border-[#6c63ff] bg-[#6c63ff] text-white" : "border-[#d3d2dc] bg-white"
        }`}
        onClick={() => onUpdate(item, column.id, !value)}
      >
        {Boolean(value) && <Check size={15} />}
      </button>
    );
  }

  return (
    <input
      className="h-full min-h-10 w-full min-w-40 bg-transparent px-3 text-sm outline-none placeholder:text-[#b2b0bb]"
      placeholder="Add text…"
      defaultValue={typeof value === "string" ? value : ""}
      onBlur={(event) => onUpdate(item, column.id, event.target.value)}
    />
  );
}

function LongTextCell({
  item,
  column,
  value,
  onUpdate,
}: {
  item: Item;
  column: BoardColumn;
  value: string;
  onUpdate: CellProps["onUpdate"];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const anchorRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 448 });

  function save() {
    if (draft !== value) onUpdate(item, column.id, draft);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePress(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !anchorRef.current?.contains(target) &&
        !editorRef.current?.contains(target)
      ) {
        save();
      }
    }
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  });

  return (
    <div ref={anchorRef} className="relative h-full min-h-10 min-w-48">
      <button
        className="block h-10 w-full truncate px-3 text-left text-sm text-[#656273] hover:bg-[#f5f4fa]"
        title={value}
        onClick={() => {
          const rect = anchorRef.current?.getBoundingClientRect();
          if (rect) {
            const width = Math.min(448, window.innerWidth - 32);
            const below = rect.bottom + 4;
            const top =
              below + 380 > window.innerHeight
                ? Math.max(16, rect.top - 380)
                : below;
            setPosition({
              top,
              left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)),
              width,
            });
          }
          setDraft(value);
          setOpen(true);
        }}
      >
        {value || <span className="text-[#b2b0bb]">Add notes…</span>}
      </button>
      {open &&
        createPortal(
        <div
          ref={editorRef}
          className="fixed z-80 rounded-xl border border-[#dedde6] bg-white p-3 shadow-xl"
          style={position}
        >
          <textarea
            autoFocus
            className="min-h-64 w-full resize-y rounded-lg border border-[#dedde6] p-3 text-sm leading-6 outline-none focus:border-[#6c63ff]"
            placeholder="Add notes…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              className="rounded-lg px-3 py-2 text-sm text-[#656273] hover:bg-[#f2f2f6]"
              onClick={() => {
                setDraft(value);
                setOpen(false);
              }}
            >
              Cancel
            </button>
            <button
              className="rounded-lg bg-[#6c63ff] px-4 py-2 text-sm font-semibold text-white"
              onClick={save}
            >
              Save
            </button>
          </div>
        </div>,
          document.body,
        )}
    </div>
  );
}

function SortableBoardGroup({
  group,
  itemCount,
  collapsed,
  onToggle,
  onEdit,
  children,
}: {
  group: Group;
  itemCount: number;
  collapsed: boolean;
  onToggle: () => void;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `board-group:${group.id}` });
  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "relative z-30 opacity-60" : ""}
    >
      <div className="mb-2 flex items-center gap-1">
        <button
          className="touch-none rounded-md p-1 text-[#aaa8b4] hover:bg-white hover:text-[#656273] focus:outline-none focus:ring-2 focus:ring-[#6c63ff]"
          aria-label={`Move ${group.name}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={15} />
        </button>
        <button className="flex items-center gap-2 text-left" onClick={onToggle}>
          <ChevronDown
            size={18}
            className={`transition ${collapsed ? "-rotate-90" : ""}`}
            style={{ color: group.color }}
          />
          <span className="text-lg font-semibold" style={{ color: group.color }}>
            {group.name}
          </span>
          <span className="text-xs text-[#aaa8b4]">{itemCount} items</span>
        </button>
        <button
          className="rounded-md p-1 text-[#aaa8b4] hover:bg-white hover:text-[#656273]"
          aria-label={`Edit ${group.name}`}
          onClick={onEdit}
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
      {children}
    </section>
  );
}

type TableProps = {
  group: Group;
  columns: BoardColumn[];
  items: Item[];
  newTitle: string;
  onNewTitle: (value: string) => void;
  onAddItem: (event: FormEvent) => void;
  onUpdateValue: CellProps["onUpdate"];
  onUpdateTitle: (item: Item, title: string) => void;
  onEditColumn: (column: BoardColumn) => void;
  onOpenItem: (item: Item) => void;
  onKeyboardMove: (item: Item, direction: -1 | 1) => void;
};

function DesktopTable({
  group,
  columns,
  items,
  newTitle,
  onNewTitle,
  onAddItem,
  onUpdateValue,
  onUpdateTitle,
  onEditColumn,
  onOpenItem,
  onKeyboardMove,
}: TableProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `dgroup:${group.id}` });
  return (
    <SortableContext
      items={items.map((item) => `d:${item.id}`)}
      strategy={verticalListSortingStrategy}
    >
      <div
        ref={setNodeRef}
        className={`hidden overflow-x-auto rounded-xl border bg-white shadow-[0_3px_12px_rgba(30,27,60,0.035)] md:block ${
          isOver ? "border-[#6c63ff]" : "border-[#e3e2e9]"
        }`}
      >
        <table className="w-full border-collapse text-left">
        <thead>
          <tr className="h-10 bg-[#fafafd] text-xs font-medium text-[#777584]">
            <th
              className="sticky left-0 z-10 min-w-75 border-r border-[#e6e5eb] bg-[#fafafd] px-4"
              style={{ borderLeft: `5px solid ${group.color}` }}
            >
              Item
            </th>
            {columns.map((column) => (
              <th
                key={column.id}
                className="min-w-38.75 border-r border-[#e6e5eb] px-2 text-center font-medium"
              >
                <button
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-[#efeff4]"
                  onClick={() => onEditColumn(column)}
                >
                  {column.title} <ChevronDown size={13} />
                </button>
              </th>
            ))}
            <th className="w-12 px-2" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <SortableDesktopRow
              key={item.id}
              item={item}
              group={group}
              columns={columns}
              onUpdateValue={onUpdateValue}
              onUpdateTitle={onUpdateTitle}
              onOpenItem={onOpenItem}
              onKeyboardMove={onKeyboardMove}
            />
          ))}
          <tr className="h-11 border-t border-[#e6e5eb]">
            <td
              className="sticky left-0 bg-white px-4"
              style={{ borderLeft: `5px solid ${group.color}` }}
              colSpan={columns.length + 2}
            >
              <form className="flex items-center gap-2" onSubmit={onAddItem}>
                <Plus size={16} className="text-[#aaa8b4]" />
                <input
                  className="h-9 min-w-60 bg-transparent text-sm outline-none placeholder:text-[#aaa8b4]"
                  placeholder="Add item"
                  value={newTitle}
                  onChange={(event) => onNewTitle(event.target.value)}
                />
              </form>
            </td>
          </tr>
        </tbody>
        </table>
      </div>
    </SortableContext>
  );
}

function SortableDesktopRow({
  item,
  group,
  columns,
  onUpdateValue,
  onUpdateTitle,
  onOpenItem,
  onKeyboardMove,
}: Pick<
  TableProps,
  | "group"
  | "columns"
  | "onUpdateValue"
  | "onUpdateTitle"
  | "onOpenItem"
  | "onKeyboardMove"
> & { item: Item }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `d:${item.id}` });
  return (
    <tr
      ref={setNodeRef}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("button,input,select,textarea")) return;
        listeners?.onPointerDown?.(event);
      }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`h-11 border-t border-[#e6e5eb] hover:bg-[#fafaff] ${
        isDragging ? "relative z-30 opacity-60 shadow-lg" : ""
      }`}
    >
      <td
        className="sticky left-0 z-10 border-r border-[#e6e5eb] bg-white px-2"
        style={{ borderLeft: `5px solid ${group.color}` }}
      >
        <div className="flex items-center gap-1">
          <button
            className="touch-none rounded p-1.5 text-[#b1afba] hover:bg-[#efeff5] hover:text-[#5f5c70] focus:outline-none focus:ring-2 focus:ring-[#6c63ff]"
            aria-label={`Move ${item.title}. Use Alt and arrow keys to reorder or change group.`}
            onKeyDown={(event) => {
              if (event.altKey && event.key === "ArrowUp") {
                event.preventDefault();
                onKeyboardMove(item, -1);
              }
              if (event.altKey && event.key === "ArrowDown") {
                event.preventDefault();
                onKeyboardMove(item, 1);
              }
            }}
            {...attributes}
            {...listeners}
          >
            <GripVertical size={15} />
          </button>
          <input
            className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
            defaultValue={item.title}
            onBlur={(event) => onUpdateTitle(item, event.target.value)}
          />
        </div>
      </td>
      {columns.map((column) => (
        <td key={column.id} className="border-r border-[#e6e5eb] p-0">
          <ValueCell item={item} column={column} onUpdate={onUpdateValue} />
        </td>
      ))}
      <td className="px-2 text-center">
        <button
          className="rounded-md p-1.5 text-[#aaa8b4] hover:bg-[#efeff5] hover:text-[#555364]"
          onClick={() => onOpenItem(item)}
          aria-label={`Open ${item.title}`}
        >
          <MoreHorizontal size={17} />
        </button>
      </td>
    </tr>
  );
}

function MobileCards({
  columns,
  items,
  group,
  newTitle,
  onNewTitle,
  onAddItem,
  onOpenItem,
  onKeyboardMove,
}: Omit<TableProps, "onUpdateTitle" | "onEditColumn" | "onUpdateValue">) {
  const { setNodeRef, isOver } = useDroppable({ id: `mgroup:${group.id}` });
  return (
    <SortableContext
      items={items.map((item) => `m:${item.id}`)}
      strategy={verticalListSortingStrategy}
    >
      <div
        ref={setNodeRef}
        className={`space-y-3 rounded-xl md:hidden ${isOver ? "ring-2 ring-[#6c63ff]/40" : ""}`}
      >
        {items.map((item) => (
          <SortableMobileCard
            key={item.id}
            item={item}
            group={group}
            columns={columns}
            onOpenItem={onOpenItem}
            onKeyboardMove={onKeyboardMove}
          />
        ))}
        <form
          className="flex h-12 items-center gap-2 rounded-xl border border-dashed border-[#d7d5e0] bg-white/70 pl-4 pr-1.5"
          onSubmit={onAddItem}
        >
          <Plus size={16} className="text-[#aaa8b4]" />
          <input
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            placeholder="Add item"
            value={newTitle}
            onChange={(event) => onNewTitle(event.target.value)}
          />
          <button
            type="submit"
            className="h-9 rounded-lg bg-[#6c63ff] px-3 text-xs font-semibold text-white disabled:opacity-40"
            disabled={!newTitle.trim()}
          >
            Add
          </button>
        </form>
      </div>
    </SortableContext>
  );
}

function SortableMobileCard({
  item,
  group,
  columns,
  onOpenItem,
  onKeyboardMove,
}: {
  item: Item;
  group: Group;
  columns: BoardColumn[];
  onOpenItem: (item: Item) => void;
  onKeyboardMove: (item: Item, direction: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `m:${item.id}` });
  return (
    <article
      ref={setNodeRef}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("button,input,select,textarea")) return;
        listeners?.onPointerDown?.(event);
      }}
      className={`w-full rounded-xl border border-[#e3e2e9] bg-white p-4 shadow-sm ${
        isDragging ? "z-30 opacity-60 shadow-lg" : ""
      }`}
      style={{
        borderLeft: `4px solid ${group.color}`,
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <div className="mb-3 flex items-start gap-2">
        <button
          className="touch-none rounded p-1 text-[#aaa8b4] focus:outline-none focus:ring-2 focus:ring-[#6c63ff]"
          aria-label={`Move ${item.title}. Use Alt and arrow keys to reorder or change group.`}
          onKeyDown={(event) => {
            if (event.altKey && event.key === "ArrowUp") {
              event.preventDefault();
              onKeyboardMove(item, -1);
            }
            if (event.altKey && event.key === "ArrowDown") {
              event.preventDefault();
              onKeyboardMove(item, 1);
            }
          }}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={17} />
        </button>
        <button
          className="min-w-0 flex-1 text-left font-medium text-[#29273a]"
          onClick={() => onOpenItem(item)}
        >
          {item.title}
        </button>
        <button
          className="rounded p-1 text-[#aaa8b4]"
          onClick={() => onOpenItem(item)}
          aria-label={`Open ${item.title}`}
        >
          <MoreHorizontal size={17} />
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {columns
          .filter((column) => column.type === "label")
          .map((column) => {
            const selected = column.settings.options?.find(
              (option) => option.id === item.column_values[column.id],
            );
            if (!selected) return null;
            return (
              <span
                key={column.id}
                className="rounded-md px-2.5 py-1 text-[11px] font-semibold text-white"
                style={{ backgroundColor: selected.color }}
              >
                {selected.label}
              </span>
            );
          })}
      </div>
    </article>
  );
}

function ModalShell({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-70 grid place-items-center bg-[#17152f]/45 p-4 backdrop-blur-[2px]">
      <button className="absolute inset-0" onClick={onClose} aria-label="Close" />
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        {children}
      </div>
    </div>
  );
}

function NewColumnModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (title: string, type: BoardColumn["type"]) => void;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<BoardColumn["type"]>("label");
  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Add column</h2>
          <p className="mt-1 text-sm text-[#858392]">Choose what this column should track.</p>
        </div>
        <button className="rounded-lg p-2 hover:bg-[#f2f2f6]" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <label className="mt-6 block text-sm font-medium">
        Column name
        <input
          autoFocus
          className="mt-2 h-11 w-full rounded-xl border border-[#dedde6] px-3 outline-none focus:border-[#6c63ff]"
          placeholder="e.g. Severity"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <div className="mt-5">
        <p className="mb-2 text-sm font-medium">Column type</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(
            [
              ["label", "Labels"],
              ["text", "Text"],
              ["long_text", "Long text"],
              ["date", "Date"],
              ["checkbox", "Checkbox"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={`rounded-xl border px-3 py-3 text-sm ${
                type === value
                  ? "border-[#6c63ff] bg-[#f1efff] text-[#5148da]"
                  : "border-[#e4e3ea] hover:bg-[#f8f8fb]"
              }`}
              onClick={() => setType(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <button
        className="mt-6 h-11 w-full rounded-xl bg-[#6c63ff] text-sm font-semibold text-white disabled:opacity-40"
        disabled={!title.trim()}
        onClick={() => onCreate(title.trim(), type)}
      >
        Add column
      </button>
    </ModalShell>
  );
}

function ColumnEditor({
  column,
  onClose,
  onSave,
  onDelete,
}: {
  column: BoardColumn;
  onClose: () => void;
  onSave: (column: BoardColumn) => void;
  onDelete: (column: BoardColumn) => void;
}) {
  const [draft, setDraft] = useState(column);
  const options = draft.settings.options ?? [];
  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#8c8999]">
            {column.type.replace("_", " ")} column
          </p>
          <h2 className="mt-1 text-xl font-semibold">Customize column</h2>
        </div>
        <button className="rounded-lg p-2 hover:bg-[#f2f2f6]" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <label className="mt-6 block text-sm font-medium">
        Name
        <input
          className="mt-2 h-11 w-full rounded-xl border border-[#dedde6] px-3 outline-none focus:border-[#6c63ff]"
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        />
      </label>
      {draft.type === "label" && (
        <div className="mt-5">
          <p className="mb-2 text-sm font-medium">Label options</p>
          <div className="space-y-2">
            {options.map((option, index) => (
              <div key={option.id} className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label={`${option.label} color`}
                  className="size-9 cursor-pointer rounded-lg border-0 bg-transparent"
                  value={option.color}
                  onChange={(event) => {
                    const next = [...options];
                    next[index] = { ...option, color: event.target.value };
                    setDraft({ ...draft, settings: { options: next } });
                  }}
                />
                <input
                  className="h-10 min-w-0 flex-1 rounded-lg border border-[#e1e0e8] px-3 text-sm outline-none focus:border-[#6c63ff]"
                  value={option.label}
                  onChange={(event) => {
                    const next = [...options];
                    next[index] = { ...option, label: event.target.value };
                    setDraft({ ...draft, settings: { options: next } });
                  }}
                />
                <button
                  className="rounded-lg p-2 text-[#aaa8b4] hover:bg-red-50 hover:text-red-600"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      settings: { options: options.filter((_, itemIndex) => itemIndex !== index) },
                    })
                  }
                >
                  <X size={17} />
                </button>
              </div>
            ))}
          </div>
          <button
            className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-[#5b52e8]"
            onClick={() =>
              setDraft({
                ...draft,
                settings: {
                  options: [
                    ...options,
                    {
                      id: makeId(),
                      label: `Option ${options.length + 1}`,
                      color: COLORS[options.length % COLORS.length],
                    },
                  ],
                },
              })
            }
          >
            <Plus size={16} /> Add label
          </button>
        </div>
      )}
      <div className="mt-7 flex items-center justify-between border-t border-[#eeeef2] pt-5">
        <button
          className="inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-red-600 hover:bg-red-50"
          onClick={() => onDelete(column)}
        >
          <Trash2 size={16} /> Delete
        </button>
        <button
          className="rounded-xl bg-[#6c63ff] px-5 py-2.5 text-sm font-semibold text-white"
          onClick={() => onSave(draft)}
        >
          Save changes
        </button>
      </div>
    </ModalShell>
  );
}

function GroupEditor({
  group,
  onClose,
  onSave,
}: {
  group: Group;
  onClose: () => void;
  onSave: (group: Group) => void;
}) {
  const [draft, setDraft] = useState(group);
  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Group settings</h2>
        <button className="rounded-lg p-2 hover:bg-[#f2f2f6]" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <label className="mt-6 block text-sm font-medium">
        Name
        <input
          autoFocus
          className="mt-2 h-11 w-full rounded-xl border border-[#dedde6] px-3 outline-none focus:border-[#6c63ff]"
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </label>
      <div className="mt-5">
        <p className="mb-3 text-sm font-medium">Color</p>
        <div className="flex flex-wrap gap-3">
          {COLORS.map((color) => (
            <button
              key={color}
              className={`size-8 rounded-full border-2 border-white ring-offset-2 ${
                draft.color === color
                  ? "ring-2 ring-[#6c63ff]"
                  : "ring-1 ring-[#dedde6]"
              }`}
              style={{ backgroundColor: color }}
              aria-label={`Set group color to ${color}`}
              onClick={() => setDraft({ ...draft, color })}
            />
          ))}
        </div>
      </div>
      <button
        className="mt-7 h-11 w-full rounded-xl bg-[#6c63ff] text-sm font-semibold text-white disabled:opacity-40"
        disabled={!draft.name.trim()}
        onClick={() => onSave(draft)}
      >
        Save changes
      </button>
    </ModalShell>
  );
}

function AutomationsModal({
  board,
  columns,
  groups,
  automations,
  onClose,
  onCreate,
  onToggle,
  onDelete,
}: {
  board: Board;
  columns: BoardColumn[];
  groups: Group[];
  automations: Automation[];
  onClose: () => void;
  onCreate: (
    triggerColumnId: string,
    triggerValue: string,
    targetGroupId: string,
  ) => Promise<boolean>;
  onToggle: (automation: Automation) => void;
  onDelete: (automation: Automation) => void;
}) {
  const labelColumns = columns.filter((column) => column.type === "label");
  const [columnId, setColumnId] = useState(labelColumns[0]?.id ?? "");
  const selectedColumn = labelColumns.find((column) => column.id === columnId);
  const options = selectedColumn?.settings.options ?? [];
  const [triggerValue, setTriggerValue] = useState(options[0]?.id ?? "");
  const [targetGroupId, setTargetGroupId] = useState(groups[0]?.id ?? "");
  const [saving, setSaving] = useState(false);

  function changeColumn(nextColumnId: string) {
    setColumnId(nextColumnId);
    const nextColumn = labelColumns.find((column) => column.id === nextColumnId);
    setTriggerValue(nextColumn?.settings.options?.[0]?.id ?? "");
  }

  async function addRule() {
    if (!columnId || !triggerValue || !targetGroupId) return;
    setSaving(true);
    await onCreate(columnId, triggerValue, targetGroupId);
    setSaving(false);
  }

  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Automations</h2>
          <p className="mt-1 text-sm text-[#858392]">{board.name}</p>
        </div>
        <button className="rounded-lg p-2 hover:bg-[#f2f2f6]" onClick={onClose}>
          <X size={19} />
        </button>
      </div>

      <div className="mt-6 rounded-xl border border-[#e3e2e9] bg-[#fafafd] p-4">
        <p className="mb-3 text-sm font-medium">When a label changes</p>
        {labelColumns.length === 0 || groups.length === 0 ? (
          <p className="text-sm text-[#858392]">
            Add a label column and a group before creating a rule.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs font-medium text-[#6f6d7d]">
                Column
                <select
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#dedde6] bg-white px-3 text-sm outline-none focus:border-[#6c63ff]"
                  value={columnId}
                  onChange={(event) => changeColumn(event.target.value)}
                >
                  {labelColumns.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-[#6f6d7d]">
                Label
                <select
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#dedde6] bg-white px-3 text-sm outline-none focus:border-[#6c63ff]"
                  value={triggerValue}
                  onChange={(event) => setTriggerValue(event.target.value)}
                >
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-xs font-medium text-[#6f6d7d]">
              Move item to
              <select
                className="mt-1.5 h-10 w-full rounded-lg border border-[#dedde6] bg-white px-3 text-sm outline-none focus:border-[#6c63ff]"
                value={targetGroupId}
                onChange={(event) => setTargetGroupId(event.target.value)}
              >
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="h-10 w-full rounded-lg bg-[#6c63ff] text-sm font-semibold text-white disabled:opacity-50"
              disabled={saving || !triggerValue}
              onClick={addRule}
            >
              {saving ? "Adding…" : "Add rule"}
            </button>
          </div>
        )}
      </div>

      <div className="mt-6">
        <p className="mb-3 text-sm font-medium">Rules</p>
        {automations.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[#dedde6] py-7 text-center text-sm text-[#92909f]">
            No automations yet.
          </p>
        ) : (
          <div className="space-y-2">
            {automations.map((automation) => {
              const column = columns.find(
                (entry) => entry.id === automation.trigger_column_id,
              );
              const option = column?.settings.options?.find(
                (entry) => entry.id === automation.trigger_value,
              );
              const group = groups.find(
                (entry) => entry.id === automation.target_group_id,
              );
              return (
                <div
                  key={automation.id}
                  className="flex items-center gap-3 rounded-xl border border-[#e5e4eb] px-3 py-3"
                >
                  <button
                    role="switch"
                    aria-checked={automation.enabled}
                    aria-label={`${automation.enabled ? "Disable" : "Enable"} automation`}
                    className={`relative h-6 w-10 shrink-0 rounded-full transition ${
                      automation.enabled ? "bg-[#6c63ff]" : "bg-[#cfced7]"
                    }`}
                    onClick={() => onToggle(automation)}
                  >
                    <span
                      className={`absolute top-1 size-4 rounded-full bg-white transition ${
                        automation.enabled ? "left-5" : "left-1"
                      }`}
                    />
                  </button>
                  <p
                    className={`min-w-0 flex-1 text-sm ${
                      automation.enabled ? "text-[#343243]" : "text-[#9a98a5]"
                    }`}
                  >
                    <span className="font-medium">{column?.title ?? "Label"}</span>
                    {" is "}
                    <span className="font-medium">{option?.label ?? "Unknown"}</span>
                    {" → "}
                    <span className="font-medium">{group?.name ?? "Unknown group"}</span>
                  </p>
                  <button
                    className="rounded-lg p-2 text-[#aaa8b4] hover:bg-red-50 hover:text-red-600"
                    aria-label="Delete automation"
                    onClick={() => onDelete(automation)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function ItemPanel({
  item,
  columns,
  onClose,
  onUpdate,
  onDelete,
  onUpdateTitle,
}: {
  item: Item;
  columns: BoardColumn[];
  onClose: () => void;
  onUpdate: CellProps["onUpdate"];
  onDelete: (item: Item) => void;
  onUpdateTitle: (item: Item, title: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-60 flex justify-end bg-[#17152f]/30">
      <button className="absolute inset-0" onClick={onClose} aria-label="Close item" />
      <aside className="relative h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-2xl sm:p-8">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#92909f]">
            Item details
          </p>
          <button className="rounded-lg p-2 hover:bg-[#f2f2f6]" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <textarea
          className="mt-7 w-full resize-none text-2xl font-semibold leading-8 tracking-[-0.02em] outline-none"
          rows={2}
          defaultValue={item.title}
          onBlur={(event) => onUpdateTitle(item, event.target.value)}
        />
        <div className="mt-7 space-y-5 border-t border-[#ecebf1] pt-6">
          {columns.map((column) => (
            <div key={column.id}>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[#8b8997]">
                {column.title}
              </label>
              <div className="min-h-11 overflow-hidden rounded-xl border border-[#e1e0e8]">
                {column.type === "long_text" ? (
                  <textarea
                    className="min-h-64 w-full resize-y p-3 text-sm leading-6 outline-none"
                    placeholder="Add detailed notes, acceptance criteria, links…"
                    defaultValue={
                      typeof item.column_values[column.id] === "string"
                        ? (item.column_values[column.id] as string)
                        : ""
                    }
                    onBlur={(event) => onUpdate(item, column.id, event.target.value)}
                  />
                ) : (
                  <ValueCell item={item} column={column} onUpdate={onUpdate} />
                )}
              </div>
            </div>
          ))}
        </div>
        <button
          className="mt-10 inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-red-600 hover:bg-red-50"
          onClick={() => onDelete(item)}
        >
          <Trash2 size={16} /> Delete item
        </button>
      </aside>
    </div>
  );
}
