export type NodeType = "file" | "dir";

export type FileTreeNode = {
  name: string;
  path: string;
  type: NodeType;
  sha?: string;
  children?: FileTreeNode[];
};

export type RepositoryFile = {
  path: string;
  content: string;
};
