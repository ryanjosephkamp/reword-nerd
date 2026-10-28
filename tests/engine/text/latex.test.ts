import { describe, expect, it } from "vitest";

import { readTextFiles } from "../../../src/engine/text";
import { findMainFile, latexReferences, stripComments } from "../../../src/engine/text/latex";
import { bytesOf, OFF, ONE_PIXEL_PNG, textFile, zipFile } from "./helpers";

const article = "\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n";

describe("LaTeX helpers", () => {
  it("strips comments but keeps escaped percent signs", () => {
    expect(stripComments("50\\% done % note\n% gone\n\\\\% also a comment\n")).toBe(
      "50\\% done \n\n\\\\\n",
    );
  });

  it("finds inputs, figures, and bibliographies, ignoring commented-out lines and macro arguments", () => {
    const source = [
      "\\input{sections/intro}",
      "\\include{chapters/one}",
      "\\includegraphics[width=\\linewidth]{figures/chart}",
      "% \\includegraphics{old-draft}",
      "\\newcommand{\\fig}[1]{\\includegraphics{#1}}",
      "\\bibliography{refs, extra}",
      "\\addbibresource[label=x]{more.bib}",
    ].join("\n");

    expect(latexReferences(source)).toEqual([
      { written: "sections/intro", kind: "tex" },
      { written: "chapters/one", kind: "tex" },
      { written: "figures/chart", kind: "graphics" },
      { written: "refs", kind: "bibliography" },
      { written: "extra", kind: "bibliography" },
      { written: "more.bib", kind: "bibliography" },
    ]);
  });

  it("picks main.tex, a single \\documentclass file, or leaves the choice open", () => {
    // Catches a commented-out \documentclass counting, or an ambiguous project picking at random.
    expect(
      findMainFile([
        { path: "main.tex", text: article },
        { path: "other.tex", text: article },
      ]),
    ).toEqual({ isLatex: true, mainFile: "main.tex" });
    expect(
      findMainFile([
        { path: "paper.tex", text: article },
        { path: "draft.tex", text: "% \\documentclass{article}\n" },
      ]),
    ).toEqual({ isLatex: true, mainFile: "paper.tex" });
    expect(
      findMainFile([
        { path: "one.tex", text: article },
        { path: "two.tex", text: "\\documentclass[12pt]{book}\n" },
      ]),
    ).toEqual({ isLatex: true, mainFile: null });
    expect(findMainFile([{ path: "notes.txt", text: article }])).toEqual({
      isLatex: false,
      mainFile: null,
    });
  });
});

describe("standalone LaTeX", () => {
  it("keeps the source exactly and notes files it uses but can't bring along", async () => {
    // Catches a parser normalizing commands, math, citations, or whitespace before review.
    const source =
      "\\documentclass{article}\n\\begin{document}\nText $x^2$ \\cite{key}.\n\\includegraphics{figures/chart.png}\n\\bibliography{refs}\n\\end{document}\n";
    const [result] = (await readTextFiles([textFile("paper.tex", source)], OFF)).sources;

    expect(result).toMatchObject({ format: "latex", previewKind: "latex", extractedText: source });
    expect(result.notes).toEqual([
      "This file uses other files (figures/chart.png and refs). To include them, add the whole project as a folder or a ZIP.",
    ]);
  });
});

describe("LaTeX project ZIPs", () => {
  it("reads a project with its main file, figures, and bibliography", async () => {
    // Catches figures or the .bib being rewritten as text, or files losing their project paths.
    const zip = await zipFile("manuscript.zip", {
      "main.tex": [
        "\\documentclass{article}",
        "\\graphicspath{{figures/}}",
        "\\begin{document}",
        "\\input{sections/intro}",
        "\\includegraphics{chart}",
        "\\includegraphics{missing-figure}",
        "\\bibliography{refs}",
        "\\end{document}",
        "",
      ].join("\n"),
      "sections/intro.tex": "An introduction.\n\\includegraphics{figures/chart.png}\n",
      "refs.bib": "@article{key,title={Example}}\n",
      "figures/chart.png": ONE_PIXEL_PNG,
      "style/custom.sty": "\\ProvidesPackage{custom}\n",
      "main.aux": "\\relax\n",
    });
    const result = await readTextFiles([zip], OFF);
    const [project] = result.projects;

    expect(result.rejected).toEqual([]);
    expect(project).toMatchObject({
      name: "manuscript",
      from: "zip",
      classification: "latex",
      mainFile: "main.tex",
      excluded: [{ path: "main.aux", reason: "dependency-or-build-output" }],
    });
    expect(project.assets.map((asset) => asset.path)).toEqual([
      "figures/chart.png",
      "refs.bib",
      "style/custom.sty",
    ]);
    expect(await bytesOf(project.assets[0].bytes)).toEqual(Array.from(ONE_PIXEL_PNG));
    expect(result.sources.map((source) => [source.path, source.format, source.projectId])).toEqual([
      ["main.tex", "latex", project.id],
      ["sections/intro.tex", "latex", project.id],
    ]);
    expect(result.sources[0].notes).toEqual([
      "This file uses missing-figure, which isn't in the project.",
    ]);
    expect(result.sources[1].notes).toEqual([]);
  });

  it("leaves the main file open when several files could be it", async () => {
    const zip = await zipFile("ambiguous.zip", {
      "one.tex": "\\documentclass{article}\n",
      "two.tex": "\\documentclass{book}\n",
    });
    const [project] = (await readTextFiles([zip], OFF)).projects;
    expect(project).toMatchObject({ classification: "latex", mainFile: null });
  });

  it("treats a ZIP without a \\documentclass file as a general project", async () => {
    const zip = await zipFile("chapters.zip", {
      "one.tex": "Chapter one.\n",
      "lib/widget.cls": "VERSION 1.0 CLASS\n",
    });
    const result = await readTextFiles([zip], OFF);
    expect(result.projects[0]).toMatchObject({ classification: "general", mainFile: null });
    expect(result.sources.map((source) => source.path)).toEqual(["lib/widget.cls", "one.tex"]);
  });
});
