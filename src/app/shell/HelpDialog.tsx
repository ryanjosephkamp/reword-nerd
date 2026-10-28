import { Dialog } from "../../ui/Dialog";

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} title="How reword_nerd works" onClose={onClose}>
      <ol className="help-steps">
        <li>
          <strong>Add</strong> documents, code, a project folder or ZIP, or images. Word, PDF,
          Markdown, HTML, LaTeX, plain text, and most code files work.
        </li>
        <li>
          <strong>Check</strong> the text reword_nerd read. Fix anything it got wrong, accept text
          found in scans, and leave out files you don't want rewritten.
        </li>
        <li>
          <strong>Set</strong> the goal, tone, length, and language. For images, say what should
          change and what must stay.
        </li>
        <li>
          <strong>Hand off</strong> to the model you use. A coding agent gets a task folder and one
          command; a chat app gets one prompt; an image tool gets one prompt per image.
        </li>
        <li>
          <strong>Bring it back</strong> if you like: paste the reply or drop the agent's output
          folder to compare and export.
        </li>
      </ol>
      <p className="muted">
        The rewrite follows four stages: Decompose the meaning, Rewrite it in new words, Verify
        nothing was lost or added, and produce the Final version.
      </p>
    </Dialog>
  );
}
