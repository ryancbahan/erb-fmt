import type { Tree } from "tree-sitter";

export function printTree(tree: Tree, source: string) {
  const cursor = tree.walk();
  const result: string[] = [];

  function recurse(depth = 0) {
    do {
      const type = cursor.nodeType;
      const fieldName = cursor.currentFieldName;
      const text = source
        .slice(cursor.startIndex, cursor.endIndex)
        .replace(/\n/g, "\\n");
      const pieces = [`${"  ".repeat(depth)}- ${type}`];
      if (fieldName) pieces.push(`(${fieldName})`);
      pieces.push(`"${text}"`);
      result.push(pieces.join(" "));
      if (cursor.gotoFirstChild()) {
        recurse(depth + 1);
        cursor.gotoParent();
      }
    } while (cursor.gotoNextSibling());
  }

  recurse();
  return result.join("\n");
}
