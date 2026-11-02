// Tidies the paths a browser reports for the files in a chosen or dropped folder.
import { quotePath } from "../paths";
import { ReadProblem } from "./util";

export function folderEntryPath(path: string): string {
  const tidy = path.normalize("NFC");
  const unusable =
    !tidy ||
    tidy.includes("\0") ||
    tidy.split("/").some((segment) => !segment || segment === "." || segment === "..");
  if (unusable) {
    throw new ReadProblem(`This folder has a file path that can't be used (${quotePath(path)}).`);
  }
  return tidy;
}
