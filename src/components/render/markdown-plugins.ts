import type { Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import remarkLatex from "./remark-latex";

export const remarkPlugins: Options["remarkPlugins"] = [remarkGfm, remarkMath, remarkLatex];
export const rehypePlugins: Options["rehypePlugins"] = [[rehypeKatex, { trust: false, maxSize: 20, maxExpand: 1000, throwOnError: false }]];
