import { FilePlus, FolderPlus } from "@phosphor-icons/react";
import { useRef } from "react";
import { readFolderInput } from "../../ui/picked";
import { useAddText } from "./useAddText";

const ACCEPT = [
  ".txt,.md,.markdown,.html,.htm,.xhtml,.xml,.json,.jsonl,.ndjson,.csv,.tsv,.yaml,.yml,.toml",
  ".ini,.config,.conf,.css,.scss,.sass,.less,.sql,.tex,.ltx,.docx,.pdf,.zip",
  ".js,.jsx,.mjs,.cjs,.ts,.tsx,.py,.rb,.php,.java,.c,.h,.cc,.cpp,.hpp,.cs,.go,.rs,.swift,.kt",
  ".scala,.sh,.bash,.zsh,.ps1,.r,.lua,.pl,.dart,.vue,.svelte,.ex,.exs,.hs,.clj,.sol",
].join(",");

export function AddButtons({ compact = false }: { compact?: boolean }) {
  const { add } = useAddText();
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  return (
    <div className={compact ? "button-row" : "button-row button-row-wide"}>
      <button type="button" className="btn btn-primary" onClick={() => files.current?.click()}>
        <FilePlus aria-hidden />
        <span>Add files</span>
      </button>
      <button type="button" className="btn" onClick={() => folder.current?.click()}>
        <FolderPlus aria-hidden />
        <span>Add folder</span>
      </button>
      <input
        ref={files}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        onChange={(event) => {
          const list = [...(event.target.files ?? [])];
          event.target.value = "";
          if (list.length) void add({ files: list, folder: [] });
        }}
      />
      <input
        ref={folder}
        type="file"
        hidden
        // @ts-expect-error webkitdirectory is supported by every current browser but not typed.
        webkitdirectory=""
        onChange={(event) => {
          const list = event.target.files;
          if (list?.length) void add(readFolderInput(list));
          event.target.value = "";
        }}
      />
    </div>
  );
}
