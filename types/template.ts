export interface Template {
  id: string;
  name: string;
  description: string | null;
  category: string;
  tags: string | null;
  thumbnailUrl: string | null;
  source: string;
  defaultCompiler?: string;
  license: string | null;
  authorName: string | null;
  authorUrl: string | null;
  filesPath: string;
  mainFile: string;
  useCount: number;
  userId: string | null;
  isPublic: boolean;
  createdAt: string;
  fileStructure?: string[];
  isFavorited?: boolean;
  user?: {
    id: string;
    name: string | null;
    image: string | null;
  } | null;
}

export interface TemplateGridItem {
  id: string;
  name: string;
  description: string | null;
  category: string;
  tags: string | null;
  thumbnailUrl: string | null;
  source: string;
  defaultCompiler?: string;
  useCount: number;
  authorName: string | null;
  user?: {
    id: string;
    name: string | null;
    image: string | null;
  } | null;
}
