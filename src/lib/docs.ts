import type { JSONContent } from "@tiptap/react";

export type Doc = {
  id: string;
  owner_id: string;
  title: string;
  content: JSONContent;
  color: string;
  folder_id: string | null;
  position: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DocFolder = {
  id: string;
  owner_id: string;
  name: string;
  position: number;
};

export const EMPTY_DOC_CONTENT: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

export const DOC_COLORS = [
  "#6161ff",
  "#00a86b",
  "#fdab3d",
  "#e2445c",
  "#a25ddc",
  "#579bfc",
  "#ff642e",
  "#0086c0",
];
