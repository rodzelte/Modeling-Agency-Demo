import sanitizeHtml from "sanitize-html";
import postcss, { type AtRule, type Rule } from "postcss";

// Custom HTML/CSS blocks (spec §37). Sanitised when saved AND when rendered, so
// a row written some other way still cannot inject script.

// Structural and text markup only: no script, style, iframe, form, object, or
// event-handler attributes; links limited to http(s)/mailto/relative.
export function sanitizeBlockHtml(html: string) {
  return sanitizeHtml(html, {
    allowedTags: ["h2", "h3", "h4", "h5", "p", "br", "hr", "strong", "b", "em", "i", "u", "s", "small", "sup", "sub", "blockquote",
      "ul", "ol", "li", "a", "img", "figure", "figcaption", "div", "span", "section", "article", "table", "thead", "tbody", "tr", "th", "td", "caption"],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "width", "height", "loading"],
      "*": ["class", "id", "title", "aria-label", "role"],
      th: ["scope", "colspan", "rowspan"],
      td: ["colspan", "rowspan"],
    },
    allowedSchemes: ["https", "http", "mailto"],
    allowedSchemesByTag: { img: ["https"] },
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, ...(attribs.target === "_blank" ? { rel: "noopener noreferrer" } : {}) } }),
      img: (tagName, attribs) => ({ tagName, attribs: { ...attribs, loading: "lazy" } }),
    },
  });
}

const BLOCKED_AT_RULES = new Set(["import", "charset", "namespace", "font-face", "page", "document", "layer"]);

// Prefixes every selector with the block's scope so custom CSS can only style the
// block itself; drops @import, external url()s, expression() and behaviours.
export function scopeBlockCss(css: string, scope: string) {
  const prefix = `[data-cms-block="${scope.replace(/[^A-Za-z0-9_-]/g, "")}"]`;
  let root: postcss.Root;
  try {
    // Markup has no place in CSS; strip tags before parsing.
    root = postcss.parse(css.replace(/<\/?[a-z!][^>]*>/gi, " "));
  } catch {
    return ""; // Unparseable CSS is dropped rather than guessed at.
  }
  root.walkAtRules((rule: AtRule) => {
    if (BLOCKED_AT_RULES.has(rule.name.toLowerCase())) rule.remove();
  });
  root.walkDecls((decl) => {
    const value = decl.value.toLowerCase();
    if (/url\s*\(/.test(value) && !/url\s*\(\s*["']?data:image\/(png|jpeg|webp|gif);/.test(value)) decl.remove();
    else if (/expression\s*\(|javascript:|behavior|-moz-binding/.test(value) || /^(behavior|-moz-binding)$/i.test(decl.prop)) decl.remove();
    else if (decl.prop.toLowerCase() === "position" && /fixed|sticky/.test(value)) decl.value = "relative";
  });
  root.walkRules((rule: Rule) => {
    const parent = rule.parent;
    if (parent && parent.type === "atrule" && /keyframes$/i.test((parent as AtRule).name)) return;
    rule.selectors = rule.selectors.map((selector) => {
      const trimmed = selector.trim();
      if (/^(:root|html|body)\b/.test(trimmed)) return trimmed.replace(/^(:root|html|body)/, prefix);
      return `${prefix} ${trimmed}`;
    });
  });
  // "<" is never needed in CSS and is the only way out of a <style> element.
  return root.toString().replace(/</g, "");
}
