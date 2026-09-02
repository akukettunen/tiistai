"use client";

import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Underline as UnderlineIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";

type Props = {
  content: JSONContent;
  onChange: (content: JSONContent) => void;
};

export function DocEditor({ content, onChange }: Props) {
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
        },
      }),
      Placeholder.configure({
        placeholder: "Start writing…",
      }),
    ],
    content,
    editorProps: {
      attributes: {
        class: "doc-editor",
      },
    },
    onUpdate: ({ editor: next }) => {
      onChangeRef.current(next.getJSON());
    },
  });

  function setLink() {
    if (!editor) return;
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const previous = editor.getAttributes("link").href as string | undefined;
    const href = window.prompt("Link URL", previous ?? "https://")?.trim();
    if (!href) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  }

  useEffect(() => {
    if (!editor) return;

    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, select") &&
        !target.closest(".doc-pane")
      ) {
        return;
      }

      const run = (command: () => boolean) => {
        event.preventDefault();
        command();
      };

      if (event.code === "KeyB" && !event.shiftKey && !event.altKey) {
        run(() => editor.chain().focus().toggleBold().run());
        return;
      }
      if (event.code === "KeyI" && !event.shiftKey && !event.altKey) {
        run(() => editor.chain().focus().toggleItalic().run());
        return;
      }
      if (event.code === "KeyU" && !event.shiftKey && !event.altKey) {
        run(() => editor.chain().focus().toggleUnderline().run());
        return;
      }
      if (event.code === "KeyS" && event.shiftKey && !event.altKey) {
        run(() => editor.chain().focus().toggleStrike().run());
        return;
      }
      if (event.code === "KeyK" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        editor.chain().focus().run();
        setLink();
        return;
      }
      if (event.code === "Digit8" && event.shiftKey && !event.altKey) {
        run(() => editor.chain().focus().toggleBulletList().run());
        return;
      }
      if (event.code === "Digit7" && event.shiftKey && !event.altKey) {
        run(() => editor.chain().focus().toggleOrderedList().run());
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editor]);

  if (!editor) {
    return <div className="min-h-[50vh] animate-pulse rounded-xl bg-[#f3f2f8]" />;
  }

  return (
    <div>
      <div className="sticky top-16 z-10 -mx-4 mb-6 flex flex-wrap items-center gap-0.5 border-b border-[#ecebf2] bg-[#f7f7fa]/90 px-4 py-2 backdrop-blur md:mx-0 md:rounded-xl md:border md:bg-white md:px-2 md:shadow-[0_1px_0_rgba(24,22,48,0.03)]">
        <ToolbarButton
          label="Bold"
          shortcut="⌘B"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          shortcut="⌘I"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="Underline"
          shortcut="⌘U"
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="Strikethrough"
          shortcut="⇧⌘S"
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough size={16} />
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-[#e6e5ee]" />
        <ToolbarButton
          label="Heading 1"
          active={editor.isActive("heading", { level: 1 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          <Heading1 size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="Heading 2"
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="Heading 3"
          active={editor.isActive("heading", { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          <Heading3 size={16} />
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-[#e6e5ee]" />
        <ToolbarButton
          label="Bullet list"
          shortcut="⇧⌘8"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          shortcut="⇧⌘7"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="Quote"
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="Code block"
          active={editor.isActive("codeBlock")}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          <Code size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="Divider"
          active={false}
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        >
          <Minus size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="Link"
          shortcut="⌘K"
          active={editor.isActive("link")}
          onClick={setLink}
        >
          <Link2 size={16} />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

function ToolbarButton({
  label,
  shortcut,
  active,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={shortcut ? `${label} ${shortcut}` : label}
      title={shortcut ? `${label} ${shortcut}` : label}
      onClick={onClick}
      className={`grid size-8 place-items-center rounded-lg ${
        active
          ? "bg-[#eeecff] text-[#5148df]"
          : "text-[#6d6b7c] hover:bg-[#f3f2f8] hover:text-[#2f2d40]"
      }`}
    >
      {children}
    </button>
  );
}
