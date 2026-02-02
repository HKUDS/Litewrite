import { describe, it, expect } from "vitest";
import { inferTemplateCompilerFromTex, VALID_COMPILERS } from "../compiler-utils";

describe("inferTemplateCompilerFromTex", () => {
  describe("TEX program directive handling", () => {
    it("should return xelatex for %!TEX program = xelatex", () => {
      expect(inferTemplateCompilerFromTex("%!TEX program = xelatex")).toBe("xelatex");
    });

    it("should return lualatex for %!TEX program = lualatex", () => {
      expect(inferTemplateCompilerFromTex("%!TEX program = lualatex")).toBe("lualatex");
    });

    it("should return latex for %!TEX program = latex", () => {
      expect(inferTemplateCompilerFromTex("%!TEX program = latex")).toBe("latex");
    });

    it("should return pdflatex for %!TEX program = pdflatex (not latex)", () => {
      // This is the critical test case that was failing before the fix
      // The greedy .* was matching "pdf" causing "pdflatex" to be incorrectly
      // identified as "latex"
      expect(inferTemplateCompilerFromTex("%!TEX program = pdflatex")).toBe("pdflatex");
    });

    it("should honor pdflatex directive even when XeLaTeX-requiring packages are present", () => {
      // Edge case: explicit pdflatex directive should take priority over
      // content-based XeLaTeX detection (e.g., fontspec package)
      const content = `%!TEX program = pdflatex
\\documentclass{article}
\\usepackage{fontspec}
\\begin{document}
Hello
\\end{document}`;
      expect(inferTemplateCompilerFromTex(content)).toBe("pdflatex");
    });

    it("should handle directive without spaces around =", () => {
      expect(inferTemplateCompilerFromTex("%!TEX program=xelatex")).toBe("xelatex");
      expect(inferTemplateCompilerFromTex("%!TEX program=lualatex")).toBe("lualatex");
      expect(inferTemplateCompilerFromTex("%!TEX program=latex")).toBe("latex");
      expect(inferTemplateCompilerFromTex("%!TEX program=pdflatex")).toBe("pdflatex");
    });

    it("should be case insensitive", () => {
      expect(inferTemplateCompilerFromTex("%!TEX program = XELATEX")).toBe("xelatex");
      expect(inferTemplateCompilerFromTex("%!TEX PROGRAM = xelatex")).toBe("xelatex");
    });

    it("should handle directive in multiline content", () => {
      const content = `% Some comment
%!TEX program = xelatex
\\documentclass{article}`;
      expect(inferTemplateCompilerFromTex(content)).toBe("xelatex");
    });
  });

  describe("document class and package detection", () => {
    it("should return xelatex for ctex document classes", () => {
      expect(inferTemplateCompilerFromTex("\\documentclass{ctex}")).toBe("xelatex");
      expect(inferTemplateCompilerFromTex("\\documentclass{ctexart}")).toBe("xelatex");
      expect(inferTemplateCompilerFromTex("\\documentclass{ctexrep}")).toBe("xelatex");
      expect(inferTemplateCompilerFromTex("\\documentclass{ctexbook}")).toBe("xelatex");
    });

    it("should return xelatex for fontspec package", () => {
      expect(inferTemplateCompilerFromTex("\\usepackage{fontspec}")).toBe("xelatex");
    });

    it("should return xelatex for xeCJK package", () => {
      expect(inferTemplateCompilerFromTex("\\usepackage{xeCJK}")).toBe("xelatex");
    });

    it("should return pdflatex by default", () => {
      expect(inferTemplateCompilerFromTex("\\documentclass{article}")).toBe("pdflatex");
    });
  });
});

describe("VALID_COMPILERS", () => {
  it("should contain all valid compilers", () => {
    expect(VALID_COMPILERS.has("pdflatex")).toBe(true);
    expect(VALID_COMPILERS.has("xelatex")).toBe(true);
    expect(VALID_COMPILERS.has("lualatex")).toBe(true);
    expect(VALID_COMPILERS.has("latex")).toBe(true);
  });
});
