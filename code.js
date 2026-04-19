// AI Agent Audit — Figma Plugin
// Audits a selected frame and generates an explicit report frame
// explaining exactly why each issue breaks AI agent readability.

figma.skipInvisibleInstanceChildren = true;

// ─── PATTERNS ────────────────────────────────────────────────────────────────

const AUTO_GENERATED_NAME = /^(frame|group|rectangle|ellipse|vector|polygon|star|line|arrow|image|component|instance|union|subtract|intersect|exclude|section)\s*\d+$/i;
const GENERIC_PROP_NAME   = /^(property|prop|value|text|label|item|field|slot|content)\s*\d*$/i;
const GENERIC_VAR_NAME    = /^(color|var|variable|token|style|value|item|thing)\s*\d*$/i;
const GENERIC_COLLECTION  = /^(collection|variables|tokens|group|set|library)\s*\d*$/i;
const GENERIC_MODE        = /^(mode|theme|scheme|option)\s*\d*$/i;
const SHORT_NAME          = /^.{1,2}$/;
const KNOWN_ABBREVS       = /^(btn|nav|cta|bg|fg|txt|img|ico|lbl|inp|frm|sec|hdr|ftr|hdg|col|row|bx|cntr|wrp|crd|mdl|dlg|lnk|pg|sp|ic|wr|ct)$/i;
const PLACEHOLDER_DESC    = /^(todo|tbd|description|add description|placeholder|n\/a|none|test|example|sample|\.{2,}|-)$/i;
const APPEARANCE_WORD     = /\b(blue|red|green|yellow|purple|orange|pink|white|black|dark|light|big|small|large|rounded|square|bold|thin|heavy|bright|deep)\b/i;
const BOOL_PREFIX         = /^(is|has|show|hide|enable|disable|allow|can|should|with|use|include|display)/i;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getPath(node) {
  const parts = [];
  let cur = node;
  while (cur && cur.type !== 'PAGE') {
    parts.unshift(cur.name);
    cur = cur.parent;
  }
  return parts.join(' › ');
}

// Short version: show only the last 2 segments so lists stay scannable.
// "Home Feed › Feed › Tab Bar › Status bar › Icon" → "Status bar › Icon"
function getShortPath(node) {
  const parts = [];
  let cur = node;
  while (cur && cur.type !== 'PAGE') {
    parts.unshift(cur.name);
    cur = cur.parent;
  }
  if (parts.length <= 2) return parts.join(' › ');
  return '…› ' + parts.slice(-2).join(' › ');
}

function rgbToHex(c) {
  const r = Math.round(c.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(c.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(c.b * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`.toUpperCase();
}

function isBoundVariable(node, prop) {
  return !!(node.boundVariables && node.boundVariables[prop]);
}

// Returns true if the bound variable for `prop` comes from a primitive/base collection
// (e.g. "color/neutral/800" from a "Primitives" collection — has no semantic role).
function isBoundToPrimitive(node, prop) {
  if (!node.boundVariables || !node.boundVariables[prop]) return false;
  var binding = node.boundVariables[prop];
  var refs = Array.isArray(binding) ? binding : [binding];
  for (var i = 0; i < refs.length; i++) {
    var ref = refs[i];
    if (!ref || !ref.id) continue;
    try {
      var variable = figma.variables.getVariableById(ref.id);
      if (!variable) continue;
      var collection = figma.variables.getVariableCollectionById(variable.variableCollectionId);
      if (!collection) continue;
      var colName = collection.name.toLowerCase();
      // Collection named "primitives", "base", "global", "raw", "core", "foundation", "ref"
      if (/primitiv|^base$|^global$|^raw$|^core$|^foundation$|^ref$/.test(colName)) return true;
      // Variable name ends with a numeric tier like /100, /200, /500 (typical primitive naming)
      if (/\/\d+$/.test(variable.name)) return true;
    } catch(e) {}
  }
  return false;
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len) + '…' : str;
}

// ─── AUDIT ENGINE ────────────────────────────────────────────────────────────

// Merge issues with the same issueKey (same type of problem) into one grouped entry
// with a list of affected elements instead of N separate cards.
function groupIssues(issues) {
  var map = {};
  var order = [];

  for (var i = 0; i < issues.length; i++) {
    var iss = issues[i];
    var key = iss.category + '||' + iss.severity + '||' + iss.issueKey;

    if (!map[key]) {
      map[key] = {
        category:    iss.category,
        severity:    iss.severity,
        issueKey:    iss.issueKey,
        issue:       iss.issue,
        agentImpact: iss.agentImpact,
        fix:         iss.fix,
        elements:    []
      };
      order.push(key);
    }

    map[key].elements.push({
      path:    iss.element,
      details: iss.details || null
    });
  }

  return order.map(function(k) { return map[k]; });
}

async function collectIssues(rootNode, visibleOnly) {
  var raw = [];
  var nodeCount = 0;

  async function traverse(node) {
    if (visibleOnly && node.visible === false) return;
    nodeCount++;
    auditNaming(node, raw);
    await auditComponent(node, raw);
    auditTokens(node, raw);
    auditStyles(node, raw);
    auditStructure(node, raw);
    if ('children' in node) {
      for (var i = 0; i < node.children.length; i++) await traverse(node.children[i]);
    }
  }

  await traverse(rootNode);
  auditVariableCollections(raw);
  return { raw: raw, nodeCount: nodeCount };
}

// ── NAMING ───────────────────────────────────────────────────────────────────

function auditNaming(node, issues) {
  const name = node.name.trim();
  const path = getShortPath(node);

  // Skip the root frame itself for naming checks
  if (node.parent && node.parent.type === 'PAGE') return;

  if (AUTO_GENERATED_NAME.test(name)) {
    issues.push({
      category: 'NAMING', severity: 'CRITICAL', issueKey: 'auto-generated-name',
      element: path,
      issue: 'Auto-generated layer names',
      agentImpact: 'No semantic signal — agent cannot identify these elements\' roles.',
      fix: 'Layers panel → double-click the layer name (or select + Cmd/Ctrl+R) → rename to describe its UI role. e.g. "Frame 12" → "ProductCard", "Group 3" → "NavLinks"'
    });
    return;
  }

  if (SHORT_NAME.test(name) || KNOWN_ABBREVS.test(name)) {
    issues.push({
      category: 'NAMING', severity: 'WARNING', issueKey: 'abbreviated-name',
      element: path,
      issue: 'Abbreviated layer names',
      agentImpact: 'Agent cannot reliably decode abbreviations across codebases.',
      fix: 'Layers panel → select layer → Cmd/Ctrl+R → type the full name. e.g. "btn" → "PrimaryButton", "nav" → "TopNavigation"'
    });
    return;
  }

  if (APPEARANCE_WORD.test(name) && node.type !== 'TEXT') {
    issues.push({
      category: 'NAMING', severity: 'WARNING', issueKey: 'appearance-name',
      element: path,
      issue: 'Appearance-based layer names',
      agentImpact: 'Name encodes visuals not purpose — agent will hardcode the look.',
      fix: 'Layers panel → select layer → Cmd/Ctrl+R → rename to describe purpose not appearance. e.g. "BlueBanner" → "PromoBanner"'
    });
  }
}

// ── COMPONENTS ───────────────────────────────────────────────────────────────

async function auditComponent(node, issues) {
  const path = getShortPath(node);

  if (node.type === 'INSTANCE') {
    const comp = await node.getMainComponentAsync();

    if (!comp) {
      issues.push({
        category: 'COMPONENT', severity: 'CRITICAL', issueKey: 'detached-instance',
        element: path,
        issue: 'Detached instances',
        agentImpact: 'Raw layers with no component identity — agent can\'t read type, props, or states.',
        fix: 'Delete this instance → open Assets panel (Cmd/Ctrl+P or the grid icon in left sidebar) → search the component name → drag it back in. If the component was deleted, recreate it first: select the layers → right-click → Create component.'
      });
      return;
    }

    const desc = comp.description ? comp.description.trim() : '';
    if (!desc || PLACEHOLDER_DESC.test(desc)) {
      // Use the component/set name as the element — description lives on the definition, not the instance
      const compSourceName = (comp.parent && comp.parent.type === 'COMPONENT_SET')
        ? comp.parent.name
        : comp.name;
      issues.push({
        category: 'COMPONENT', severity: 'WARNING', issueKey: 'no-component-description',
        element: 'Component: ' + compSourceName,
        issue: 'Components with no description',
        agentImpact: 'Agent has no context on purpose, usage rules, or behavioral constraints.',
        fix: 'In the Assets panel, right-click the component \u2192 Edit main component \u2192 right panel Description field \u2192 write: what it does, when to use vs alternatives, key behavioral rules. e.g. "Primary CTA button. Use once per screen. Disabled when form is invalid."'
      });
    }

    // Property definitions live on the component set if this is a variant, otherwise on the component itself
    const propSource = (comp.parent && comp.parent.type === 'COMPONENT_SET')
      ? comp.parent
      : comp;

    // Audit each property — all property issues are component-definition problems,
    // so reference the component/set name, not the instance path.
    var propCompRef = 'Component: ' + propSource.name;
    if (propSource.componentPropertyDefinitions) {
      for (const [propName, propDef] of Object.entries(propSource.componentPropertyDefinitions)) {
        // Strip Figma's internal suffix (#7316:137 format) and any leading UI-icon characters (e.g. ↩ for INSTANCE_SWAP)
        const cleanProp = propName.split('#')[0].replace(/^[^\w]+/, '').trim();

        // Generic property name
        if (GENERIC_PROP_NAME.test(cleanProp) || SHORT_NAME.test(cleanProp)) {
          issues.push({
            category: 'COMPONENT', severity: 'CRITICAL', issueKey: 'generic-property-name',
            element: propCompRef + ' \u2192 prop "' + cleanProp + '"',
            issue: 'Generic component property names',
            agentImpact: 'Agent can\'t map these to code props or infer what they control.',
            fix: 'In Assets panel, right-click \u2192 Edit main component \u2192 right panel Properties \u2192 click the property chip \u2192 rename to what the prop does in code. e.g. "Property 1" \u2192 "variant", "Text" \u2192 "labelText"'
          });
        }

        if (propDef.type === 'BOOLEAN' && !BOOL_PREFIX.test(cleanProp)) {
          issues.push({
            category: 'COMPONENT', severity: 'WARNING', issueKey: 'boolean-no-prefix',
            element: propCompRef + ' \u2192 prop "' + cleanProp + '"',
            issue: 'Boolean properties without is/has/show prefix',
            agentImpact: 'Agent can\'t tell if true means on or off — 50% chance of wrong implementation.',
            fix: 'In Assets panel, right-click \u2192 Edit main component \u2192 right panel Properties \u2192 click the boolean chip \u2192 rename with a verb prefix. e.g. "Icon" \u2192 "hasIcon", "Disabled" \u2192 "isDisabled"'
          });
        }

        if (propDef.type === 'VARIANT' && Array.isArray(propDef.variantOptions)) {
          const badValues = propDef.variantOptions.filter(v =>
            SHORT_NAME.test(v.trim()) || /^\d+$/.test(v.trim())
          );
          if (badValues.length > 0) {
            issues.push({
              category: 'COMPONENT', severity: 'WARNING', issueKey: 'ambiguous-variant-values',
              element: propCompRef + ' \u2192 prop "' + cleanProp + '" [' + badValues.join(', ') + ']',
              issue: 'Variant properties with abbreviated or numeric values',
              agentImpact: 'Agent can\'t infer meaning from short/numeric values — generates wrong prop values.',
              fix: 'In Assets panel, right-click \u2192 Edit main component \u2192 right panel Properties \u2192 click the variant chip \u2192 rename each value. e.g. "S/M/L" \u2192 "Small/Medium/Large", "1/2/3" \u2192 "Default/Hover/Active"'
            });
          }
        }

        if (propDef.type === 'INSTANCE_SWAP') {
          // Slot issues are component-definition problems, not per-instance problems.
          // Key by component+slot so all instances of the same component/slot collapse into one entry.
          var slotCompName = propSource.name || 'Unknown component';
          var slotRef = slotCompName + ' \u2192 slot "' + cleanProp + '"';

          var GENERIC_SLOT = /^(slot\s*\d*|content|instance|component|node|child|item|element)$/i;
          if (GENERIC_SLOT.test(cleanProp)) {
            issues.push({
              category: 'COMPONENT', severity: 'CRITICAL', issueKey: 'generic-slot-name',
              element: slotRef,
              issue: 'Slots with generic names',
              agentImpact: 'Agent can\'t determine what component type belongs here — will pass wrong components or leave slot empty.',
              fix: 'Go to main component (Cmd/Ctrl+click any instance \u2192 Go to main component) \u2192 right panel Properties \u2192 click slot chip \u2192 rename to role + type. e.g. "Slot" \u2192 "leadingIcon", "Content" \u2192 "avatarSlot"'
            });
          }

          var slotDesc = (propDef.description || '').trim();
          if (!slotDesc) {
            issues.push({
              category: 'COMPONENT', severity: 'CRITICAL', issueKey: 'slot-no-description',
              element: slotRef,
              issue: 'Slots without descriptions',
              agentImpact: 'Agent has no contract for what fits here — guesses wrong or skips slot entirely.',
              fix: 'Go to main component (Cmd/Ctrl+click any instance \u2192 Go to main component) \u2192 right panel Properties \u2192 click slot chip \u2192 add description: component type, required/optional, size/state constraints. e.g. "Icon (24\xd724). Required. Filled style only."'
            });
          }

          var TYPED_SLOT = /icon|avatar|image|img|badge|button|btn|action|label|logo|thumb|thumbnail|media|indicator|chip|tag|illustration/i;
          if (!GENERIC_SLOT.test(cleanProp) && !TYPED_SLOT.test(cleanProp)) {
            issues.push({
              category: 'COMPONENT', severity: 'WARNING', issueKey: 'slot-name-unclear',
              element: slotRef,
              issue: 'Slot names that don\'t hint at content type',
              agentImpact: 'Agent can\'t infer expected component category — may insert structurally mismatched components.',
              fix: 'Go to main component \u2192 right panel Properties \u2192 click slot chip \u2192 rename to include component type. e.g. "trailing" \u2192 "trailingIcon", "left" \u2192 "leftAvatar"'
            });
          }
        }
      }
    }
  }

  // Variant overload: combinatorial explosion bloats the agent's component schema
  if (node.type === 'COMPONENT_SET') {
    var totalCombos = 1;
    var csDefs = node.componentPropertyDefinitions;
    if (csDefs) {
      for (var vk in csDefs) {
        var vd = csDefs[vk];
        if (vd.type === 'VARIANT' && Array.isArray(vd.variantOptions)) {
          totalCombos *= vd.variantOptions.length;
        }
      }
    }
    if (totalCombos > 200) {
      issues.push({
        category: 'COMPONENT', severity: 'CRITICAL', issueKey: 'variant-overload',
        element: getShortPath(node),
        issue: 'Variant explosion (' + totalCombos + ' combinations)',
        agentImpact: 'Agent must hold ' + totalCombos + ' variant states in context — causes schema truncation and hallucinated prop values.',
        fix: 'Audit which variants are actually needed. Replace orthogonal states with BOOLEAN props (e.g. isDisabled, isSelected). Split into sub-components. Target < 50 combinations per component set.'
      });
    } else if (totalCombos > 50) {
      issues.push({
        category: 'COMPONENT', severity: 'WARNING', issueKey: 'variant-overload',
        element: getShortPath(node),
        issue: 'Large variant set (' + totalCombos + ' combinations)',
        agentImpact: 'Large variant matrices expand agent\'s component schema — increases context usage and risk of missed states.',
        fix: 'Replace orthogonal state variants with BOOLEAN props (e.g. isDisabled, isSelected) to reduce combinations. Each BOOLEAN cuts the matrix in half. Target < 50 total combinations.'
      });
    }
  }
}

// ── TOKENS ───────────────────────────────────────────────────────────────────

function auditTokens(node, issues) {
  const path = getShortPath(node);

  // Hardcoded fill color
  if ('fills' in node && Array.isArray(node.fills) && !node.fillStyleId) {
    const solidFills = node.fills.filter(f => f.type === 'SOLID' && f.visible !== false);
    if (solidFills.length > 0 && !isBoundVariable(node, 'fills')) {
      const hex = rgbToHex(solidFills[0].color);
      issues.push({
        category: 'TOKEN', severity: 'CRITICAL', issueKey: 'hardcoded-fill',
        element: path, details: [hex],
        issue: 'Hardcoded fill colors',
        agentImpact: 'Agent can\'t identify semantic role — reproduces raw hex, bypassing token system.',
        fix: 'Select layer → right panel Fill → click color swatch → Variables tab → choose a semantic token. e.g. "color/surface/card", "color/brand/primary"'
      });
    }
  }

  // Hardcoded stroke color
  if ('strokes' in node && Array.isArray(node.strokes) && !node.strokeStyleId) {
    const solidStrokes = node.strokes.filter(s => s.type === 'SOLID' && s.visible !== false);
    if (solidStrokes.length > 0 && !isBoundVariable(node, 'strokes')) {
      const hex = rgbToHex(solidStrokes[0].color);
      issues.push({
        category: 'TOKEN', severity: 'WARNING', issueKey: 'hardcoded-stroke',
        element: path, details: [hex],
        issue: 'Hardcoded stroke colors',
        agentImpact: 'Agent can\'t identify border role — breaks theme/mode switching.',
        fix: 'Select layer → right panel Stroke → click color swatch → Variables tab → choose a border token. e.g. "color/border/default", "color/border/focus"'
      });
    }
  }

  // Hardcoded spacing in auto-layout frames
  if (node.type === 'FRAME' && node.layoutMode && node.layoutMode !== 'NONE') {
    const spacingProps = [
      { key: 'paddingLeft', label: 'Left padding' },
      { key: 'paddingRight', label: 'Right padding' },
      { key: 'paddingTop', label: 'Top padding' },
      { key: 'paddingBottom', label: 'Bottom padding' },
      { key: 'itemSpacing', label: 'Gap between items' },
    ];
    for (const { key, label } of spacingProps) {
      const value = node[key];
      if (value && value > 0 && !isBoundVariable(node, key)) {
        issues.push({
          category: 'TOKEN', severity: 'WARNING', issueKey: 'hardcoded-spacing',
          element: path, details: [label + ': ' + value + 'px'],
          issue: 'Hardcoded spacing values',
          agentImpact: 'Agent can\'t map raw px to your spacing scale — breaks density modes.',
          fix: 'Select frame → right panel Auto Layout → click the padding/gap value → variable icon → choose spacing token. e.g. "spacing/md", "spacing/4"'
        });
        break; // one spacing issue per frame is enough
      }
    }
  }

  // Hardcoded corner radius
  if ('cornerRadius' in node && typeof node.cornerRadius === 'number' && node.cornerRadius > 0) {
    if (!isBoundVariable(node, 'cornerRadius') && !isBoundVariable(node, 'topLeftRadius')) {
      issues.push({
        category: 'TOKEN', severity: 'WARNING', issueKey: 'hardcoded-radius',
        element: path, details: [node.cornerRadius + 'px'],
        issue: 'Hardcoded corner radius',
        agentImpact: 'Agent can\'t identify radius token — inconsistent rounding across system.',
        fix: 'Select layer → right panel → corner radius field → click the value → variable icon → choose your radius token. e.g. "radius/button", "radius/card"'
      });
    }
  }

  // Primitive tokens used directly (token exists but from a non-semantic "primitives" collection)
  var primCheckProps = ['fills', 'strokes', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'itemSpacing', 'cornerRadius'];
  for (var pi = 0; pi < primCheckProps.length; pi++) {
    if (isBoundToPrimitive(node, primCheckProps[pi])) {
      issues.push({
        category: 'TOKEN', severity: 'WARNING', issueKey: 'primitive-token',
        element: path,
        issue: 'Primitive tokens applied directly to layers',
        agentImpact: 'Agent reads "gray/400" with no semantic role — can\'t tell if it\'s text, border, or background. Must guess from context.',
        fix: 'Open Variables panel → find the variable → check its collection. If it\'s in "Primitives" or "Base", create a semantic alias (e.g. "color/text/muted" \u2192 references "gray/400") → apply the semantic token to this layer instead.'
      });
      break; // one issue per node is enough
    }
  }
}

// ── STYLES ───────────────────────────────────────────────────────────────────

function auditStyles(node, issues) {
  const path = getShortPath(node);

  // Text without text style
  if (node.type === 'TEXT') {
    if (!node.textStyleId) {
      const family = node.fontName !== figma.mixed ? node.fontName.family : 'Mixed';
      const size   = node.fontSize !== figma.mixed ? `${node.fontSize}px` : 'Mixed';
      const weight = node.fontName !== figma.mixed ? node.fontName.style : 'Mixed';
      issues.push({
        category: 'STYLE', severity: 'CRITICAL', issueKey: 'raw-typography',
        element: path,
        issue: 'Text nodes with no text style applied',
        agentImpact: 'Agent can\'t infer semantic role (heading? body? label?) — wrong HTML tags generated.',
        fix: 'Select the text layer → right panel Text section → click the style picker (four-dot grid icon next to the font name) → choose a style. If none exist, click "+" to create one. Name it with the semantic role: "Heading/H1", "Body/Regular", "Caption/Muted"',
        details: [family + ' ' + weight + ' ' + size]
      });
    }

    // Text color not bound to variable and no fill style
    if (!node.fillStyleId && Array.isArray(node.fills)) {
      const solidFills = node.fills.filter(f => f.type === 'SOLID' && f.visible !== false);
      if (solidFills.length > 0 && !isBoundVariable(node, 'fills')) {
        const hex = rgbToHex(solidFills[0].color);
        issues.push({
          category: 'TOKEN', severity: 'WARNING', issueKey: 'hardcoded-text-color',
          element: path, details: [hex],
          issue: 'Hardcoded text colors',
          agentImpact: 'Agent can\'t identify text role — breaks contrast checks and theme switching.',
          fix: 'Select text → right panel Fill section → click the color swatch → Variables tab → choose a text color token. e.g. "color/text/primary", "color/text/muted". Text color should always be a token, never a raw hex.'
        });
      }
    }
  }

  // Effects without effect style
  if ('effects' in node && Array.isArray(node.effects) && node.effects.length > 0 && !node.effectStyleId) {
    const effectTypes = [...new Set(node.effects.map(e => e.type.replace(/_/g, ' ').toLowerCase()))].join(', ');
    issues.push({
      category: 'STYLE', severity: 'WARNING', issueKey: 'raw-effect',
      element: path,
      issue: 'Raw effects with no effect style',
      agentImpact: 'Agent can\'t identify elevation role — can\'t apply consistently or switch by mode.',
      fix: 'Select layer → right panel Effects section → click the style picker (four-dot icon next to the effect) → click "+" to create a style → name it by semantic role e.g. "Shadow/Card", "Shadow/Modal" → save. Next time, apply it from the style picker instead of adding a raw effect.',
      details: [effectTypes]
    });
  }
}

// ── STRUCTURE ────────────────────────────────────────────────────────────────

function auditStructure(node, issues) {
  const path = getShortPath(node);

  // Empty containers
  if ('children' in node && node.children.length === 0
    && node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') {
    issues.push({
      category: 'STRUCTURE', severity: 'WARNING', issueKey: 'empty-container',
      element: path,
      issue: 'Empty containers',
      agentImpact: 'Agent can\'t tell if intentional placeholder or leftover — pollutes layout model.',
      fix: 'Layers panel → select the empty layer → Delete if it\'s leftover. If intentional whitespace, remove it and use the Gap or Padding fields in the parent auto-layout frame instead (right panel Auto Layout section).'
    });
  }

  // Absolute positioning with multiple children
  if (node.type === 'FRAME' && node.layoutMode === 'NONE'
    && 'children' in node && node.children.length > 2) {
    var childNames = [];
    for (var ci = 0; ci < node.children.length; ci++) {
      childNames.push(node.children[ci].name);
    }
    issues.push({
      category: 'STRUCTURE', severity: 'WARNING', issueKey: 'absolute-positioning',
      element: path,
      issue: 'Frames with absolute-positioned children',
      agentImpact: 'Agent can\'t infer layout direction, spacing, or responsive intent.',
      fix: 'Select the frame → press Shift+A to add auto-layout → right panel Auto Layout section → set direction, gap, and padding → bind each spacing value to a token (click the value → variable icon → choose token). Remove absolute positioning from children if any.',
      details: childNames
    });
  }
}

// ── VARIABLE COLLECTIONS ─────────────────────────────────────────────────────

function auditVariableCollections(issues) {
  let collections;
  try {
    collections = figma.variables.getLocalVariableCollections();
  } catch (e) {
    return; // variables API not available in this context
  }

  for (const col of collections) {
    // Generic collection name
    if (GENERIC_COLLECTION.test(col.name.trim()) || SHORT_NAME.test(col.name.trim())) {
      issues.push({
        category: 'TOKEN', severity: 'CRITICAL', issueKey: 'generic-collection',
        element: 'Variable Collection: "' + col.name + '"',
        issue: 'Generic variable collection names',
        agentImpact: 'Agent can\'t identify what type of tokens this collection holds.',
        fix: 'Open Variables panel (right panel → Variables icon, or Edit menu → Variables) → click the collection name at the top → rename to describe the token type. e.g. "Colors", "Spacing", "Radius", "Elevation". One category per collection.'
      });
    }

    // Generic or numeric mode names
    for (const mode of col.modes) {
      if (GENERIC_MODE.test(mode.name.trim()) || SHORT_NAME.test(mode.name.trim())) {
        issues.push({
          category: 'TOKEN', severity: 'CRITICAL', issueKey: 'generic-mode',
          element: 'Collection "' + col.name + '" → Mode: "' + mode.name + '"',
          issue: 'Generic variable mode names',
          agentImpact: 'Agent can\'t determine when to apply this mode — theme switching breaks.',
          fix: 'Variables panel → click the mode tab at the top of the collection → double-click the mode name → rename to when it applies. e.g. "Light", "Dark", "High Contrast", "Brand A". Mode names are used by agents to decide which values to activate.'
        });
      }
    }

    // Check individual variables
    for (const varId of col.variableIds) {
      const variable = figma.variables.getVariableById(varId);
      if (!variable) continue;

      const name = variable.name.trim();

      // Generic or too-short variable name
      if (GENERIC_VAR_NAME.test(name) || SHORT_NAME.test(name)) {
        issues.push({
          category: 'TOKEN', severity: 'CRITICAL', issueKey: 'generic-variable',
          element: 'Variable: "' + name + '" in "' + col.name + '"',
          issue: 'Generic variable names',
          agentImpact: 'Agent can\'t determine purpose — can\'t substitute correctly in generated code.',
          fix: 'Variables panel → double-click the variable name → rename using slash-hierarchy: category/role/scale. e.g. "color1" → "color/brand/primary", "r" → "radius/button", "sp3" → "spacing/md". Slashes create groups in the panel automatically.'
        });
        continue;
      }

      // Flat name without slash hierarchy
      if (!name.includes('/')) {
        issues.push({
          category: 'TOKEN', severity: 'WARNING', issueKey: 'flat-variable',
          element: 'Variable: "' + name + '" in "' + col.name + '"',
          issue: 'Variables with no slash-hierarchy',
          agentImpact: 'Agent can\'t identify token category — "primary" could be color, size, or font.',
          fix: 'Variables panel → double-click the variable name → prepend the category and role. e.g. "primary" → "color/brand/primary", "buttonRadius" → "radius/button". Slashes auto-group variables in the panel — no manual folder needed.'
        });
      }

      // Missing description
      const desc = variable.description ? variable.description.trim() : '';
      if (!desc || PLACEHOLDER_DESC.test(desc)) {
        issues.push({
          category: 'TOKEN', severity: 'WARNING', issueKey: 'no-variable-description',
          element: 'Variable: "' + name + '" in "' + col.name + '"',
          issue: 'Variables with no description',
          agentImpact: 'Agent may pick the wrong token when similar ones exist.',
          fix: 'Variables panel → click the variable → Description field in the edit drawer on the right → write when to use it, what UI role it covers, and what NOT to use it for. e.g. "Use for all primary CTA backgrounds. Never for decorative fills. Pair with color/text/on-brand."'
        });
      }
    }
  }
}

// ─── TOKEN EFFICIENCY ────────────────────────────────────────────────────────

// Computes how much extra work the agent has to do to read this screen.
// Returns { rating, factors[] }
function computeTokenEfficiency(rawIssues) {
  var counts = {
    detached:    0,
    primitive:   0,
    noDesc:      0,
    hardcoded:   0,
    absPos:      0,
    variantBlast:0,
  };

  for (var i = 0; i < rawIssues.length; i++) {
    var k = rawIssues[i].issueKey;
    if (k === 'detached-instance')       counts.detached++;
    else if (k === 'primitive-token')    counts.primitive++;
    else if (k === 'no-component-description' || k === 'slot-no-description') counts.noDesc++;
    else if (k === 'hardcoded-fill' || k === 'hardcoded-stroke' || k === 'hardcoded-spacing' || k === 'hardcoded-radius' || k === 'hardcoded-text-color' || k === 'raw-typography' || k === 'raw-effect') counts.hardcoded++;
    else if (k === 'absolute-positioning') counts.absPos++;
    else if (k === 'variant-overload')   counts.variantBlast++;
  }

  // Weight each issue type by how much reasoning it forces on the agent
  var score =
    counts.detached    * 3   +
    counts.variantBlast* 2   +
    counts.primitive   * 2   +
    counts.noDesc      * 1.5 +
    counts.hardcoded   * 1   +
    counts.absPos      * 1;

  var rating;
  if (score === 0)      rating = 'OPTIMAL';
  else if (score <= 5)  rating = 'LOW';
  else if (score <= 15) rating = 'MODERATE';
  else if (score <= 30) rating = 'HIGH';
  else                  rating = 'CRITICAL';

  // Factors sorted by impact (descending), zeros excluded
  var factors = [
    { label: 'Detached instances',   count: counts.detached,    weight: 3,   note: 'full subtree dumps — no identity or props' },
    { label: 'Variant overload',     count: counts.variantBlast,weight: 2,   note: 'large schema the agent must load entirely' },
    { label: 'Primitive tokens',     count: counts.primitive,   weight: 2,   note: 'agent must reason about raw tier value' },
    { label: 'Missing descriptions', count: counts.noDesc,      weight: 1.5, note: 'agent infers purpose from structure' },
    { label: 'Hardcoded values',     count: counts.hardcoded,   weight: 1,   note: 'raw hex/px with no semantic name' },
    { label: 'Absolute-pos frames',  count: counts.absPos,      weight: 1,   note: 'x/y coordinates instead of semantic layout' },
  ].filter(function(f) { return f.count > 0; })
   .sort(function(a, b) { return (b.count * b.weight) - (a.count * a.weight); });

  return { rating: rating, factors: factors };
}

// ─── REPORT FRAME RENDERER ───────────────────────────────────────────────────

const REPORT_WIDTH = 540;
const PAD = 24;
const INNER_PAD = 16;

// Palette sourced from the plugin UI:
//   cream bg  #FBF7F3   blue    #00AAF9 / #40BEF8   navy  #2E5CFF
//   orange    #FA6225   brown   rgb(154,130,102)     shadow #E7E0D7
var THEMES = {
  light: {
    bg:         { r: 0.984, g: 0.969, b: 0.953 }, // #FBF7F3 — UI background
    card:       { r: 1.000, g: 1.000, b: 1.000 }, // white — unselected pill bg
    cardInner:  { r: 0.930, g: 0.906, b: 0.875 }, // warmer than #E7E0D7
    divider:    { r: 0.906, g: 0.878, b: 0.843 }, // #E7E0D7 — pill shadow
    textPrimary:{ r: 0.10,  g: 0.07,  b: 0.04  }, // warm near-black
    muted:      { r: 0.604, g: 0.510, b: 0.400 }, // rgb(154,130,102) — group labels
    dimmed:     { r: 0.72,  g: 0.63,  b: 0.52  }, // lighter version of muted
    bodyText:   { r: 0.28,  g: 0.22,  b: 0.15  }, // warm dark brown
    critical:   { r: 0.86,  g: 0.16,  b: 0.06  }, // warm red
    criticalBg: { r: 0.99,  g: 0.92,  b: 0.90  }, // warm red tint
    warning:    { r: 0.80,  g: 0.44,  b: 0.00  }, // warm amber
    warningBg:  { r: 0.99,  g: 0.95,  b: 0.88  }, // warm amber tint
    pass:       { r: 0.08,  g: 0.62,  b: 0.32  }, // green
    cat: {
      COMPONENT: { r: 0.000, g: 0.667, b: 0.976 }, // #00AAF9 — UI blue
      TOKEN:     { r: 0.180, g: 0.361, b: 1.000 }, // #2E5CFF — robot eye navy
      STYLE:     { r: 0.05,  g: 0.60,  b: 0.55  }, // teal
      NAMING:    { r: 0.980, g: 0.384, b: 0.145 }, // #FA6225 — audit button orange
      STRUCTURE: { r: 0.25,  g: 0.60,  b: 0.12  }, // green
    }
  },
  dark: {
    bg:         { r: 0.10,  g: 0.08,  b: 0.06  }, // warm near-black
    card:       { r: 0.15,  g: 0.12,  b: 0.09  }, // warm dark card
    cardInner:  { r: 0.21,  g: 0.17,  b: 0.13  }, // slightly lighter
    divider:    { r: 0.28,  g: 0.23,  b: 0.18  }, // warm divider
    textPrimary:{ r: 0.99,  g: 0.97,  b: 0.95  }, // warm white
    muted:      { r: 0.55,  g: 0.47,  b: 0.38  }, // warm muted (matches label brown)
    dimmed:     { r: 0.38,  g: 0.31,  b: 0.24  }, // warm dimmed
    bodyText:   { r: 0.80,  g: 0.73,  b: 0.65  }, // warm body
    critical:   { r: 1.00,  g: 0.38,  b: 0.22  }, // warm red-orange
    criticalBg: { r: 0.26,  g: 0.09,  b: 0.04  }, // dark warm red
    warning:    { r: 1.00,  g: 0.65,  b: 0.25  }, // warm amber
    warningBg:  { r: 0.26,  g: 0.17,  b: 0.05  }, // dark warm amber
    pass:       { r: 0.20,  g: 0.85,  b: 0.52  }, // green
    cat: {
      COMPONENT: { r: 0.251, g: 0.745, b: 0.973 }, // #40BEF8 — lighter UI blue for dark bg
      TOKEN:     { r: 0.45,  g: 0.60,  b: 1.00  }, // lighter navy
      STYLE:     { r: 0.30,  g: 0.88,  b: 0.76  }, // teal
      NAMING:    { r: 1.00,  g: 0.60,  b: 0.32  }, // warm orange
      STRUCTURE: { r: 0.55,  g: 0.88,  b: 0.35  }, // green
    }
  }
};

// Active theme — set at runtime based on user choice
var COLOR = THEMES.light; // default

// Returns a tinted version of a category color as a subtle background.
// Dark theme: blend towards black. Light theme: blend towards white.
function catTint(col, strength) {
  strength = strength || 0.15;
  if (COLOR === THEMES.light) {
    return {
      r: 1 - (1 - col.r) * strength,
      g: 1 - (1 - col.g) * strength,
      b: 1 - (1 - col.b) * strength
    };
  }
  return { r: col.r * strength, g: col.g * strength, b: col.b * strength };
}

function buildEfficiencyCard(eff) {
  // Rating color — reuse theme colors
  var isGood    = eff.rating === 'OPTIMAL' || eff.rating === 'LOW';
  var isCrit    = eff.rating === 'CRITICAL' || eff.rating === 'HIGH';
  var tagColor  = isGood ? COLOR.pass    : (isCrit ? COLOR.critical : COLOR.warning);
  var tagBg     = isGood ? catTint(COLOR.pass, 0.18) : (isCrit ? COLOR.criticalBg : COLOR.warningBg);

  var card = makeFrame('TokenEfficiency', {
    color: COLOR.card, layout: 'VERTICAL',
    p: INNER_PAD, gap: 10, radius: 8,
  });

  // Header row: label + rating tag
  var headerRow = makeFrame('EffHeader', { layout: 'HORIZONTAL', gap: 10, align: 'CENTER', hug: true });
  headerRow.appendChild(makeLabel('TOKEN EFFICIENCY', COLOR.dimmed));
  headerRow.appendChild(makeTag(eff.rating, tagColor, tagBg));
  appendFill(card, headerRow);

  // Plain-language description
  var subtitles = {
    OPTIMAL:  'All layers use semantic tokens and descriptions — agent can read this screen directly.',
    LOW:      'Mostly clean with a few minor gaps — agent will handle this reliably.',
    MODERATE: 'Several layers are missing tokens or descriptions — agent will guess in those areas and produce inconsistent output.',
    HIGH:     'Many layers lack semantic data — agent will frequently infer values, code output will be unreliable.',
    CRITICAL: 'Agent cannot reliably read this screen — too many missing tokens and descriptions.'
  };
  appendFill(card, makeText(subtitles[eff.rating], { size: 11, color: COLOR.muted, lineHeight: 16 }));

  // What's causing the extra tokens
  if (eff.factors.length > 0) {
    appendFill(card, makeText('Where the extra tokens come from:', { size: 11, color: COLOR.dimmed, lineHeight: 16 }));
    var lines = [];
    for (var i = 0; i < eff.factors.length; i++) {
      var f = eff.factors[i];
      lines.push('\u00B7 ' + f.label + ' (' + f.count + ')   \u2014 ' + f.note);
    }
    appendFill(card, makeText(lines.join('\n'), { size: 11, color: COLOR.bodyText, lineHeight: 17 }));
  }

  return card;
}

// Which body/label font families loaded successfully
var FONT_BODY  = 'Inter';
var FONT_MONO  = 'Inter';

async function loadFonts() {
  // Try DM Sans first; fall back to Inter if not installed
  try {
    await Promise.all([
      figma.loadFontAsync({ family: 'DM Sans', style: 'Regular' }),
      figma.loadFontAsync({ family: 'DM Sans', style: 'Medium' }),
      figma.loadFontAsync({ family: 'DM Sans', style: 'SemiBold' }),
      figma.loadFontAsync({ family: 'DM Sans', style: 'Bold' }),
    ]);
    FONT_BODY = 'DM Sans';
  } catch(e) {
    await Promise.all([
      figma.loadFontAsync({ family: 'Inter', style: 'Regular' }),
      figma.loadFontAsync({ family: 'Inter', style: 'Medium' }),
      figma.loadFontAsync({ family: 'Inter', style: 'SemiBold' }),
      figma.loadFontAsync({ family: 'Inter', style: 'Bold' }),
    ]);
    FONT_BODY = 'Inter';
  }
  // Try DM Mono; fall back to Inter Mono / Inter
  try {
    await figma.loadFontAsync({ family: 'DM Mono', style: 'Medium' });
    FONT_MONO = 'DM Mono';
  } catch(e) {
    try {
      await figma.loadFontAsync({ family: 'Roboto Mono', style: 'Regular' });
      FONT_MONO = 'Roboto Mono';
    } catch(e2) {
      FONT_MONO = FONT_BODY; // last resort
    }
  }
  console.log('[AI Audit] Fonts loaded — body:', FONT_BODY, '/ mono:', FONT_MONO);
}

// Append child then set FILL — must happen after appendChild so parent context exists.
function appendFill(parent, child) {
  parent.appendChild(child);
  try { child.layoutSizingHorizontal = 'FILL'; } catch(e) {
    console.warn('[AI Audit] appendFill failed on "' + child.name + '":', e.message);
  }
  return child;
}

function setSizing(node, h, v) {
  try { if (h) node.layoutSizingHorizontal = h; } catch(e) {}
  try { if (v) node.layoutSizingVertical   = v; } catch(e) {}
}

function makeFrame(name, opts) {
  opts = opts || {};
  const f = figma.createFrame();
  f.name = name;
  f.fills = opts.fills !== undefined ? opts.fills : [];
  if (opts.color) f.fills = [{ type: 'SOLID', color: opts.color }];
  if (opts.layout) {
    f.layoutMode = opts.layout;
    f.itemSpacing = opts.gap || 0;
    f.paddingLeft   = opts.pl !== undefined ? opts.pl : (opts.px !== undefined ? opts.px : (opts.p || 0));
    f.paddingRight  = opts.pr !== undefined ? opts.pr : (opts.px !== undefined ? opts.px : (opts.p || 0));
    f.paddingTop    = opts.pt !== undefined ? opts.pt : (opts.py !== undefined ? opts.py : (opts.p || 0));
    f.paddingBottom = opts.pb !== undefined ? opts.pb : (opts.py !== undefined ? opts.py : (opts.p || 0));
    // primaryAxisSizingMode controls HUG vs FIXED on the auto-layout axis
    try { f.primaryAxisSizingMode = 'AUTO'; } catch(e) {}
    try { f.counterAxisSizingMode = 'AUTO'; } catch(e) {}
  }
  if (opts.radius) f.cornerRadius = opts.radius;
  if (opts.align) f.counterAxisAlignItems = opts.align;
  if (opts.width) f.resize(opts.width, 1);
  return f;
}

function makeText(chars, opts) {
  opts = opts || {};
  const t = figma.createText();
  t.fontName = { family: FONT_BODY, style: opts.style || 'Regular' };
  t.characters = chars;
  t.fontSize = opts.size || 13;
  t.fills = [{ type: 'SOLID', color: opts.color || COLOR.textPrimary }];
  // layoutSizingHorizontal can only be set after appending to an auto-layout parent — callers handle this
  if (opts.lineHeight) t.lineHeight = { value: opts.lineHeight, unit: 'PIXELS' };
  if (opts.spacing) t.letterSpacing = { value: opts.spacing, unit: 'PIXELS' };
  return t;
}

function makeLabel(chars, color) {
  const t = figma.createText();
  // Use mono font if available, else body font with Medium/SemiBold weight
  var monoStyle = (FONT_MONO === 'DM Mono' || FONT_MONO === 'Roboto Mono') ? 'Medium' : 'SemiBold';
  t.fontName = { family: FONT_MONO, style: monoStyle };
  t.characters = chars;
  t.fontSize = 10;
  t.fills = [{ type: 'SOLID', color: color || COLOR.textPrimary }];
  t.letterSpacing = { value: 0.9, unit: 'PIXELS' };
  return t;
}

function makeDivider() {
  const d = figma.createFrame();
  d.name = 'Divider';
  d.fills = [{ type: 'SOLID', color: COLOR.divider }];
  d.resize(492, 1); // fixed width matching report content area; FILL set after appending
  return d;
}

function makeTag(text, textColor, bgColor) {
  const tag = makeFrame('Tag', {
    layout: 'HORIZONTAL', hug: true, align: 'CENTER',
    px: 7, py: 4, radius: 4,
    fills: [{ type: 'SOLID', color: bgColor }],
  });
  const t = makeLabel(text, textColor);
  tag.appendChild(t);
  return tag;
}

// Group an array of issues into { CATEGORY: [issues] } preserving insertion order
function groupByCategory(issues) {
  var groups = {};
  for (var i = 0; i < issues.length; i++) {
    var cat = issues[i].category;
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(issues[i]);
  }
  return groups;
}

async function buildReportFrame(targetFrame, issues, efficiency) {
  // Sort: criticals first, warnings after
  var criticals = [];
  var warnings  = [];
  for (var i = 0; i < issues.length; i++) {
    if (issues[i].severity === 'CRITICAL') criticals.push(issues[i]);
    else warnings.push(issues[i]);
  }

  var root = makeFrame('[AI Agent Audit] ' + targetFrame.name, {
    color: COLOR.bg, layout: 'VERTICAL',
    p: PAD, gap: 18, radius: 14,
  });
  // Use absoluteBoundingBox so the report lands next to the node regardless of nesting depth
  var bounds = targetFrame.absoluteBoundingBox || { x: targetFrame.x, y: targetFrame.y, width: targetFrame.width };
  root.x = bounds.x + bounds.width + 80;
  root.y = bounds.y;
  root.resize(REPORT_WIDTH, 100);
  try { root.primaryAxisSizingMode = 'AUTO'; } catch(e) {}

  // ── Header
  var header = makeFrame('Header', { layout: 'VERTICAL', gap: 6 });
  appendFill(header, makeText('AI Agent Readability Audit', { style: 'Bold', size: 19 }));
  var isAutoLayout = targetFrame.type === 'FRAME' && targetFrame.layoutMode && targetFrame.layoutMode !== 'NONE';
  var typeLabel = isAutoLayout ? 'Design'
    : { FRAME: 'Frame', SECTION: 'Section', COMPONENT: 'Component', COMPONENT_SET: 'Component set', INSTANCE: 'Component' }[targetFrame.type] || targetFrame.type;
  appendFill(header, makeText(typeLabel + ': ' + targetFrame.name, { size: 12, color: COLOR.muted }));
  appendFill(root, header);
  appendFill(root, makeDivider());

  // ── Token Efficiency
  if (efficiency) {
    appendFill(root, buildEfficiencyCard(efficiency));
    appendFill(root, makeDivider());
  }

  // ── Summary
  var summary = makeFrame('Summary', {
    color: COLOR.card, layout: 'VERTICAL',
    p: INNER_PAD, gap: 12, radius: 8,
  });
  summary.appendChild(makeLabel('AUDIT SUMMARY', COLOR.dimmed));

  // Count affected elements (not issue-type groups)
  var critCount = 0, warnCount = 0;
  for (var ci = 0; ci < criticals.length; ci++) critCount += criticals[ci].elements.length;
  for (var wi = 0; wi < warnings.length;  wi++) warnCount += warnings[wi].elements.length;

  var scoreRow = makeFrame('ScoreRow', { layout: 'HORIZONTAL', gap: 10, align: 'CENTER', hug: true });
  scoreRow.appendChild(makeTag(critCount + ' Critical', COLOR.critical, COLOR.criticalBg));
  scoreRow.appendChild(makeTag(warnCount + ' Warnings', COLOR.warning, COLOR.warningBg));
  scoreRow.appendChild(makeTag((critCount + warnCount) + ' Total', COLOR.muted, COLOR.cardInner));
  summary.appendChild(scoreRow);

  // Per-category breakdown row
  var catTotals = {};
  for (var j = 0; j < issues.length; j++) {
    var c = issues[j].category;
    catTotals[c] = (catTotals[c] || 0) + issues[j].elements.length;
  }
  if (Object.keys(catTotals).length > 0) {
    var catRow = makeFrame('CatRow', { layout: 'HORIZONTAL', gap: 8, align: 'CENTER', hug: true });
    for (var cat in catTotals) {
      var cc = COLOR.cat[cat];
      catRow.appendChild(makeTag(cat + '  ' + catTotals[cat], cc, catTint(cc, 0.18)));
    }
    summary.appendChild(catRow);
  }
  appendFill(root, summary);

  // ── Issues
  if (issues.length === 0) {
    appendFill(root, makeDivider());
    appendFill(root, makeText('All checks passed. This frame is fully AI-agent readable.', {
      style: 'SemiBold', size: 14, color: COLOR.pass
    }));
  } else {
    // Criticals section
    if (criticals.length > 0) {
      appendFill(root, makeDivider());
      appendFill(root, makeSeverityHeader('CRITICAL ISSUES', critCount, COLOR.critical, COLOR.criticalBg));
      var critGroups = groupByCategory(criticals);
      for (var cat in critGroups) {
        appendFill(root, await buildCategoryBlock(cat, critGroups[cat], 'CRITICAL'));
      }
    }
    // Warnings section
    if (warnings.length > 0) {
      appendFill(root, makeDivider());
      appendFill(root, makeSeverityHeader('WARNINGS', warnCount, COLOR.warning, COLOR.warningBg));
      var warnGroups = groupByCategory(warnings);
      for (var cat in warnGroups) {
        appendFill(root, await buildCategoryBlock(cat, warnGroups[cat], 'WARNING'));
      }
    }
  }

  return root;
}

// Small severity section header — e.g. "● CRITICAL ISSUES  6"
function makeSeverityHeader(label, count, textColor, bgColor) {
  var row = makeFrame('SevHeader_' + label, {
    layout: 'HORIZONTAL', gap: 8, align: 'CENTER', hug: true,
    py: 4,
  });
  var dot = makeText('●', { style: 'Bold', size: 10, color: textColor, hug: true });
  var title = makeText(label, { style: 'Bold', size: 11, color: textColor, hug: true });
  title.letterSpacing = { value: 0.8, unit: 'PIXELS' };
  var badge = makeFrame('Badge', {
    layout: 'HORIZONTAL', hug: true,
    px: 7, py: 3, radius: 4,
    fills: [{ type: 'SOLID', color: bgColor }],
  });
  var badgeText = makeText(String(count), { style: 'Bold', size: 11, color: textColor, hug: true });
  badge.appendChild(badgeText);
  row.appendChild(dot);
  row.appendChild(title);
  row.appendChild(badge);
  return row;
}

// One category block: colored header + nested compact issue rows with dividers
async function buildCategoryBlock(category, issues, severity) {
  var catColor   = COLOR.cat[category];
  var catBg      = catTint(catColor, 0.12);
  var accentColor = severity === 'CRITICAL' ? COLOR.critical : COLOR.warning;

  var block = makeFrame('Block_' + category, {
    color: COLOR.card, layout: 'VERTICAL',
    gap: 0, radius: 8,
  });
  block.clipsContent = true;

  // Category header bar
  var catHeader = makeFrame('CatHeader', {
    layout: 'HORIZONTAL', gap: 8, align: 'CENTER', hug: true,
    px: INNER_PAD, py: 10,
    fills: [{ type: 'SOLID', color: catBg }],
  });
  var catLabel = makeText(category, { style: 'Bold', size: 11, color: catColor, hug: true });
  catLabel.letterSpacing = { value: 0.8, unit: 'PIXELS' };
  var totalElements = 0;
  for (var j = 0; j < issues.length; j++) totalElements += issues[j].elements.length;
  var countLabel = makeText(
    issues.length + (issues.length === 1 ? ' type' : ' types') + ' · ' + totalElements + ' affected',
    { size: 11, color: COLOR.muted, hug: true }
  );
  catHeader.appendChild(catLabel);
  catHeader.appendChild(countLabel);
  appendFill(block, catHeader);

  // Issue rows separated by thin dividers
  for (var i = 0; i < issues.length; i++) {
    if (i > 0) {
      var div = figma.createFrame();
      div.name = 'Div';
      div.fills = [{ type: 'SOLID', color: COLOR.divider }];
      div.resize(492, 1);
      appendFill(block, div);
    }
    appendFill(block, await buildCompactIssueRow(issues[i], accentColor));
  }

  return block;
}

// Compact issue row — no redundant category/severity tags since they're in the section headers
async function buildCompactIssueRow(issue, accentColor) {
  var row = makeFrame('Issue', {
    color: COLOR.card, layout: 'VERTICAL',
    px: INNER_PAD, pt: 12, pb: 14,
    gap: 6,
  });

  var count = issue.elements.length;
  var MAX_SHOWN = 6;

  // Issue title + count badge
  var titleText = count > 1 ? issue.issue + '  (' + count + ')' : issue.issue;
  appendFill(row, makeText(titleText, { style: 'SemiBold', size: 13 }));

  // Element list — short paths only, details on a separate indented line
  var lines = [];
  for (var i = 0; i < Math.min(count, MAX_SHOWN); i++) {
    var el = issue.elements[i];
    lines.push('· ' + el.path);
    // Details (e.g. child names for absolute-positioning, font info for raw-typography)
    // shown indented on their own line so they don't bloat the path line
    if (el.details && el.details.length > 0) {
      var detailStr = el.details.slice(0, 4).join(', ');
      if (el.details.length > 4) detailStr += ' +' + (el.details.length - 4) + ' more';
      lines.push('  ↳ ' + detailStr);
    }
  }
  if (count > MAX_SHOWN) {
    lines.push('  + ' + (count - MAX_SHOWN) + ' more not shown');
  }
  appendFill(row, makeText(lines.join('\n'), { size: 11, color: COLOR.dimmed, lineHeight: 16 }));

  // Impact + Fix
  appendFill(row, makeText('Why: ' + issue.agentImpact, { size: 12, color: COLOR.bodyText, lineHeight: 17 }));
  appendFill(row, makeText('Fix: ' + issue.fix, { size: 12, color: accentColor, lineHeight: 17 }));

  return row;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function runAudit(theme) {
  // Apply theme globally before building any frames
  COLOR = THEMES[theme] || THEMES.dark;
  const sel = figma.currentPage.selection;

  if (!sel.length) {
    figma.notify('Nothing selected — select a frame or component in the canvas first.', { error: true, timeout: 4000 });
    figma.ui.postMessage({ type: 'done' });
    return;
  }

  const target = sel[0];
  const frameTypes     = ['FRAME', 'SECTION'];
  const componentTypes = ['COMPONENT', 'COMPONENT_SET', 'INSTANCE'];
  const allowed        = frameTypes.concat(componentTypes);

  if (!allowed.includes(target.type)) {
    figma.notify('Select a screen or component — "' + target.name + '" is a ' + target.type.toLowerCase() + '.', { error: true, timeout: 4000 });
    figma.ui.postMessage({ type: 'done' });
    return;
  }

  // Auto-detect mode: frames/sections skip hidden layers (screen context); components/instances include all states
  var visibleOnly = frameTypes.includes(target.type);

  var progressToast = figma.notify('Auditing "' + target.name + '"…', { timeout: 60000 });

  console.log('[AI Audit] Loading fonts…');
  await loadFonts();

  console.log('[AI Audit] Running audit on', target.type, '(visibleOnly=' + visibleOnly + ')…');
  var collected = await collectIssues(target, visibleOnly);
  var raw = collected.raw;
  var efficiency = computeTokenEfficiency(raw);
  var issues = groupIssues(raw);
  console.log('[AI Audit] Issues found:', raw.length, '(grouped:', issues.length + ')');

  console.log('[AI Audit] Building report frame…');
  var report = await buildReportFrame(target, issues, efficiency);

  figma.currentPage.appendChild(report);
  figma.viewport.scrollAndZoomIntoView([target, report]);

  var crit = raw.filter(function(i) { return i.severity === 'CRITICAL'; }).length;
  var warn = raw.filter(function(i) { return i.severity === 'WARNING'; }).length;

  var msg = raw.length === 0
    ? 'All checks passed — fully AI-agent readable!'
    : 'Audit done: ' + crit + ' critical · ' + warn + ' warnings · efficiency ' + efficiency.rating;

  console.log('[AI Audit] Done:', msg);
  progressToast.cancel();
  figma.notify(msg, { timeout: 5000 });
  figma.ui.postMessage({ type: 'done' });
}

// Show the UI dialog first — user picks visible-only or all layers
figma.showUI(__html__, { width: 250, height: 250, title: 'AI Agent Audit' });

figma.ui.onmessage = function(msg) {
  if (msg.type === 'resize') {
    figma.ui.resize(250, msg.height);
  }
  if (msg.type === 'run') {
    runAudit(msg.theme).catch(function(err) {
      console.error('[AI Audit] Fatal error:', err);
      figma.notify('Audit error: ' + err.message, { error: true, timeout: 6000 });
      figma.ui.postMessage({ type: 'done' });
    });
  }
};
