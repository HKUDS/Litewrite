/**
 * Full dataset of LaTeX math symbols.
 * Reference: LaTeX Mathematical Symbols (amssymb)
 */

export interface LatexSymbol {
  symbol: string;      // Display symbol
  latex: string;       // LaTeX command
  name: string;        // English name
}

export interface SymbolCategory {
  key: string;
  name: string;
  symbols: LatexSymbol[];
}

// ============================================
// 1. Greek Letters
// ============================================

const greekLowercase: LatexSymbol[] = [
  { symbol: "α", latex: "\\alpha", name: "alpha" },
  { symbol: "β", latex: "\\beta", name: "beta" },
  { symbol: "γ", latex: "\\gamma", name: "gamma" },
  { symbol: "δ", latex: "\\delta", name: "delta" },
  { symbol: "ε", latex: "\\epsilon", name: "epsilon" },
  { symbol: "ζ", latex: "\\zeta", name: "zeta" },
  { symbol: "η", latex: "\\eta", name: "eta" },
  { symbol: "θ", latex: "\\theta", name: "theta" },
  { symbol: "ι", latex: "\\iota", name: "iota" },
  { symbol: "κ", latex: "\\kappa", name: "kappa" },
  { symbol: "λ", latex: "\\lambda", name: "lambda" },
  { symbol: "μ", latex: "\\mu", name: "mu" },
  { symbol: "ν", latex: "\\nu", name: "nu" },
  { symbol: "ξ", latex: "\\xi", name: "xi" },
  { symbol: "ο", latex: "o", name: "omicron" },
  { symbol: "π", latex: "\\pi", name: "pi" },
  { symbol: "ρ", latex: "\\rho", name: "rho" },
  { symbol: "σ", latex: "\\sigma", name: "sigma" },
  { symbol: "τ", latex: "\\tau", name: "tau" },
  { symbol: "υ", latex: "\\upsilon", name: "upsilon" },
  { symbol: "φ", latex: "\\phi", name: "phi" },
  { symbol: "χ", latex: "\\chi", name: "chi" },
  { symbol: "ψ", latex: "\\psi", name: "psi" },
  { symbol: "ω", latex: "\\omega", name: "omega" },
];

const greekVariant: LatexSymbol[] = [
  { symbol: "ϝ", latex: "\\digamma", name: "digamma" },
  { symbol: "ε", latex: "\\varepsilon", name: "varepsilon" },
  { symbol: "ϰ", latex: "\\varkappa", name: "varkappa" },
  { symbol: "φ", latex: "\\varphi", name: "varphi" },
  { symbol: "ϖ", latex: "\\varpi", name: "varpi" },
  { symbol: "ϱ", latex: "\\varrho", name: "varrho" },
  { symbol: "ς", latex: "\\varsigma", name: "varsigma" },
  { symbol: "ϑ", latex: "\\vartheta", name: "vartheta" },
];

const greekUppercase: LatexSymbol[] = [
  { symbol: "Γ", latex: "\\Gamma", name: "Gamma" },
  { symbol: "Δ", latex: "\\Delta", name: "Delta" },
  { symbol: "Θ", latex: "\\Theta", name: "Theta" },
  { symbol: "Λ", latex: "\\Lambda", name: "Lambda" },
  { symbol: "Ξ", latex: "\\Xi", name: "Xi" },
  { symbol: "Π", latex: "\\Pi", name: "Pi" },
  { symbol: "Σ", latex: "\\Sigma", name: "Sigma" },
  { symbol: "Υ", latex: "\\Upsilon", name: "Upsilon" },
  { symbol: "Φ", latex: "\\Phi", name: "Phi" },
  { symbol: "Ψ", latex: "\\Psi", name: "Psi" },
  { symbol: "Ω", latex: "\\Omega", name: "Omega" },
];

// ============================================
// 2. Hebrew Letters
// ============================================

const hebrewLetters: LatexSymbol[] = [
  { symbol: "ℵ", latex: "\\aleph", name: "aleph" },
  { symbol: "ℶ", latex: "\\beth", name: "beth" },
  { symbol: "ℷ", latex: "\\gimel", name: "gimel" },
  { symbol: "ℸ", latex: "\\daleth", name: "daleth" },
];

// ============================================
// 3. Math Constructs
// ============================================

const mathConstructs: LatexSymbol[] = [
  { symbol: "a/b", latex: "\\frac{a}{b}", name: "fraction" },
  { symbol: "f′", latex: "f'", name: "prime" },
  { symbol: "√a", latex: "\\sqrt{a}", name: "sqrt" },
  { symbol: "ⁿ√a", latex: "\\sqrt[n]{a}", name: "nth root" },
  { symbol: "a̅", latex: "\\overline{a}", name: "overline" },
  { symbol: "a̲", latex: "\\underline{a}", name: "underline" },
  { symbol: "â", latex: "\\widehat{a}", name: "widehat" },
  { symbol: "ã", latex: "\\widetilde{a}", name: "widetilde" },
  { symbol: "→a", latex: "\\overrightarrow{a}", name: "overrightarrow" },
  { symbol: "←a", latex: "\\overleftarrow{a}", name: "overleftarrow" },
  { symbol: "⏞a", latex: "\\overbrace{a}", name: "overbrace" },
  { symbol: "⏟a", latex: "\\underbrace{a}", name: "underbrace" },
];

// ============================================
// 4. Delimiters
// ============================================

const delimiters: LatexSymbol[] = [
  { symbol: "|", latex: "|", name: "vertical bar" },
  { symbol: "|", latex: "\\vert", name: "vert" },
  { symbol: "‖", latex: "\\|", name: "double vert" },
  { symbol: "‖", latex: "\\Vert", name: "Vert" },
  { symbol: "{", latex: "\\{", name: "left brace" },
  { symbol: "}", latex: "\\}", name: "right brace" },
  { symbol: "⟨", latex: "\\langle", name: "left angle" },
  { symbol: "⟩", latex: "\\rangle", name: "right angle" },
  { symbol: "⌊", latex: "\\lfloor", name: "left floor" },
  { symbol: "⌋", latex: "\\rfloor", name: "right floor" },
  { symbol: "⌈", latex: "\\lceil", name: "left ceiling" },
  { symbol: "⌉", latex: "\\rceil", name: "right ceiling" },
  { symbol: "/", latex: "/", name: "slash" },
  { symbol: "\\", latex: "\\backslash", name: "backslash" },
  { symbol: "[", latex: "[", name: "left bracket" },
  { symbol: "]", latex: "]", name: "right bracket" },
  { symbol: "⇑", latex: "\\Uparrow", name: "Uparrow" },
  { symbol: "↑", latex: "\\uparrow", name: "uparrow" },
  { symbol: "⇓", latex: "\\Downarrow", name: "Downarrow" },
  { symbol: "↓", latex: "\\downarrow", name: "downarrow" },
  { symbol: "⌞", latex: "\\llcorner", name: "llcorner" },
  { symbol: "⌟", latex: "\\lrcorner", name: "lrcorner" },
  { symbol: "⌜", latex: "\\ulcorner", name: "ulcorner" },
  { symbol: "⌝", latex: "\\urcorner", name: "urcorner" },
];

// ============================================
// 5. Variable-sized Symbols
// ============================================

const bigOperators: LatexSymbol[] = [
  { symbol: "∑", latex: "\\sum", name: "sum" },
  { symbol: "∏", latex: "\\prod", name: "product" },
  { symbol: "∐", latex: "\\coprod", name: "coproduct" },
  { symbol: "∫", latex: "\\int", name: "integral" },
  { symbol: "∮", latex: "\\oint", name: "contour integral" },
  { symbol: "∬", latex: "\\iint", name: "double integral" },
  { symbol: "∭", latex: "\\iiint", name: "triple integral" },
  { symbol: "⊎", latex: "\\biguplus", name: "big uplus" },
  { symbol: "⋂", latex: "\\bigcap", name: "big cap" },
  { symbol: "⋃", latex: "\\bigcup", name: "big cup" },
  { symbol: "⊕", latex: "\\bigoplus", name: "big oplus" },
  { symbol: "⊗", latex: "\\bigotimes", name: "big otimes" },
  { symbol: "⊙", latex: "\\bigodot", name: "big odot" },
  { symbol: "⋁", latex: "\\bigvee", name: "big vee" },
  { symbol: "⋀", latex: "\\bigwedge", name: "big wedge" },
  { symbol: "⨆", latex: "\\bigsqcup", name: "big sqcup" },
];

// ============================================
// 6. Standard Functions
// ============================================

const standardFunctions: LatexSymbol[] = [
  { symbol: "arccos", latex: "\\arccos", name: "arccos" },
  { symbol: "arcsin", latex: "\\arcsin", name: "arcsin" },
  { symbol: "arctan", latex: "\\arctan", name: "arctan" },
  { symbol: "arg", latex: "\\arg", name: "arg" },
  { symbol: "cos", latex: "\\cos", name: "cos" },
  { symbol: "cosh", latex: "\\cosh", name: "cosh" },
  { symbol: "cot", latex: "\\cot", name: "cot" },
  { symbol: "coth", latex: "\\coth", name: "coth" },
  { symbol: "csc", latex: "\\csc", name: "csc" },
  { symbol: "deg", latex: "\\deg", name: "deg" },
  { symbol: "det", latex: "\\det", name: "det" },
  { symbol: "dim", latex: "\\dim", name: "dim" },
  { symbol: "exp", latex: "\\exp", name: "exp" },
  { symbol: "gcd", latex: "\\gcd", name: "gcd" },
  { symbol: "hom", latex: "\\hom", name: "hom" },
  { symbol: "inf", latex: "\\inf", name: "inf" },
  { symbol: "ker", latex: "\\ker", name: "ker" },
  { symbol: "lg", latex: "\\lg", name: "lg" },
  { symbol: "lim", latex: "\\lim", name: "lim" },
  { symbol: "liminf", latex: "\\liminf", name: "liminf" },
  { symbol: "limsup", latex: "\\limsup", name: "limsup" },
  { symbol: "ln", latex: "\\ln", name: "ln" },
  { symbol: "log", latex: "\\log", name: "log" },
  { symbol: "max", latex: "\\max", name: "max" },
  { symbol: "min", latex: "\\min", name: "min" },
  { symbol: "Pr", latex: "\\Pr", name: "Pr" },
  { symbol: "sec", latex: "\\sec", name: "sec" },
  { symbol: "sin", latex: "\\sin", name: "sin" },
  { symbol: "sinh", latex: "\\sinh", name: "sinh" },
  { symbol: "sup", latex: "\\sup", name: "sup" },
  { symbol: "tan", latex: "\\tan", name: "tan" },
  { symbol: "tanh", latex: "\\tanh", name: "tanh" },
];

// ============================================
// 7. Binary Operations
// ============================================

const binaryOperations: LatexSymbol[] = [
  { symbol: "±", latex: "\\pm", name: "plus minus" },
  { symbol: "∓", latex: "\\mp", name: "minus plus" },
  { symbol: "×", latex: "\\times", name: "times" },
  { symbol: "÷", latex: "\\div", name: "divide" },
  { symbol: "·", latex: "\\cdot", name: "center dot" },
  { symbol: "∗", latex: "\\ast", name: "asterisk" },
  { symbol: "⋆", latex: "\\star", name: "star" },
  { symbol: "†", latex: "\\dagger", name: "dagger" },
  { symbol: "‡", latex: "\\ddagger", name: "double dagger" },
  { symbol: "∘", latex: "\\circ", name: "circle" },
  { symbol: "•", latex: "\\bullet", name: "bullet" },
  { symbol: "⊕", latex: "\\oplus", name: "oplus" },
  { symbol: "⊖", latex: "\\ominus", name: "ominus" },
  { symbol: "⊗", latex: "\\otimes", name: "otimes" },
  { symbol: "⊘", latex: "\\oslash", name: "oslash" },
  { symbol: "⊙", latex: "\\odot", name: "odot" },
  { symbol: "∩", latex: "\\cap", name: "cap" },
  { symbol: "∪", latex: "\\cup", name: "cup" },
  { symbol: "⊔", latex: "\\sqcup", name: "sqcup" },
  { symbol: "⊓", latex: "\\sqcap", name: "sqcap" },
  { symbol: "∨", latex: "\\vee", name: "vee" },
  { symbol: "∧", latex: "\\wedge", name: "wedge" },
  { symbol: "∖", latex: "\\setminus", name: "setminus" },
  { symbol: "≀", latex: "\\wr", name: "wreath" },
  { symbol: "◁", latex: "\\triangleleft", name: "triangleleft" },
  { symbol: "▷", latex: "\\triangleright", name: "triangleright" },
];

// ============================================
// 8. Relations
// ============================================

const relations: LatexSymbol[] = [
  { symbol: "≤", latex: "\\leq", name: "leq" },
  { symbol: "≥", latex: "\\geq", name: "geq" },
  { symbol: "≡", latex: "\\equiv", name: "equiv" },
  { symbol: "≠", latex: "\\neq", name: "neq" },
  { symbol: "≈", latex: "\\approx", name: "approx" },
  { symbol: "∼", latex: "\\sim", name: "sim" },
  { symbol: "≃", latex: "\\simeq", name: "simeq" },
  { symbol: "≅", latex: "\\cong", name: "cong" },
  { symbol: "∝", latex: "\\propto", name: "propto" },
  { symbol: "≺", latex: "\\prec", name: "prec" },
  { symbol: "≻", latex: "\\succ", name: "succ" },
  { symbol: "⪯", latex: "\\preceq", name: "preceq" },
  { symbol: "⪰", latex: "\\succeq", name: "succeq" },
  { symbol: "≪", latex: "\\ll", name: "ll" },
  { symbol: "≫", latex: "\\gg", name: "gg" },
  { symbol: "∈", latex: "\\in", name: "in" },
  { symbol: "∉", latex: "\\notin", name: "notin" },
  { symbol: "∋", latex: "\\ni", name: "ni" },
  { symbol: "⊂", latex: "\\subset", name: "subset" },
  { symbol: "⊃", latex: "\\supset", name: "supset" },
  { symbol: "⊆", latex: "\\subseteq", name: "subseteq" },
  { symbol: "⊇", latex: "\\supseteq", name: "supseteq" },
  { symbol: "⊄", latex: "\\not\\subset", name: "not subset" },
  { symbol: "⊊", latex: "\\subsetneq", name: "subsetneq" },
  { symbol: "⊥", latex: "\\perp", name: "perp" },
  { symbol: "∥", latex: "\\parallel", name: "parallel" },
  { symbol: "∣", latex: "\\mid", name: "mid" },
  { symbol: "∤", latex: "\\nmid", name: "nmid" },
  { symbol: "⊢", latex: "\\vdash", name: "vdash" },
  { symbol: "⊣", latex: "\\dashv", name: "dashv" },
  { symbol: "⊨", latex: "\\models", name: "models" },
];

// ============================================
// 9. Arrows
// ============================================

const arrows: LatexSymbol[] = [
  { symbol: "←", latex: "\\leftarrow", name: "leftarrow" },
  { symbol: "→", latex: "\\rightarrow", name: "rightarrow" },
  { symbol: "↔", latex: "\\leftrightarrow", name: "leftrightarrow" },
  { symbol: "⇐", latex: "\\Leftarrow", name: "Leftarrow" },
  { symbol: "⇒", latex: "\\Rightarrow", name: "Rightarrow" },
  { symbol: "⇔", latex: "\\Leftrightarrow", name: "Leftrightarrow" },
  { symbol: "↦", latex: "\\mapsto", name: "mapsto" },
  { symbol: "⟵", latex: "\\longleftarrow", name: "longleftarrow" },
  { symbol: "⟶", latex: "\\longrightarrow", name: "longrightarrow" },
  { symbol: "⟷", latex: "\\longleftrightarrow", name: "longleftrightarrow" },
  { symbol: "⟸", latex: "\\Longleftarrow", name: "Longleftarrow" },
  { symbol: "⟹", latex: "\\Longrightarrow", name: "Longrightarrow" },
  { symbol: "⟺", latex: "\\Longleftrightarrow", name: "Longleftrightarrow" },
  { symbol: "⟼", latex: "\\longmapsto", name: "longmapsto" },
  { symbol: "↩", latex: "\\hookleftarrow", name: "hookleftarrow" },
  { symbol: "↪", latex: "\\hookrightarrow", name: "hookrightarrow" },
  { symbol: "↼", latex: "\\leftharpoonup", name: "leftharpoonup" },
  { symbol: "⇀", latex: "\\rightharpoonup", name: "rightharpoonup" },
  { symbol: "↽", latex: "\\leftharpoondown", name: "leftharpoondown" },
  { symbol: "⇁", latex: "\\rightharpoondown", name: "rightharpoondown" },
  { symbol: "⇌", latex: "\\rightleftharpoons", name: "rightleftharpoons" },
  { symbol: "↗", latex: "\\nearrow", name: "nearrow" },
  { symbol: "↘", latex: "\\searrow", name: "searrow" },
  { symbol: "↙", latex: "\\swarrow", name: "swarrow" },
  { symbol: "↖", latex: "\\nwarrow", name: "nwarrow" },
];

// ============================================
// 10. Miscellaneous
// ============================================

const miscSymbols: LatexSymbol[] = [
  { symbol: "∞", latex: "\\infty", name: "infinity" },
  { symbol: "∅", latex: "\\emptyset", name: "emptyset" },
  { symbol: "∀", latex: "\\forall", name: "forall" },
  { symbol: "∃", latex: "\\exists", name: "exists" },
  { symbol: "∄", latex: "\\nexists", name: "nexists" },
  { symbol: "¬", latex: "\\neg", name: "neg" },
  { symbol: "∂", latex: "\\partial", name: "partial" },
  { symbol: "∇", latex: "\\nabla", name: "nabla" },
  { symbol: "∠", latex: "\\angle", name: "angle" },
  { symbol: "△", latex: "\\triangle", name: "triangle" },
  { symbol: "□", latex: "\\square", name: "square" },
  { symbol: "◊", latex: "\\Diamond", name: "Diamond" },
  { symbol: "♣", latex: "\\clubsuit", name: "clubsuit" },
  { symbol: "♦", latex: "\\diamondsuit", name: "diamondsuit" },
  { symbol: "♥", latex: "\\heartsuit", name: "heartsuit" },
  { symbol: "♠", latex: "\\spadesuit", name: "spadesuit" },
  { symbol: "°", latex: "^\\circ", name: "degree" },
  { symbol: "′", latex: "'", name: "prime" },
  { symbol: "″", latex: "''", name: "double prime" },
  { symbol: "‴", latex: "'''", name: "triple prime" },
  { symbol: "ℕ", latex: "\\mathbb{N}", name: "natural numbers" },
  { symbol: "ℤ", latex: "\\mathbb{Z}", name: "integers" },
  { symbol: "ℚ", latex: "\\mathbb{Q}", name: "rationals" },
  { symbol: "ℝ", latex: "\\mathbb{R}", name: "reals" },
  { symbol: "ℂ", latex: "\\mathbb{C}", name: "complex" },
  { symbol: "℘", latex: "\\wp", name: "Weierstrass p" },
  { symbol: "ℜ", latex: "\\Re", name: "real part" },
  { symbol: "ℑ", latex: "\\Im", name: "imaginary part" },
  { symbol: "ℓ", latex: "\\ell", name: "ell" },
  { symbol: "ℏ", latex: "\\hbar", name: "h-bar" },
  { symbol: "…", latex: "\\ldots", name: "ldots" },
  { symbol: "⋯", latex: "\\cdots", name: "cdots" },
  { symbol: "⋮", latex: "\\vdots", name: "vdots" },
  { symbol: "⋱", latex: "\\ddots", name: "ddots" },
];

// ============================================
// 11. Accents
// ============================================

const accents: LatexSymbol[] = [
  { symbol: "â", latex: "\\hat{a}", name: "hat" },
  { symbol: "ǎ", latex: "\\check{a}", name: "check" },
  { symbol: "ȧ", latex: "\\dot{a}", name: "dot" },
  { symbol: "ä", latex: "\\ddot{a}", name: "ddot" },
  { symbol: "ā", latex: "\\bar{a}", name: "bar" },
  { symbol: "ã", latex: "\\tilde{a}", name: "tilde" },
  { symbol: "⃗a", latex: "\\vec{a}", name: "vec" },
  { symbol: "à", latex: "\\grave{a}", name: "grave" },
  { symbol: "á", latex: "\\acute{a}", name: "acute" },
  { symbol: "ă", latex: "\\breve{a}", name: "breve" },
];

// ============================================
// Export all categories
// ============================================

export const symbolCategories: SymbolCategory[] = [
  {
    key: "greek",
    name: "Greek Letters",
    symbols: [...greekLowercase, ...greekVariant, ...greekUppercase],
  },
  {
    key: "hebrew",
    name: "Hebrew Letters",
    symbols: hebrewLetters,
  },
  {
    key: "constructs",
    name: "Math Constructs",
    symbols: mathConstructs,
  },
  {
    key: "delimiters",
    name: "Delimiters",
    symbols: delimiters,
  },
  {
    key: "bigOperators",
    name: "Big Operators",
    symbols: bigOperators,
  },
  {
    key: "functions",
    name: "Functions",
    symbols: standardFunctions,
  },
  {
    key: "operators",
    name: "Binary Operators",
    symbols: binaryOperations,
  },
  {
    key: "relations",
    name: "Relations",
    symbols: relations,
  },
  {
    key: "arrows",
    name: "Arrows",
    symbols: arrows,
  },
  {
    key: "misc",
    name: "Miscellaneous",
    symbols: miscSymbols,
  },
  {
    key: "accents",
    name: "Accents",
    symbols: accents,
  },
];

// Get all symbols as flat array
export const allSymbols: LatexSymbol[] = symbolCategories.flatMap(
  (cat) => cat.symbols
);

// Search function
export function searchSymbols(query: string): LatexSymbol[] {
  const q = query.toLowerCase();
  return allSymbols.filter(
    (s) =>
      s.symbol.toLowerCase().includes(q) ||
      s.latex.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q)
  );
}
