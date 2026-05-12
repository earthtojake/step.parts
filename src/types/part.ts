export type PartStandard = {
  body: string;
  number: string;
  designation: string;
};

export type PartAttributes = Record<string, string | number | boolean | null>;

export type Part = {
  id: string;
  name: string;
  description: string;
  category: string;
  family?: string;
  tags: string[];
  aliases: string[];
  standard?: PartStandard;
  stepSource?: string;
  productPage?: string;
  attributes: PartAttributes;
  stepUrl: string;
  glbUrl: string;
  pngUrl: string;
  byteSize: number | null;
  sha256: string | null;
};
